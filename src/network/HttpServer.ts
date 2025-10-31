/*
 * MIT License
 * Copyright (c) 2024
 */

import express, { Application, Request, Response } from 'express';
import { ServerConfig } from '../config/config';
import { Logger } from '../logging/logger';
import { RoomManager } from '../domain/rooms/RoomManager';

export class HttpServer {
  private readonly app: Application;

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly roomManager: RoomManager,
  ) {
    this.app = express();
    this.registerMiddleware();
    this.registerRoutes();
  }

  getApp(): Application {
    return this.app;
  }

  private registerMiddleware(): void {
    this.app.use(express.json());

    this.app.use((req: Request, res: Response, next) => {
      void res;
      this.logger.debug('Incoming HTTP request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
      });

      next();
    });
  }

  private registerRoutes(): void {
    this.app.get('/health', (req: Request, res: Response) => {
      this.logger.debug('Health check requested', { ip: req.ip });

      res.json({
        status: 'ok',
        host: this.config.host,
        port: this.config.port,
        protocols: this.config.protocol,
        time: new Date().toISOString(),
      });
    });

    this.app.get('/api/rooms', (req: Request, res: Response) => {
      const rooms = this.roomManager.listRooms();
      this.logger.debug('Rooms requested', {
        totalRooms: rooms.length,
        ip: req.ip,
      });

      res.json({ rooms });
    });
  }
}
