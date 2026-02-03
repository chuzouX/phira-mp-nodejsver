
import { Server as HttpServer } from 'http';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { Logger } from '../logging/logger';
import { RoomManager, Room, PlayerInfo } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { ServerConfig } from '../config/config';

// Define the structure of messages between client and server
interface WebSocketMessage {
  type: string;
  payload?: any;
}

export class WebSocketServer {
  private wss: WsServer;

  constructor(
    server: HttpServer,
    private readonly roomManager: RoomManager,
    private readonly protocolHandler: ProtocolHandler,
    private readonly config: ServerConfig,
    private readonly logger: Logger,
  ) {
    this.wss = new WsServer({ server });
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.logger.info('New WebSocket client connected');

      // Send the current room list immediately on connection
      try {
        const message: WebSocketMessage = {
          type: 'roomList',
          payload: this.getSanitizedRoomList(),
        };
        ws.send(JSON.stringify(message));
        
        // Send server stats
        this.sendStats(ws);
      } catch (error) {
        this.logger.error('Failed to send initial room list to WebSocket client', { error });
      }
      
      ws.on('message', (message: string) => {
        try {
          const parsedMessage: WebSocketMessage = JSON.parse(message);
          this.handleClientMessage(ws, parsedMessage);
        } catch (error) {
          this.logger.error('Failed to parse WebSocket message from client', { error, message });
        }
      });

      ws.on('close', () => {
        this.logger.info('WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error });
      });
    });
  }
  
  private handleClientMessage(ws: WebSocket, message: WebSocketMessage): void {
    this.logger.debug('Received WebSocket message', { type: message.type });
    switch (message.type) {
      case 'getRoomDetails':
        this.sendRoomDetails(ws, message.payload.roomId);
        break;
      default:
        this.logger.warn('Received unknown WebSocket message type', { type: message.type });
    }
  }

  private sendRoomDetails(ws: WebSocket, roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    
    // Check access logic similar to list filtering for security/consistency
    if (room) {
        let isVisible = true;
        if (this.config.enablePubWeb) {
            if (!room.id.startsWith(this.config.pubPrefix)) isVisible = false;
        } else if (this.config.enablePriWeb) {
            if (room.id.startsWith(this.config.priPrefix)) isVisible = false;
        }

        if (!isVisible) {
             const message: WebSocketMessage = {
                type: 'roomDetails',
                payload: null, // Treat hidden rooms as non-existent for web users
            };
            ws.send(JSON.stringify(message));
            return;
        }

      const details = this.getSanitizedRoomDetails(room);
      const message: WebSocketMessage = {
        type: 'roomDetails',
        payload: details,
      };
      ws.send(JSON.stringify(message));
    } else {
      const message: WebSocketMessage = {
        type: 'roomDetails',
        payload: null, // Or an error object
      };
      ws.send(JSON.stringify(message));
      this.logger.warn(`Client requested details for non-existent room: ${roomId}`);
    }
  }

  private getSanitizedRoomList(): Partial<Room>[] {
    return this.roomManager.listRooms()
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
        const owner = room.players.get(room.ownerId);
        return {
            id: room.id,
            name: room.name,
            ownerId: room.ownerId,
            ownerName: owner ? owner.user.name : 'Unknown',
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            state: room.state,
            locked: room.locked,
            cycle: room.cycle,
        };
      });
  }

  private getSanitizedRoomDetails(room: Room) {
    const players = Array.from(room.players.values()).map(p => ({
        id: p.user.id,
        name: p.user.name,
        avatar: p.avatar,
        isReady: p.isReady,
        isFinished: p.isFinished,
        score: p.score,
        isAdmin: this.config.adminPhiraId.includes(p.user.id),
        isOwner: this.config.ownerPhiraId.includes(p.user.id),
    }));

    // Add Server user manually as it's not in room.players
    players.unshift({
        id: -1,
        name: this.config.serverName,
        avatar: 'https://api.phira.cn/files/6ad662de-b505-4725-a7ef-72d65f32b404',
        isReady: false,
        isFinished: false,
        score: null,
        isAdmin: false,
        isOwner: false,
    });

    return {
        id: room.id,
        name: room.name,
        ownerId: room.ownerId,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        state: room.state,
        locked: room.locked,
        selectedChart: room.selectedChart,
        lastGameChart: room.lastGameChart,
        messages: room.messages.map(m => {
            const userId = (m as any).user;
            let userName = '';
            if (userId !== undefined) {
                const user = room.players.get(userId);
                userName = userId === -1 ? this.config.serverName : (user ? user.user.name : `ID: ${userId}`);
            }
            return {
                ...m,
                userName
            };
        }),
        players: players,
        otherRooms: this.roomManager.listRooms()
            .filter(r => r.id !== room.id)
            .map(r => ({
                id: r.id,
                name: r.name,
                playerCount: r.players.size,
                maxPlayers: r.maxPlayers,
                state: r.state
            })),
    };
  }

  public broadcastRooms(): void {
    this.logger.debug('Broadcasting room list to all WebSocket clients');
    const message: WebSocketMessage = {
      type: 'roomList',
      payload: this.getSanitizedRoomList(),
    };
    const serializedMessage = JSON.stringify(message);

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serializedMessage, (error) => {
          if (error) {
            this.logger.error('Failed to broadcast room list to a client', { error });
          }
        });
      }
    });
  }

  public broadcastStats(): void {
    const stats = {
      totalPlayers: this.protocolHandler.getSessionCount(),
    };
    const message: WebSocketMessage = {
      type: 'serverStats',
      payload: stats,
    };
    const serializedMessage = JSON.stringify(message);

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serializedMessage, (error) => {
          if (error) {
            this.logger.error('Failed to broadcast server stats to a client', { error });
          }
        });
      }
    });
  }

  private sendStats(ws: WebSocket): void {
    const stats = {
      totalPlayers: this.protocolHandler.getSessionCount(),
    };
    const message: WebSocketMessage = {
      type: 'serverStats',
      payload: stats,
    };
    ws.send(JSON.stringify(message));
  }
}
