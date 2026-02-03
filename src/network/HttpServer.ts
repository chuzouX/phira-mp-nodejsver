
import express from 'express';
import { createServer, Server } from 'http';
import path from 'path';
import session, { SessionData } from 'express-session';
import crypto from 'crypto';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';

interface AdminSession extends SessionData {
  isAdmin?: boolean;
}

interface LoginAttempt {
  count: number;
  lastAttempt: number;
}

export class HttpServer {
  private readonly app: express.Application;
  private readonly server: Server;
  private readonly loginAttempts = new Map<string, LoginAttempt>();
  
  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
  ) {
    this.app = express();
    this.server = createServer(this.app);
    this.setupMiddleware();
    this.setupRoutes();
    
    // Cleanup expired login attempts every hour to prevent memory leak
    setInterval(() => {
        const now = Date.now();
        for (const [ip, attempt] of this.loginAttempts.entries()) {
            if (now - attempt.lastAttempt > 15 * 60 * 1000) { // 15 minutes expiration
                this.loginAttempts.delete(ip);
            }
        }
    }, 60 * 60 * 1000);
  }

  private setupMiddleware(): void {
    // Body parser for form data and JSON
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());

    // Session management
    // Check for insecure default secret
    if (this.config.sessionSecret === 'a-very-insecure-secret-change-it') {
        this.logger.warn('SECURITY WARNING: Using default session secret. Please set SESSION_SECRET in .env file.');
    }

    this.app.use(session({
      secret: this.config.sessionSecret,
      resave: false,
      saveUninitialized: true,
      cookie: { 
          secure: process.env.NODE_ENV === 'production', // Enable secure cookies in production
          httpOnly: true,
          sameSite: 'lax', // CSRF protection
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
      } 
    }));
    
    // CORS middleware to allow other servers to fetch data
    this.app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*'); // Allow any server to request
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        next();
    });
  }

  private setupRoutes(): void {
    const publicPath = path.join(__dirname, '../../public');
    this.app.use(express.static(publicPath));
    this.logger.info(`Serving static files from ${publicPath}`);

    this.app.get('/admin', (req, res) => {
      if ((req.session as AdminSession).isAdmin) {
        return res.redirect('/');
      }
      res.sendFile(path.join(publicPath, 'admin.html'));
    });

    this.app.get('/api/config/public', (_req, res) => {
        res.json({
            turnstileSiteKey: this.config.turnstileSiteKey,
        });
    });

    this.app.post('/login', async (req, res) => {
      const { username, password, 'cf-turnstile-response': turnstileToken } = req.body;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();

      if (!username || !password) {
          return res.status(400).send('Username and password are required.');
      }

      // Turnstile Verification
      if (this.config.turnstileSecretKey) {
          if (!turnstileToken) {
              return res.status(400).send('Turnstile verification failed (missing token).');
          }

          try {
              const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
              const formData = new URLSearchParams();
              formData.append('secret', this.config.turnstileSecretKey);
              formData.append('response', turnstileToken as string);
              formData.append('remoteip', ip);

              const result = await fetch(verifyUrl, {
                  method: 'POST',
                  body: formData,
              });
              
              const outcome = await result.json();
              if (!outcome.success) {
                  this.logger.warn(`Turnstile verification failed for IP ${ip}`, outcome);
                  return res.status(400).send('Turnstile verification failed. Please try again.');
              }
          } catch (error) {
              this.logger.error('Turnstile verification error:', { error: String(error) });
              return res.status(500).send('Internal server error during verification.');
          }
      }

      // Rate Limiting Logic
      const attempt = this.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
      
      // Reset count if last attempt was more than 15 minutes ago
      if (now - attempt.lastAttempt > 15 * 60 * 1000) {
          attempt.count = 0;
      }

      if (attempt.count >= 5) {
          this.logger.warn(`Blocked login attempt from blocked IP: ${ip}`);
          return res.status(429).send('Too many failed login attempts. Please try again later.');
      }

      // Timing Safe Comparison
      const inputUsernameHash = crypto.createHash('sha256').update(String(username)).digest();
      const targetUsernameHash = crypto.createHash('sha256').update(this.config.adminName).digest();
      const inputPasswordHash = crypto.createHash('sha256').update(String(password)).digest();
      const targetPasswordHash = crypto.createHash('sha256').update(this.config.adminPassword).digest();

      // We use timingSafeEqual on hashes (which are fixed length)
      const usernameMatch = crypto.timingSafeEqual(inputUsernameHash, targetUsernameHash);
      const passwordMatch = crypto.timingSafeEqual(inputPasswordHash, targetPasswordHash);

      if (usernameMatch && passwordMatch) {
        // Success
        this.loginAttempts.delete(ip); // Clear failed attempts
        
        // Regenerate session to prevent fixation attacks
        try {
            await new Promise<void>((resolve, reject) => {
                req.session.regenerate((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            (req.session as AdminSession).isAdmin = true;
            const safeUsername = String(username).substring(0, 50); // Limit log length
            this.logger.info(`Admin user '${safeUsername}' logged in successfully from ${ip}.`);
            return res.redirect('/');
        } catch (err) {
            this.logger.error('Session regeneration failed', { error: String(err) });
            return res.status(500).send('Login error');
        }
      } else {
        // Failure
        attempt.count++;
        attempt.lastAttempt = now;
        this.loginAttempts.set(ip, attempt);
        
        const safeUsername = String(username).substring(0, 50); // Limit log length
        this.logger.warn(`Failed login attempt for user '${safeUsername}' from ${ip}. Failed attempts: ${attempt.count}`);
        return res.status(401).send('Invalid username or password. <a href="/admin">Try again</a>');
      }
    });

    this.app.get('/logout', (req, res) => {
        return req.session.destroy((err) => {
            if (err) {
                this.logger.error('Failed to destroy session:', err);
                return res.status(500).send('Could not log out.');
            }
            return res.redirect('/');
        });
    });

    this.app.get('/check-auth', (req, res) => {
        const isAdmin = (req.session as AdminSession).isAdmin ?? false;
        return res.json({ isAdmin });
    });

    this.app.get('/api/all-players', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const allPlayers = this.protocolHandler.getAllSessions().map(p => ({
            ...p,
            isAdmin: this.config.adminPhiraId.includes(p.id),
            isOwner: this.config.ownerPhiraId.includes(p.id),
        }));
        return res.json(allPlayers);
    });

    this.app.post('/api/admin/server-message', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId, content } = req.body;
        if (!roomId || !content) {
            return res.status(400).json({ error: 'Missing roomId or content' });
        }
        this.protocolHandler.sendServerMessage(roomId, "【系统】"+content);
        return res.json({ success: true });
    });

    this.app.post('/api/admin/kick-player', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }
        const success = this.protocolHandler.kickPlayer(Number(userId));
        return res.json({ success });
    });

    this.app.post('/api/admin/force-start', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.forceStartGame(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/toggle-lock', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.toggleRoomLock(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/set-max-players', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId, maxPlayers } = req.body;
        if (!roomId || maxPlayers === undefined) {
            return res.status(400).json({ error: 'Missing roomId or maxPlayers' });
        }
        const success = this.protocolHandler.setRoomMaxPlayers(roomId, Number(maxPlayers));
        return res.json({ success });
    });

    this.app.post('/api/admin/close-room', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.closeRoomByAdmin(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/toggle-mode', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.toggleRoomMode(roomId);
        return res.json({ success });
    });

    this.app.get('/api/admin/room-blacklist', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.query;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const room = this.roomManager.getRoom(String(roomId));
        return res.json({ blacklist: room?.blacklist || [] });
    });

    this.app.post('/api/admin/set-room-blacklist', async (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId, userIds } = req.body;
        if (!roomId || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'Missing roomId or invalid userIds' });
        }
        const success = await this.protocolHandler.setRoomBlacklistByAdmin(roomId, userIds);
        return res.json({ success });
    });

    this.app.get('/api/admin/room-whitelist', (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId } = req.query;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const room = this.roomManager.getRoom(String(roomId));
        return res.json({ whitelist: room?.whitelist || [] });
    });

    this.app.post('/api/admin/set-room-whitelist', async (req, res) => {
        if (!(req.session as AdminSession).isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { roomId, userIds } = req.body;
        if (!roomId || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'Missing roomId or invalid userIds' });
        }
        const success = await this.protocolHandler.setRoomWhitelistByAdmin(roomId, userIds);
        return res.json({ success });
    });

    // Public Status API for external servers
    this.app.get('/api/status', (_req, res) => {
        const rooms = this.roomManager.listRooms()
            .filter(room => {
                // Mode 1: Public Web Only (Whitelist)
                if (this.config.enablePubWeb) {
                  return room.id.startsWith(this.config.pubPrefix);
                }
                // Mode 2: Private Web Exclusion (Blacklist)
                if (this.config.enablePriWeb) {
                  return !room.id.startsWith(this.config.priPrefix);
                }
                // Default: Show all
                return true;
            })
            .map(room => {
                const players = Array.from(room.players.values()).map(p => ({
                    id: p.user.id,
                    name: p.user.name,
                }));

                return {
                    id: room.id,
                    name: room.name,
                    playerCount: room.players.size,
                    maxPlayers: room.maxPlayers,
                    state: room.state,
                    locked: room.locked,
                    cycle: room.cycle,
                    players: players,
                };
            });

        const response = {
            serverName: this.config.serverName,
            onlinePlayers: this.protocolHandler.getSessionCount(),
            roomCount: rooms.length,
            rooms: rooms
        };

        res.json(response);
    });
  }

  public getInternalServer(): Server {
    return this.server;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.webPort, () => {
        this.logger.info(`HTTP server listening on port ${this.config.webPort}`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.logger.error('HTTP server error:', { error });
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('HTTP server stopped');
        resolve();
      });
    });
  }
}
