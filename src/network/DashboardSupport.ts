import express from 'express';
import fs from 'fs';
import path from 'path';
import session, { SessionData } from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { Logger } from '../logging/logger';
import { ServerConfig } from '../config/config';
import { RoomManager } from '../domain/rooms/RoomManager';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BanManager } from '../domain/auth/BanManager';
import { FederationManager } from '../federation/FederationManager';
import { version } from '../../package.json';

interface AdminSession extends SessionData {
  isAdmin?: boolean;
}

interface LoginAttempt {
  count: number;
  lastAttempt: number;
}

