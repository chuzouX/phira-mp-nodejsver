import express from 'express';
import { createServer, Server } from 'http';
import path from 'path';
import fs from 'fs';
import session, { SessionData } from 'express-session';
import crypto from 'crypto';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BanManager } from '../domain/auth/BanManager';
import { FederationManager } from '../federation/FederationManager';

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
  private readonly blacklistedIps = new Map<string, number>(); // ip -> expiresAt
  private sessionParser: express.RequestHandler;
  private readonly blacklistFile = path.join(process.cwd(), 'data', 'login_blacklist.json');
  private readonly cleanupInterval: NodeJS.Timeout;
  
  private readonly rateLimits = new Map<string, { count: number; lastReset: number }>();
  private cachedStatus: any = null;
  private statusCacheTime = 0;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
    private readonly banManager: BanManager,
    private readonly federationManager?: FederationManager,
  ) {
    this.app = express();
    this.server = createServer(this.app);

    // Set trust proxy hops based on configuration
    this.app.set('trust proxy', this.config.trustProxyHops);

    // Initialize session parser
    this.sessionParser = session({
      secret: this.config.sessionSecret,
      resave: false,
      saveUninitialized: true,
      cookie: { 
          secure: process.env.NODE_ENV === 'production', // Enable secure cookies in production
          httpOnly: true,
          sameSite: 'lax', // CSRF protection
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
      } 
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupFederationRoutes();
    this.loadBlacklist();
    
    // Cleanup expired login attempts and rate limits every hour
    this.cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [ip, attempt] of this.loginAttempts.entries()) {
            if (now - attempt.lastAttempt > 15 * 60 * 1000) { // 15 minutes expiration
                this.loginAttempts.delete(ip);
            }
        }
        for (const [ip, limit] of this.rateLimits.entries()) {
            if (now - limit.lastReset > 60 * 1000) {
                this.rateLimits.delete(ip);
            }
        }
    }, 60 * 60 * 1000);
  }

  private rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
      const ip = this.getRealIp(req);
      const now = Date.now();
      const limit = this.rateLimits.get(ip) || { count: 0, lastReset: now };

      if (now - limit.lastReset > 60000) { // 1 minute window
          limit.count = 0;
          limit.lastReset = now;
      }

      limit.count++;
      this.rateLimits.set(ip, limit);

      if (limit.count > 60) { // Max 60 requests per minute
          res.status(429).json({ error: 'Too many requests. Please slow down.' });
          return;
      }

      next();
  }

  private loadBlacklist(): void {
    if (fs.existsSync(this.blacklistFile)) {
        try {
            const data = fs.readFileSync(this.blacklistFile, 'utf8');
            const entries = JSON.parse(data);
            if (typeof entries === 'object' && !Array.isArray(entries)) {
                Object.entries(entries).forEach(([ip, expiresAt]) => {
                    this.blacklistedIps.set(ip, Number(expiresAt));
                });
            } else if (Array.isArray(entries)) {
                // Compatibility for old Array format
                entries.forEach(ip => this.blacklistedIps.set(ip, Date.now() + 365 * 24 * 3600 * 1000));
            }
            this.cleanupBlacklist();
            this.logger.info(`已从文件加载 ${this.blacklistedIps.size} 个登录黑名单 IP。`);
        } catch (e) {
            this.logger.error(`加载登录黑名单文件失败: ${e}`);
        }
    }
  }

  private saveBlacklist(): void {
    try {
        const dir = path.dirname(this.blacklistFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = Object.fromEntries(this.blacklistedIps);
        fs.writeFileSync(this.blacklistFile, JSON.stringify(data, null, 2));
    } catch (e) {
        this.logger.error(`保存登录黑名单失败: ${e}`);
    }
  }

  private cleanupBlacklist(): void {
    const now = Date.now();
    let changed = false;
    for (const [ip, expiresAt] of this.blacklistedIps.entries()) {
        if (expiresAt < now) {
            this.blacklistedIps.delete(ip);
            changed = true;
        }
    }
    if (changed) this.saveBlacklist();
  }

  private getRealIp(req: express.Request): string {
    // 1. First priority: Express's req.ip (parsed from X-Forwarded-For via trustProxyHops)
    const ip = req.ip;
    
    // 2. If req.ip is local/unset but X-Real-IP exists, it might be a direct proxy setup
    const isLocal = !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) {
        const xRealIp = req.headers['x-real-ip'];
        if (xRealIp && typeof xRealIp === 'string') {
            return xRealIp.trim();
        }
    }

    return ip || req.socket.remoteAddress || 'unknown';
  }

  private isBlacklisted(ip: string): boolean {
    const expiresAt = this.blacklistedIps.get(ip);
    if (!expiresAt) return false;
    
    if (expiresAt < Date.now()) {
        this.blacklistedIps.delete(ip);
        this.saveBlacklist();
        return false;
    }
    return true;
  }

  private getRemainingBlacklistTimeStr(ip: string): string {
    const expiresAt = this.blacklistedIps.get(ip);
    if (!expiresAt) return '';
    
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return '已过期';
    
    const seconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
    return `${seconds}秒`;
  }

  private logToBlacklist(ip: string, username: string): void {
    const duration = this.config.loginBlacklistDuration;
    const expiresAt = Date.now() + duration * 1000;
    this.blacklistedIps.set(ip, expiresAt);
    this.saveBlacklist();
    const durationStr = duration >= 3600 ? `${(duration / 3600).toFixed(1)}小时` : `${Math.floor(duration / 60)}分钟`;
    this.logger.ban(`IP ${ip} 因多次登录失败（尝试用户名: ${username}）被自动加入登录黑名单。时长: ${durationStr}`);
  }

  private async verifyCaptcha(req: express.Request, ip: string): Promise<{ success: boolean; message?: string }> {
      const provider = this.config.captchaProvider;
      
      if (provider === 'none') {
          return { success: true };
      }

      if (provider === 'geetest') {
          const { lot_number, captcha_output, pass_token, gen_time } = req.body;
          if (!lot_number || !captcha_output || !pass_token || !gen_time) {
              return { success: false, message: 'Missing Geetest parameters.' };
          }

          if (!this.config.geetestId || !this.config.geetestKey) {
              this.logger.error('Geetest ID or Key missing in configuration');
              return { success: false, message: 'Captcha configuration error.' };
          }

          try {
              const sign_token = crypto.createHmac('sha256', this.config.geetestKey)
                  .update(lot_number, 'utf8')
                  .digest('hex');

              const query = new URLSearchParams({
                  captcha_id: this.config.geetestId,
                  lot_number,
                  captcha_output,
                  pass_token,
                  gen_time,
                  sign_token,
              }).toString();

              const verifyUrl = `http://gcaptcha4.geetest.com/validate?${query}`;
              const response = await fetch(verifyUrl, { 
                  method: 'POST',
                  redirect: 'error' // 防止 SSRF 重定向攻击
              });
              const result = await response.json() as any;

              if (result.result === 'success') {
                  this.logger.info(`IP ${ip} 的 Geetest 验证成功`);
                  return { success: true };
              } else {
                  this.logger.warn(`IP ${ip} 的 Geetest 验证失败: ${result.reason}`);
                  return { success: false, message: result.reason || 'Geetest verification failed.' };
              }
          } catch (error) {
              this.logger.error(`Geetest 验证错误: ${String(error)}`);
              // 当请求 Geetest 服务接口出现异常，应放行通过 (参考 app.js)
              return { success: true };
           }
       }

       return { success: true };
  }

  private setupMiddleware(): void {
    // Body parser for form data and JSON
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());

    // Session management
    // Check for insecure default secret
    if (this.config.sessionSecret === 'a-very-insecure-secret-change-it') {
        this.logger.warn('安全警告：正在使用默认的 Session Secret。请在 .env 文件中设置 SESSION_SECRET。');
    }

    this.app.use(this.sessionParser);
    
    // CORS middleware to allow other servers to fetch data
    this.app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*'); // Allow any server to request
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Admin-Secret');
        next();
    });
  }

  private adminAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    // 1. Basic CSRF Protection: Verify Origin/Referer for sensitive state-changing methods
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.get('origin');
        const referer = req.get('referer');
        const host = req.get('host');

        // If Origin is present, it must match our Host
        if (origin) {
            try {
                const originUrl = new URL(origin);
                const isAllowed = this.config.allowedOrigins.some(ao => {
                    try { return new URL(ao).host === originUrl.host; } catch { return false; }
                });

                if (!isAllowed && originUrl.host !== host) {
                    this.logger.warn(`CSRF 拦截: 异常的 Origin [${origin}], 预期 Host [${host}] 或白名单内容`);
                    res.status(403).json({ error: 'Forbidden: CSRF validation failed (Origin mismatch)' });
                    return;
                }
            } catch (e) {
                res.status(403).json({ error: 'Forbidden: Invalid Origin header' });
                return;
            }
        } else if (referer) {
            // Fallback to Referer check
            try {
                const refererUrl = new URL(referer);
                const isAllowed = this.config.allowedOrigins.some(ao => {
                    try { return new URL(ao).host === refererUrl.host; } catch { return false; }
                });

                if (!isAllowed && refererUrl.host !== host) {
                    this.logger.warn(`CSRF 拦截: 异常的 Referer [${referer}], 预期 Host [${host}] 或白名单内容`);
                    res.status(403).json({ error: 'Forbidden: CSRF validation failed (Referer mismatch)' });
                    return;
                }
            } catch (e) {
                res.status(403).json({ error: 'Forbidden: Invalid Referer header' });
                return;
            }
        }
    }

    const isAdmin = (req.session as AdminSession).isAdmin;
    const providedSecret = req.header('X-Admin-Secret') || (req.query.admin_secret as string);

    const isSecretValid = providedSecret ? this.verifyAdminSecret(providedSecret) : false;

    if (isAdmin || isSecretValid) {
        // If authenticated via secret but not session, we can optionally mark session as admin
        if (!isAdmin && (req.session as AdminSession)) {
            (req.session as AdminSession).isAdmin = true;
        }
        return next();
    }

    res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  private verifyAdminSecret(providedSecret: string): boolean {
    if (!this.config.adminSecret || this.config.adminSecret.trim() === '') return false;

    try {
      // 使用 ADMIN_SECRET 的 SHA256 作为 32 字节 Key
      const key = crypto.createHash('sha256').update(this.config.adminSecret).digest();
      const data = Buffer.from(providedSecret, 'hex');
      
      if (data.length < 17) return false;

      const iv = data.subarray(0, 16);
      const encrypted = data.subarray(16);
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      // 获取当前日期 (YYYY-MM-DD)
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      // 验证格式: {日期}_{SECRET}_xy521
      const expected = `${dateStr}_${this.config.adminSecret}_xy521`;
      
      return decrypted === expected;
    } catch (e) {
      this.logger.debug(`管理员密钥解密失败: ${e}`);
      return false;
    }
  }

  private setupRoutes(): void {
    // Global IP Ban Check
    this.app.use((req, res, next) => {
        const ip = this.getRealIp(req);
        const banInfo = this.banManager.isIpBanned(ip);
        if (banInfo) {
            this.logger.warn(`拦截到封禁 IP ${ip} 的 Web 访问。原因: ${banInfo.reason}`);
            res.status(403).send(`您的 IP 已被封禁。原因: ${banInfo.reason}`);
            return;
        }
        next();
    });

    const publicPath = path.join(__dirname, '../../public');
    
    // Custom HTML routes WITH config injection (MUST be before express.static)
    this.app.get(['/admin', '/admin.html'], (_req, res) => {
      if ((_req.session as AdminSession).isAdmin) {
        return res.redirect('/');
      }
      this.serveHtmlWithConfig(res, path.join(publicPath, 'admin.html'));
    });

    this.app.get(['/', '/index.html'], (_req, res) => {
        this.serveHtmlWithConfig(res, path.join(publicPath, 'index.html'));
    });

    this.app.get(['/room', '/room.html'], (_req, res) => {
        this.serveHtmlWithConfig(res, path.join(publicPath, 'room.html'));
    });

    this.app.get(['/players', '/players.html'], (_req, res) => {
        this.serveHtmlWithConfig(res, path.join(publicPath, 'players.html'));
    });

    this.app.get(['/panel', '/panel.html'], this.adminAuth.bind(this), (_req, res) => {
        this.serveHtmlWithConfig(res, path.join(publicPath, 'panel.html'));
    });

    this.app.use(express.static(publicPath));
    this.logger.info(`正在从 ${publicPath} 提供静态文件`);

    this.app.post('/login', async (req, res) => {
      const { username, password } = req.body;
      const ip = this.getRealIp(req);

      if (this.isBlacklisted(ip)) {
          const timeLeft = this.getRemainingBlacklistTimeStr(ip);
          return res.status(403).send(`由于您多次尝试登录失败，已被系统拉入登录黑名单，剩余时长: ${timeLeft}，如需要提前解除，请联系服务器管理员`);
      }

      if (!username || !password) {
        return res.status(400).send('Username and password are required.');
      }

      const captchaResult = await this.verifyCaptcha(req, ip);
      if (!captchaResult.success) {
          return res.status(400).send(captchaResult.message || 'Captcha verification failed.');
      }

      const now = Date.now();
      let attempt = this.loginAttempts.get(ip);

      if (!attempt) {
        attempt = { count: 0, lastAttempt: now };
        this.loginAttempts.set(ip, attempt);
      }

      // Reset count if last attempt was more than 2 minutes ago
      if (now - attempt.lastAttempt > 2 * 60 * 1000) {
          attempt.count = 0;
      }

      if (attempt.count >= 8) {
          this.logToBlacklist(ip, String(username));
          return res.status(403).send('由于您多次尝试登录失败，已被系统拉入登录黑名单，如需要解除，请联系服务器管理员');
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
            this.logger.info(`管理员用户 '${safeUsername}' 从 ${ip} 登录成功。`);
            return res.redirect('/');
        } catch (err) {
            this.logger.error(`Session 重生失败: ${String(err)}`);
            return res.status(500).send('Login error');
        }
      } else {
        // Failure
        attempt.count++;
        attempt.lastAttempt = now;
        this.loginAttempts.set(ip, attempt);
        
        const safeUsername = String(username).substring(0, 50); // Limit log length
        this.logger.warn(`用户 '${safeUsername}' 从 ${ip} 登录失败。失败尝试次数: ${attempt.count}`);
        return res.status(401).send('Invalid username or password. <a href="/admin">Try again</a>');
      }
    });

    this.app.get('/logout', (req, res) => {
        return req.session.destroy((err) => {
            if (err) {
                this.logger.error(`销毁 Session 失败: ${err}`);
                return res.status(500).send('Could not log out.');
            }
            return res.redirect('/');
        });
    });

    this.app.get('/check-auth', (req, res) => {
        const isAdmin = (req.session as AdminSession).isAdmin ?? false;
        return res.json({ isAdmin });
    });

    this.app.get('/api/all-players', this.adminAuth.bind(this), this.rateLimitMiddleware.bind(this), (_req, res) => {
        const allPlayers = this.protocolHandler.getAllSessions().map(p => ({
            ...p,
            isAdmin: this.config.adminPhiraId.includes(p.id),
            isOwner: this.config.ownerPhiraId.includes(p.id),
            ip: p.ip, // Expose IP for banning
        }));
        return res.json(allPlayers);
    });

    this.app.post('/api/admin/server-message', this.adminAuth.bind(this), (req, res) => {
        const { roomId, content } = req.body;
        if (!roomId || !content) {
            return res.status(400).json({ error: 'Missing roomId or content' });
        }
        this.protocolHandler.sendServerMessage(roomId, "【系统】"+content);
        return res.json({ success: true });
    });

    this.app.post('/api/admin/broadcast', this.adminAuth.bind(this), (req, res) => {
        const { content, target } = req.body;
        if (!content) {
            return res.status(400).json({ error: 'Missing content' });
        }
        
        const targetIds = (target && target.startsWith('#')) 
            ? target.substring(1).split(',').map((id: string) => id.trim()) 
            : null;

        const rooms = this.roomManager.listRooms();
        let sentCount = 0;
        rooms.forEach(room => {
            if (!targetIds || targetIds.includes(room.id)) {
                this.protocolHandler.sendServerMessage(room.id, "【全服播报】" + content);
                sentCount++;
            }
        });
        
        return res.json({ success: true, roomCount: sentCount });
    });

    this.app.post('/api/admin/bulk-action', this.adminAuth.bind(this), (req, res) => {
        const { action, value, target } = req.body;
        const rooms = this.roomManager.listRooms();
        
        const targetIds = (target && target.startsWith('#')) 
            ? target.substring(1).split(',').map((id: string) => id.trim()) 
            : null;

        let count = 0;
        rooms.forEach(room => {
            if (targetIds && !targetIds.includes(room.id)) return;

            switch (action) {
                case 'close_all':
                    this.protocolHandler.closeRoomByAdmin(room.id);
                    count++;
                    break;
                case 'lock_all':
                    if (!room.locked) this.protocolHandler.toggleRoomLock(room.id);
                    count++;
                    break;
                case 'unlock_all':
                    if (room.locked) this.protocolHandler.toggleRoomLock(room.id);
                    count++;
                    break;
                case 'set_max_players':
                    if (value && !isNaN(Number(value))) {
                        this.protocolHandler.setRoomMaxPlayers(room.id, Number(value));
                        count++;
                    }
                    break;
            }
        });

        // Handle global non-room actions
        if (!targetIds) {
            if (action === 'disable_room_creation') {
                this.roomManager.setGlobalLocked(true);
                return res.json({ success: true });
            } else if (action === 'enable_room_creation') {
                this.roomManager.setGlobalLocked(false);
                return res.json({ success: true });
            }
        }

        return res.json({ success: true, affectedCount: count });
    });

    this.app.post('/api/admin/kick-player', this.adminAuth.bind(this), (req, res) => {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }
        const success = this.protocolHandler.kickPlayer(Number(userId));
        return res.json({ success });
    });

    this.app.post('/api/admin/force-start', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.forceStartGame(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/toggle-lock', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.toggleRoomLock(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/set-max-players', this.adminAuth.bind(this), (req, res) => {
        const { roomId, maxPlayers } = req.body;
        if (!roomId || maxPlayers === undefined) {
            return res.status(400).json({ error: 'Missing roomId or maxPlayers' });
        }
        const success = this.protocolHandler.setRoomMaxPlayers(roomId, Number(maxPlayers));
        return res.json({ success });
    });

    this.app.post('/api/admin/close-room', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.closeRoomByAdmin(roomId);
        return res.json({ success });
    });

    this.app.post('/api/admin/toggle-mode', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const success = this.protocolHandler.toggleRoomMode(roomId);
        return res.json({ success });
    });

    this.app.get('/api/admin/room-blacklist', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.query;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const room = this.roomManager.getRoom(String(roomId));
        return res.json({ blacklist: room?.blacklist || [] });
    });

    this.app.post('/api/admin/set-room-blacklist', this.adminAuth.bind(this), async (req, res) => {
        const { roomId, userIds } = req.body;
        if (!roomId || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'Missing roomId or invalid userIds' });
        }
        const success = await this.protocolHandler.setRoomBlacklistByAdmin(roomId, userIds);
        return res.json({ success });
    });

    this.app.get('/api/admin/room-whitelist', this.adminAuth.bind(this), (req, res) => {
        const { roomId } = req.query;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId' });
        }
        const room = this.roomManager.getRoom(String(roomId));
        return res.json({ whitelist: room?.whitelist || [] });
    });

    this.app.post('/api/admin/set-room-whitelist', this.adminAuth.bind(this), async (req, res) => {
        const { roomId, userIds } = req.body;
        if (!roomId || !Array.isArray(userIds)) {
            return res.status(400).json({ error: 'Missing roomId or invalid userIds' });
        }
        const success = await this.protocolHandler.setRoomWhitelistByAdmin(roomId, userIds);
        return res.json({ success });
    });

    // Ban Management APIs
    this.app.get('/api/admin/bans', this.adminAuth.bind(this), (_req, res) => {
        return res.json(this.banManager.getAllBans());
    });

    this.app.post('/api/admin/ban', this.adminAuth.bind(this), (req, res) => {
        const { type, target, duration, reason } = req.body; // type: 'id' | 'ip', target: string|number, duration: seconds (null for perm)
        
        if (!type || !target) {
            return res.status(400).json({ error: 'Missing type or target' });
        }

        const adminName = (req.session as AdminSession).isAdmin ? this.config.adminName : 'Admin (Secret)';
        const finalReason = reason && String(reason).trim() !== '' ? String(reason) : 'No reason provided';

        if (type === 'id') {
            const userId = Number(target);
            this.banManager.banId(userId, duration ? Number(duration) : null, finalReason, adminName);
            // Kick player if online
            this.protocolHandler.kickPlayer(userId);
        } else if (type === 'ip') {
            const ip = String(target);
            this.banManager.banIp(ip, duration ? Number(duration) : null, finalReason, adminName);
            // Kick all players with this IP
            this.protocolHandler.kickIp(ip);
        } else {
            return res.status(400).json({ error: 'Invalid ban type' });
        }

        return res.json({ success: true });
    });

    this.app.post('/api/admin/unban', this.adminAuth.bind(this), (req, res) => {
        const { type, target } = req.body;
        if (!type || !target) {
            return res.status(400).json({ error: 'Missing type or target' });
        }

        const adminName = (req.session as AdminSession).isAdmin ? this.config.adminName : 'Admin (Secret)';
        let success = false;
        if (type === 'id') {
            success = this.banManager.unbanId(Number(target), adminName);
        } else if (type === 'ip') {
            success = this.banManager.unbanIp(String(target), adminName);
        }

        return res.json({ success });
    });

    // Login Blacklist APIs
    this.app.get('/api/admin/login-blacklist', this.adminAuth.bind(this), (_req, res) => {
        const list = Array.from(this.blacklistedIps.entries()).map(([ip, expiresAt]) => ({
            ip,
            expiresAt
        }));
        return res.json({ blacklistedIps: list });
    });

    this.app.post('/api/admin/blacklist-ip', this.adminAuth.bind(this), (req, res) => {
        const { ip, duration } = req.body; // duration in seconds
        if (!ip) {
            return res.status(400).json({ error: 'Missing ip' });
        }
        const adminName = (req.session as AdminSession).isAdmin ? this.config.adminName : 'Admin (Secret)';
        const finalDuration = duration ? Number(duration) : this.config.loginBlacklistDuration;
        const expiresAt = Date.now() + finalDuration * 1000;
        
        this.blacklistedIps.set(String(ip), expiresAt);
        this.saveBlacklist();
        
        const durationStr = finalDuration >= 3600 ? `${(finalDuration / 3600).toFixed(1)}小时` : `${Math.floor(finalDuration / 60)}分钟`;
        this.logger.ban(`IP ${ip} 被管理员 ${adminName} 手动加入登录黑名单。时长: ${durationStr}`);
        return res.json({ success: true });
    });

    this.app.post('/api/admin/unblacklist-ip', this.adminAuth.bind(this), (req, res) => {
        const { ip } = req.body;
        if (!ip) {
            return res.status(400).json({ error: 'Missing ip' });
        }
        const adminName = (req.session as AdminSession).isAdmin ? this.config.adminName : 'Admin (Secret)';
        const success = this.blacklistedIps.delete(String(ip));
        if (success) {
            this.saveBlacklist();
            this.logger.ban(`IP ${ip} 被管理员 ${adminName} 从登录黑名单中移除。`);
        }
        return res.json({ success });
    });

    // Public Status API for external servers
    this.app.get('/api/status', this.rateLimitMiddleware.bind(this), (req, res) => {
        const isAdmin = (req.session as AdminSession).isAdmin ?? false;

        // Use cache for public requests (non-admin)
        if (!isAdmin && Date.now() - this.statusCacheTime < 1000 && this.cachedStatus) {
            return res.json(this.cachedStatus);
        }

        const rooms = this.roomManager.listRooms()
            .filter(room => {
                // Admin can see everything
                if (isAdmin) {
                    return true;
                }
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
                    state: {
                        ...room.state,
                        chartId: (room.state as any).chartId ?? room.selectedChart?.id ?? null,
                        chartName: room.selectedChart?.name ?? null,
                    },
                    locked: room.locked,
                    cycle: room.cycle,
                    players: players,
                };
            });

        const response = {
            serverName: this.config.serverName,
            onlinePlayers: this.protocolHandler.getSessionCount(),
            roomCount: rooms.length,
            rooms: rooms,
            // 联邦信息
            federation: this.federationManager ? {
              enabled: true,
              nodeId: this.federationManager.getNodeId(),
              remoteRooms: this.federationManager.getRemoteRooms().map((r: any) => ({
                id: r.id,
                name: r.name,
                nodeId: r.nodeId,
                nodeName: r.nodeName,
                playerCount: r.playerCount,
                maxPlayers: r.maxPlayers,
                state: r.state,
                locked: r.locked,
                cycle: r.cycle,
                players: r.players,
              })),
              nodes: this.federationManager.getOnlineNodes().map((n: any) => ({
                id: n.id,
                serverName: n.serverName,
                status: n.status,
              })),
            } : { enabled: false },
        };

        if (!isAdmin) {
            this.cachedStatus = response;
            this.statusCacheTime = Date.now();
        }

        return res.json(response);
    });
  }

  // ==================== 联邦路由 ====================

  private setupFederationRoutes(): void {
    if (!this.federationManager) {
      this.logger.debug('[联邦] 联邦管理器未提供，跳过联邦路由注册');
      return;
    }

    const fm = this.federationManager;

    // 联邦认证中间件：验证共享密钥
    const authFederation = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const secret = req.header('X-Federation-Secret');
      const expectedSecret = fm.getConfig().secret;
      if (!secret || !expectedSecret || secret !== expectedSecret) {
        res.status(403).json({ error: 'Invalid federation secret' });
        return;
      }
      next();
    };

    // === 节点发现 ===

    // 握手：接收其他节点的自我介绍，返回自身信息和已知节点列表
    this.app.post('/api/federation/handshake', authFederation, (req, res) => {
      const { nodeId, nodeUrl, serverName, isReverse } = req.body;
      if (!nodeId || !nodeUrl) {
        return res.status(400).json({ error: 'Missing nodeId or nodeUrl' });
      }

      this.logger.info(`[联邦HTTP] 收到握手请求: 来自 ${serverName} (ID: ${nodeId}, URL: ${nodeUrl}, 反向: ${!!isReverse})`);
      const result = fm.handleIncomingHandshake({ nodeId, nodeUrl, serverName: serverName || 'Unknown', isReverse: !!isReverse });
      this.logger.info(`[联邦HTTP] 握手响应已发送给 ${serverName}`);
      return res.json(result);
    });

    // 健康检查：返回节点状态和已知节点列表
    this.app.get('/api/federation/health', authFederation, (_req, res) => {
      return res.json({
        nodeId: fm.getNodeId(),
        serverName: fm.getConfig().serverName,
        status: 'online',
        timestamp: Date.now(),
        peers: fm.getNodes().filter(n => n.status === 'online').map(n => ({
          id: n.id,
          url: n.url,
          serverName: n.serverName,
        })),
      });
    });

    // 获取已知节点列表
    this.app.get('/api/federation/peers', authFederation, (_req, res) => {
      return res.json({
        peers: fm.getNodes().map(n => ({
          id: n.id,
          url: n.url,
          serverName: n.serverName,
          status: n.status,
          lastSeen: n.lastSeen,
        })),
      });
    });

    // === 房间与玩家查询 ===

    // 获取本节点的房间列表（供其他节点同步）
    this.app.get('/api/federation/rooms', authFederation, (_req, res) => {
      const rooms = fm.getLocalRoomsForFederation();
      this.logger.info(`[联邦HTTP] 收到房间查询请求，返回 ${rooms.length} 个本地房间`);
      return res.json({ rooms });
    });

    // 获取本节点的所有在线玩家
    this.app.get('/api/federation/players', authFederation, (_req, res) => {
      const players = this.protocolHandler.getAllSessions().map(p => ({
        id: p.id,
        name: p.name,
        roomId: p.roomId,
        roomName: p.roomName,
      }));
      return res.json({ players });
    });

    // === 跨服代理 ===

    // 代理加入：远程玩家请求加入本地房间
    this.app.post('/api/federation/proxy/join', authFederation, (req, res) => {
      const { roomId, userId, userInfo, sourceNodeId, sourceNodeUrl } = req.body;
      if (!roomId || !userId || !userInfo || !sourceNodeId || !sourceNodeUrl) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const result = fm.handleIncomingJoin({ roomId, userId, userInfo, sourceNodeId, sourceNodeUrl });
      return res.json(result);
    });

    // 代理命令：远程玩家在本地房间执行命令
    this.app.post('/api/federation/proxy/command', authFederation, async (req, res) => {
      const { roomId, userId, command, sourceNodeId } = req.body;
      if (!roomId || !userId || !command || !sourceNodeId) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      try {
        const result = await fm.handleIncomingCommand({ roomId, userId, command, sourceNodeId });
        return res.json(result);
      } catch (error) {
        this.logger.error(`[联邦] 处理代理命令失败: ${error}`);
        return res.status(500).json({ success: false, error: 'Internal error' });
      }
    });

    // 代理离开：远程玩家离开本地房间
    this.app.post('/api/federation/proxy/leave', authFederation, (req, res) => {
      const { roomId, userId, sourceNodeId } = req.body;
      if (!roomId || !userId || !sourceNodeId) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const result = fm.handleIncomingLeave({ roomId, userId, sourceNodeId });
      return res.json(result);
    });

    // 事件回调：权威服务器推送广播事件给代理服务器上的玩家
    this.app.post('/api/federation/proxy/callback', authFederation, (req, res) => {
      const { targetUserId, command } = req.body;
      if (targetUserId === undefined || !command) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const delivered = fm.handleEventCallback({ targetUserId, command });
      return res.json({ success: delivered });
    });

    // === 事件广播 ===

    // 接收来自其他节点的房间事件
    this.app.post('/api/federation/event', authFederation, (req, res) => {
      const event = req.body;
      if (!event || !event.type || !event.sourceNodeId) {
        return res.status(400).json({ error: 'Invalid event' });
      }

      this.logger.info(`[联邦HTTP] 收到节点事件: ${event.type} (房间: ${event.roomId}, 来源: ${event.sourceNodeId})`);
      fm.handleIncomingEvent(event);
      return res.json({ success: true });
    });

    // === 管理接口 ===

    // 联邦状态查询（管理员用）
    this.app.get('/api/federation/status', this.adminAuth.bind(this), (_req, res) => {
      return res.json(fm.getStatus());
    });

    // 手动添加联邦节点（管理员用）
    this.app.post('/api/federation/add-node', this.adminAuth.bind(this), async (req, res) => {
      const { nodeUrl } = req.body;
      if (!nodeUrl) {
        return res.status(400).json({ error: 'Missing nodeUrl' });
      }

      const success = await fm.handshakeWithNode(nodeUrl);
      return res.json({ success });
    });

    // 手动移除联邦节点（管理员用）
    this.app.post('/api/federation/remove-node', this.adminAuth.bind(this), (req, res) => {
      const { nodeId } = req.body;
      if (!nodeId) {
        return res.status(400).json({ error: 'Missing nodeId' });
      }

      fm.removeNode(nodeId);
      return res.json({ success: true });
    });

    this.logger.info(`[联邦] 已注册 ${fm.getConfig().enabled ? '启用' : '未启用'} 的联邦 HTTP 路由`);
  }

  public getInternalServer(): Server {
    return this.server;
  }

  public getSessionParser(): express.RequestHandler {
    return this.sessionParser;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.webPort, () => {
        this.logger.info(`HTTP 服务器已启动，端口：${this.config.webPort}`);
        resolve();
      });

      this.server.on('error', (error) => {
        this.logger.error(`HTTP 服务器错误: ${error}`);
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    clearInterval(this.cleanupInterval);
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('HTTP 服务器已停止');
        resolve();
      });
    });
  }

  private serveHtmlWithConfig(res: express.Response, filePath: string): void {
    try {
        if (!fs.existsSync(filePath)) {
            res.status(404).send('File not found');
            return;
        }
        let html = fs.readFileSync(filePath, 'utf8');
        const configScript = `
        <script>
          window.SERVER_CONFIG = {
              captchaProvider: ${JSON.stringify(this.config.captchaProvider)},
              geetestId: ${JSON.stringify(this.config.geetestId)},
              displayIp: ${JSON.stringify(this.config.displayIp)},
              defaultAvatar: ${JSON.stringify(this.config.defaultAvatar)},
              serverName: ${JSON.stringify(this.config.serverName)}
          };
        </script>`;
        html = html.replace('</head>', `${configScript}</head>`);
        res.send(html);
    } catch (err) {
        this.logger.error(`读取 HTML 文件失败 (${filePath}): ${err}`);
        res.status(500).send('Internal Server Error');
    }
  }
}