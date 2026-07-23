/*
 * MIT License
 * Copyright (c) 2024
 */

import * as fs from 'fs';
import * as path from 'path';

const ensureEnvFile = () => {
  const envPath = path.join(process.cwd(), '.env');
  const examplePath = path.join(process.cwd(), '.env.example');

  if (!fs.existsSync(envPath)) {
    let defaultEnv = '';

    if (fs.existsSync(examplePath)) {
      try {
        defaultEnv = fs.readFileSync(examplePath, 'utf8');
      } catch (e) {
        // Fallback
      }
    }

    if (!defaultEnv) {
      defaultEnv = `# Game Server Configuration
PORT=12346
HOST=0.0.0.0
TCP_ENABLED=true
USE_PROXY_PROTOCOL=false
# Proxy trust hops (1 for Nginx, 2 for CDN+Nginx)
TRUST_PROXY_HOPS=1
LOG_LEVEL=info
# WARNING: Set to production for public servers, otherwise virtual auth (stress_ token) remains active
NODE_ENV=development
PHIRA_API_URL=https://phira.5wyxi.com
SERVER_NAME=Server
ROOM_SIZE=8
SERVER_ANNOUNCEMENT="Hello {{name}}, welcome to {{serverName}} server"

# Web Host Configuration
WEB_PORT=8080
ENABLE_WEB_SERVER=false
DEFAULT_AVATAR=https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404
ENABLE_PUB_WEB=false
PUB_PREFIX=pub
ENABLE_PRI_WEB=false
PRI_PREFIX=sm
# Enable automatic update checking on startup
ENABLE_UPDATE_CHECK=true

# Admin Credentials
ADMIN_PHIRA_ID=
OWNER_PHIRA_ID=
BAN_ID_WHITELIST=
BAN_IP_WHITELIST=
SILENT_PHIRA_IDS=

# Plugin System
PLUGINS_ENABLED=true
`;
    }

    fs.writeFileSync(envPath, defaultEnv, 'utf8');
    console.log('Env file generated.');
  }
};

ensureEnvFile();

if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  dotenv.config();
} else {
  const dotenv = require('dotenv');
  dotenv.config();
}

export interface ServerConfig {
  port: number;
  host: string;
  webPort: number;
  enableWebServer: boolean;
  useProxyProtocol: boolean;
  protocol: { tcp: boolean };
  logging: { level: string };
  phiraApiUrl: string;
  serverName: string;
  roomSize: number;
  adminPhiraId: number[];
  ownerPhiraId: number[];
  banIdWhitelist: number[];
  banIpWhitelist: string[];
  silentPhiraIds: number[];
  serverAnnouncement: string;
  defaultAvatar: string;
  enableUpdateCheck: boolean;
  trustProxyHops: number;
  pluginsEnabled: boolean;
  enablePubWeb: boolean;
  pubPrefix: string;
  enablePriWeb: boolean;
  priPrefix: string;
  sessionSecret?: string;
  loginBlacklistDuration?: number;
  displayIp?: string;
  allowedOrigins?: string[];
  captchaProvider?: 'geetest' | 'none';
  geetestId?: string;
  geetestKey?: string;
}

const defaultConfig: ServerConfig = {
  port: 12346,
  host: '0.0.0.0',
  webPort: 8080,
  enableWebServer: false,
  useProxyProtocol: false,
  protocol: { tcp: true },
  logging: { level: 'info' },
  phiraApiUrl: 'https://phira.5wyxi.com',
  serverName: 'Server',
  roomSize: 8,
  adminPhiraId: [],
  ownerPhiraId: [],
  banIdWhitelist: [],
  banIpWhitelist: [],
  silentPhiraIds: [],
  serverAnnouncement: 'Hello {{name}}, welcome to {{serverName}} server',
  defaultAvatar: 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404',
  enableUpdateCheck: true,
  trustProxyHops: 1,
  enablePubWeb: false,
  pubPrefix: 'pub',
  enablePriWeb: false,
  priPrefix: 'sm',
  pluginsEnabled: true,
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseNumberList = (value: string | undefined, fallback: number[]): number[] => {
  if (value === undefined || value.trim() === '') return fallback;
  return value
    .split(/[,，]/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
};

export const createServerConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => {
  const envConfig: ServerConfig = {
    port: Number.parseInt(process.env.PORT ?? `${defaultConfig.port}`, 10),
    host: process.env.HOST ?? defaultConfig.host,
    webPort: Number.parseInt(process.env.WEB_PORT ?? `${defaultConfig.webPort}`, 10),
    enableWebServer: parseBoolean(process.env.ENABLE_WEB_SERVER, defaultConfig.enableWebServer),
    useProxyProtocol: parseBoolean(process.env.USE_PROXY_PROTOCOL, defaultConfig.useProxyProtocol),
    protocol: { tcp: parseBoolean(process.env.TCP_ENABLED, defaultConfig.protocol.tcp) },
    logging: { level: process.env.LOG_LEVEL ?? defaultConfig.logging.level },
    phiraApiUrl: process.env.PHIRA_API_URL ?? defaultConfig.phiraApiUrl,
    serverName: process.env.SERVER_NAME ?? defaultConfig.serverName,
    roomSize: Number.parseInt(process.env.ROOM_SIZE ?? `${defaultConfig.roomSize}`, 10),
    enablePubWeb: parseBoolean(process.env.ENABLE_PUB_WEB, defaultConfig.enablePubWeb),
    pubPrefix: process.env.PUB_PREFIX ?? defaultConfig.pubPrefix,
    enablePriWeb: parseBoolean(process.env.ENABLE_PRI_WEB, defaultConfig.enablePriWeb),
    priPrefix: process.env.PRI_PREFIX ?? defaultConfig.priPrefix,
    adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, defaultConfig.adminPhiraId),
    ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, defaultConfig.ownerPhiraId),
    banIdWhitelist: parseNumberList(process.env.BAN_ID_WHITELIST, defaultConfig.banIdWhitelist),
    banIpWhitelist: (process.env.BAN_IP_WHITELIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    silentPhiraIds: parseNumberList(process.env.SILENT_PHIRA_IDS, defaultConfig.silentPhiraIds),
    serverAnnouncement: process.env.SERVER_ANNOUNCEMENT ?? defaultConfig.serverAnnouncement,
    defaultAvatar: process.env.DEFAULT_AVATAR ?? defaultConfig.defaultAvatar,
    enableUpdateCheck: parseBoolean(
      process.env.ENABLE_UPDATE_CHECK,
      defaultConfig.enableUpdateCheck,
    ),
    trustProxyHops: Number.parseInt(
      process.env.TRUST_PROXY_HOPS ?? `${defaultConfig.trustProxyHops}`,
      10,
    ),
    pluginsEnabled: parseBoolean(process.env.PLUGINS_ENABLED, defaultConfig.pluginsEnabled),
  };

  const config: ServerConfig = {
    ...envConfig,
    ...overrides,
    protocol: { ...envConfig.protocol, ...overrides.protocol },
    logging: { ...envConfig.logging, ...overrides.logging },
  };

  // Owner is the highest role and always inherits every Admin permission.
  config.adminPhiraId = Array.from(new Set([...config.adminPhiraId, ...config.ownerPhiraId]));

  return config;
};

export class ConfigService {
  private config: ServerConfig;
  constructor(overrides?: Partial<ServerConfig>) {
    this.config = createServerConfig(overrides);
  }
  getConfig(): ServerConfig {
    return this.config;
  }

  public updateAdminPhiraIds(ids: number[]): void {
    this.config.adminPhiraId = Array.from(new Set([...ids, ...this.config.ownerPhiraId]));
    this.saveConfigToFile('ADMIN_PHIRA_ID', ids.join(','));
  }

  public saveConfigToFile(key: string, value: string): void {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;

    try {
      let content = fs.readFileSync(envPath, 'utf8');
      const regex = new RegExp(`^${key}=.*`, 'm');

      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }

      fs.writeFileSync(envPath, content, 'utf8');
    } catch (err) {
      console.error(`Failed to save config to .env: ${err}`);
    }
  }

  reloadConfig(): ServerConfig {
    const dotenv = require('dotenv');
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
    }

    const newConfig = createServerConfig();

    // Update existing object properties so references remain valid
    Object.assign(this.config, newConfig);

    return this.config;
  }
}
