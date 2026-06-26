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
ADMIN_SECRET=
ADMIN_PHIRA_ID=
OWNER_PHIRA_ID=
BAN_ID_WHITELIST=
BAN_IP_WHITELIST=
SILENT_PHIRA_IDS=

# Federation Configuration
FEDERATION_ENABLED=false
FEDERATION_SEED_NODES=
FEDERATION_SECRET=
FEDERATION_NODE_URL=
FEDERATION_NODE_ID=
FEDERATION_ALLOW_LOCAL=false
FEDERATION_HEALTH_INTERVAL=300
FEDERATION_SYNC_INTERVAL=150
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

export interface ProtocolOptions {
  tcp: boolean;
}

export interface LoggingOptions {
  level: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  webPort: number;
  enableWebServer: boolean;
  useProxyProtocol: boolean;
  protocol: ProtocolOptions;
  logging: LoggingOptions;
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
  federationEnabled: boolean;
  federationSeedNodes: string[];
  federationSecret: string;
  federationNodeId: string;
  federationNodeUrl: string;
  federationHealthInterval: number;
  federationSyncInterval: number;
  federationAllowLocal: boolean;
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
  federationEnabled: false,
  federationSeedNodes: [],
  federationSecret: '',
  federationNodeId: '',
  federationNodeUrl: '',
  federationHealthInterval: 300,
  federationSyncInterval: 150,
  federationAllowLocal: false,
  pluginsEnabled: true,
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseNumberList = (value: string | undefined, fallback: number[]): number[] => {
  if (value === undefined || value.trim() === '') return fallback;
  return value.split(/[,，]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
};

const parseStringList = (value: string | undefined, fallback: string[]): string[] => {
  if (value === undefined || value.trim() === '') return fallback;
  return value.split(/[,，]/).map(s => s.trim()).filter(s => s !== '');
};

export const env = {
  port: parseInt(process.env.PORT || '12346', 10),
  host: process.env.HOST || '0.0.0.0',
  webPort: parseInt(process.env.WEB_PORT || '8080', 10),
  enableWebServer: parseBoolean(process.env.ENABLE_WEB_SERVER, false),
  useProxyProtocol: parseBoolean(process.env.USE_PROXY_PROTOCOL, false),
  roomSize: parseInt(process.env.ROOM_SIZE || '8', 10),
  enablePubWeb: parseBoolean(process.env.ENABLE_PUB_WEB, false),
  pubPrefix: process.env.PUB_PREFIX || 'pub',
  enablePriWeb: parseBoolean(process.env.ENABLE_PRI_WEB, false),
  priPrefix: process.env.PRI_PREFIX || 'sm',
  adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, []),
  ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, []),
  banIdWhitelist: parseNumberList(process.env.BAN_ID_WHITELIST, []),
  banIpWhitelist: (process.env.BAN_IP_WHITELIST || '').split(',').map(s => s.trim()).filter(s => s !== ''),
  silentPhiraIds: parseNumberList(process.env.SILENT_PHIRA_IDS, []),
  phiraApiUrl: process.env.PHIRA_API_URL || 'https://phira.5wyxi.com',
  tcpEnabled: parseBoolean(process.env.TCP_ENABLED, true),
  logLevel: process.env.LOG_LEVEL || 'info',
  serverName: process.env.SERVER_NAME || 'Server',
  federationEnabled: parseBoolean(process.env.FEDERATION_ENABLED, false),
  federationSeedNodes: parseStringList(process.env.FEDERATION_SEED_NODES, []),
  federationSecret: process.env.FEDERATION_SECRET || '',
  federationNodeId: process.env.FEDERATION_NODE_ID || '',
  federationNodeUrl: process.env.FEDERATION_NODE_URL || '',
  federationHealthInterval: parseInt(process.env.FEDERATION_HEALTH_INTERVAL || '300', 10),
  federationSyncInterval: parseInt(process.env.FEDERATION_SYNC_INTERVAL || '150', 10),
  pluginsEnabled: parseBoolean(process.env.PLUGINS_ENABLED, true),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

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
    banIpWhitelist: (process.env.BAN_IP_WHITELIST || '').split(',').map(s => s.trim()).filter(s => s !== ''),
    silentPhiraIds: parseNumberList(process.env.SILENT_PHIRA_IDS, defaultConfig.silentPhiraIds),
    serverAnnouncement: process.env.SERVER_ANNOUNCEMENT ?? defaultConfig.serverAnnouncement,
    defaultAvatar: process.env.DEFAULT_AVATAR ?? defaultConfig.defaultAvatar,
    enableUpdateCheck: parseBoolean(process.env.ENABLE_UPDATE_CHECK, defaultConfig.enableUpdateCheck),
    trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? `${defaultConfig.trustProxyHops}`, 10),
    federationEnabled: parseBoolean(process.env.FEDERATION_ENABLED, defaultConfig.federationEnabled),
    federationSeedNodes: parseStringList(process.env.FEDERATION_SEED_NODES, defaultConfig.federationSeedNodes),
    federationSecret: process.env.FEDERATION_SECRET ?? defaultConfig.federationSecret,
    federationNodeId: process.env.FEDERATION_NODE_ID ?? defaultConfig.federationNodeId,
    federationNodeUrl: process.env.FEDERATION_NODE_URL ?? defaultConfig.federationNodeUrl,
    federationHealthInterval: Number.parseInt(process.env.FEDERATION_HEALTH_INTERVAL ?? `${defaultConfig.federationHealthInterval}`, 10),
    federationSyncInterval: Number.parseInt(process.env.FEDERATION_SYNC_INTERVAL ?? `${defaultConfig.federationSyncInterval}`, 10),
    federationAllowLocal: parseBoolean(process.env.FEDERATION_ALLOW_LOCAL, defaultConfig.federationAllowLocal),
    pluginsEnabled: parseBoolean(process.env.PLUGINS_ENABLED, defaultConfig.pluginsEnabled),
  };

  return {
    ...envConfig,
    ...overrides,
    protocol: { ...envConfig.protocol, ...overrides.protocol },
    logging: { ...envConfig.logging, ...overrides.logging },
  };
};

export class ConfigService {
  private config: ServerConfig;
  constructor(overrides?: Partial<ServerConfig>) {
    this.config = createServerConfig(overrides);
  }
  getConfig(): ServerConfig { return this.config; }

  public updateAdminPhiraIds(ids: number[]): void {
    this.config.adminPhiraId = ids;
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
