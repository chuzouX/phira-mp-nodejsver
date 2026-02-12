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
            // Fallback to hardcoded
        }
    }

    if (!defaultEnv) {
        defaultEnv = `# 游戏服务器配置
PORT=12346
HOST=0.0.0.0
TCP_ENABLED=true
USE_PROXY_PROTOCOL=false
TRUST_PROXY_HOPS=1
LOG_LEVEL=info
NODE_ENV=development
PHIRA_API_URL=https://phira.5wyxi.com
SERVER_NAME=Server
ROOM_SIZE=8
SERVER_ANNOUNCEMENT="你好{{name}}，欢迎来到 {{serverName}} 服务器"

# web服务器配置
WEB_PORT=8080
ENABLE_WEB_SERVER=true
DISPLAY_IP=phira.funxlink.fun:19723
DEFAULT_AVATAR=https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404
SESSION_SECRET=a-very-insecure-secret-change-it
LOGIN_BLACKLIST_DURATION=600
# Enable automatic update checking on startup
ENABLE_UPDATE_CHECK=true

# Admin Credentials for /panel
ADMIN_NAME=admin
ADMIN_PASSWORD=password
ADMIN_SECRET=
ADMIN_PHIRA_ID=
OWNER_PHIRA_ID=
BAN_ID_WHITELIST=
BAN_IP_WHITELIST=
SILENT_PHIRA_IDS=

# 房间发现过滤
ENABLE_PUB_WEB=false
PUB_PREFIX=pub
ENABLE_PRI_WEB=false
PRI_PREFIX=sm

# 验证码配置 (geetest / none)
CAPTCHA_PROVIDER=none
GEETEST_ID=
GEETEST_KEY=

# 联邦服务器配置 (多服无中心化联动)
FEDERATION_ENABLED=false
FEDERATION_SEED_NODES=
FEDERATION_SECRET=
FEDERATION_NODE_URL=
FEDERATION_NODE_ID=
FEDERATION_ALLOW_LOCAL=false
FEDERATION_HEALTH_INTERVAL=30000
FEDERATION_SYNC_INTERVAL=15000
`;
    }

    fs.writeFileSync(envPath, defaultEnv, 'utf8');
    console.log('✅ 已自动生成默认 .env 配置文件');
  }
};

// 执行环境初始化
ensureEnvFile();

// 只在开发环境加载 .env 文件
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  dotenv.config();
  console.log('✅ 开发环境：已从 .env 加载配置');
} else {
  // 生产环境（包括打包后）也尝试加载同级目录的 .env
  const dotenv = require('dotenv');
  dotenv.config();
  console.log('✅ 运行环境：已加载外部 .env 配置');
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
  enablePubWeb: boolean;
  pubPrefix: string;
  enablePriWeb: boolean;
  priPrefix: string;
  useProxyProtocol: boolean;
  protocol: ProtocolOptions;
  logging: LoggingOptions;
  phiraApiUrl: string;
  serverName: string;
  roomSize: number;
  adminName: string;
  adminPassword: string;
  adminSecret: string;
  adminPhiraId: number[];
  ownerPhiraId: number[];
  banIdWhitelist: number[];
  banIpWhitelist: string[];
  silentPhiraIds: number[];
  serverAnnouncement: string;
  sessionSecret: string;
  loginBlacklistDuration: number;
  displayIp: string;
  defaultAvatar: string;
  enableUpdateCheck: boolean;
  trustProxyHops: number;
  captchaProvider: 'geetest' | 'none';
  geetestId?: string;
  geetestKey?: string;
  // 联邦节点配置
  federationEnabled: boolean;
  federationSeedNodes: string[];
  federationSecret: string;
  federationNodeId: string;
  federationNodeUrl: string;
  federationHealthInterval: number;
  federationSyncInterval: number;
  federationAllowLocal: boolean;
}

const defaultConfig: ServerConfig = {
  port: 12346,
  host: '0.0.0.0',
  webPort: 8080,
  enableWebServer: true,
  enablePubWeb: false,
  pubPrefix: 'pub',
  enablePriWeb: false,
  priPrefix: 'sm',
  useProxyProtocol: false,
  protocol: {
    tcp: true,
  },
  logging: {
    level: 'info',
  },
  phiraApiUrl: 'https://phira.5wyxi.com',
  serverName: 'Server',
  roomSize: 8,
  adminName: 'admin',
  adminPassword: 'password',
  adminSecret: '',
  adminPhiraId: [],
  ownerPhiraId: [],
  banIdWhitelist: [],
  banIpWhitelist: [],
  silentPhiraIds: [],
  serverAnnouncement: `你好{{name}}，欢迎来到 {{serverName}} 服务器`,
  sessionSecret: 'a-very-insecure-secret-change-it',
  loginBlacklistDuration: 600, // 10 minutes
  displayIp: 'phira.funxlink.fun:19723',
  defaultAvatar: 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404',
  enableUpdateCheck: true,
  trustProxyHops: 1,
  captchaProvider: 'none',
  // 联邦节点配置
  federationEnabled: false,
  federationSeedNodes: [],
  federationSecret: '',
  federationNodeId: '',
  federationNodeUrl: '',
  federationHealthInterval: 30000,
  federationSyncInterval: 15000,
  federationAllowLocal: false,
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseNumberList = (value: string | undefined, fallback: number[]): number[] => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
};

// 导出环境变量配置（统一接口）
export const env = {
  // 服务器配置
  port: parseInt(process.env.PORT || '12346', 10),
  host: process.env.HOST || '0.0.0.0',
  webPort: parseInt(process.env.WEB_PORT || '8080', 10),
  enableWebServer: parseBoolean(process.env.ENABLE_WEB_SERVER, true),
  useProxyProtocol: parseBoolean(process.env.USE_PROXY_PROTOCOL, false),
  
  // 验证码配置
  captchaProvider: (process.env.CAPTCHA_PROVIDER || 'none').toLowerCase() as 'geetest' | 'none',

  // 房间过滤配置
  enablePubWeb: parseBoolean(process.env.ENABLE_PUB_WEB, false),
  pubPrefix: process.env.PUB_PREFIX || 'pub',
  enablePriWeb: parseBoolean(process.env.ENABLE_PRI_WEB, false),
  priPrefix: process.env.PRI_PREFIX || 'sm',

  roomSize: parseInt(process.env.ROOM_SIZE || '8', 10),
  
  // Admin
  adminName: process.env.ADMIN_NAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'password',
  adminSecret: process.env.ADMIN_SECRET || '',
  adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, []),
  ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, []),
  banIdWhitelist: parseNumberList(process.env.BAN_ID_WHITELIST, []),
  banIpWhitelist: (process.env.BAN_IP_WHITELIST || '').split(',').map(s => s.trim()).filter(s => s !== ''),
  silentPhiraIds: parseNumberList(process.env.SILENT_PHIRA_IDS, []),
  sessionSecret: process.env.SESSION_SECRET || 'a-very-insecure-secret-change-it',
  loginBlacklistDuration: parseInt(process.env.LOGIN_BLACKLIST_DURATION || '600', 10),
  
  // Phira API
  phiraApiUrl: process.env.PHIRA_API_URL || 'https://phira.5wyxi.com',
  
  // 协议配置
  tcpEnabled: parseBoolean(process.env.TCP_ENABLED, true),
  
  // 日志配置
  logLevel: process.env.LOG_LEVEL || 'info',

  // Server Name
  serverName: process.env.SERVER_NAME || 'Server',
  
  // 联邦节点
  federationEnabled: parseBoolean(process.env.FEDERATION_ENABLED, false),
  federationSeedNodes: (process.env.FEDERATION_SEED_NODES || '').split(',').map(s => s.trim()).filter(s => s !== ''),
  federationSecret: process.env.FEDERATION_SECRET || '',
  federationNodeId: process.env.FEDERATION_NODE_ID || '',
  federationNodeUrl: process.env.FEDERATION_NODE_URL || '',
  federationHealthInterval: parseInt(process.env.FEDERATION_HEALTH_INTERVAL || '30000', 10),
  federationSyncInterval: parseInt(process.env.FEDERATION_SYNC_INTERVAL || '15000', 10),

  // 环境
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

// 验证必需的环境变量（当前暂时没有必需变量）
const requiredEnvVars: string[] = [];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`缺少必需的环境变量: ${varName}`);
  }
}

export const createServerConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => {
  const envConfig: ServerConfig = {
    port: Number.parseInt(process.env.PORT ?? `${defaultConfig.port}`, 10),
    host: process.env.HOST ?? defaultConfig.host,
    webPort: Number.parseInt(process.env.WEB_PORT ?? `${defaultConfig.webPort}`, 10),
    enableWebServer: parseBoolean(process.env.ENABLE_WEB_SERVER, defaultConfig.enableWebServer),
    enablePubWeb: parseBoolean(process.env.ENABLE_PUB_WEB, defaultConfig.enablePubWeb),
    pubPrefix: process.env.PUB_PREFIX ?? defaultConfig.pubPrefix,
    enablePriWeb: parseBoolean(process.env.ENABLE_PRI_WEB, defaultConfig.enablePriWeb),
    priPrefix: process.env.PRI_PREFIX ?? defaultConfig.priPrefix,
    useProxyProtocol: parseBoolean(process.env.USE_PROXY_PROTOCOL, defaultConfig.useProxyProtocol),
    protocol: {
      tcp: parseBoolean(process.env.TCP_ENABLED, defaultConfig.protocol.tcp),
    },
    logging: {
      level: process.env.LOG_LEVEL ?? defaultConfig.logging.level,
    },
    phiraApiUrl: process.env.PHIRA_API_URL ?? defaultConfig.phiraApiUrl,
    serverName: process.env.SERVER_NAME ?? defaultConfig.serverName,
    roomSize: Number.parseInt(process.env.ROOM_SIZE ?? `${defaultConfig.roomSize}`, 10),
    adminName: process.env.ADMIN_NAME ?? defaultConfig.adminName,
    adminPassword: process.env.ADMIN_PASSWORD ?? defaultConfig.adminPassword,
    adminSecret: process.env.ADMIN_SECRET ?? defaultConfig.adminSecret,
    adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, defaultConfig.adminPhiraId),
    ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, defaultConfig.ownerPhiraId),
    banIdWhitelist: parseNumberList(process.env.BAN_ID_WHITELIST, defaultConfig.banIdWhitelist),
    banIpWhitelist: (process.env.BAN_IP_WHITELIST || '').split(',').map(s => s.trim()).filter(s => s !== ''),
    silentPhiraIds: parseNumberList(process.env.SILENT_PHIRA_IDS, defaultConfig.silentPhiraIds),
    serverAnnouncement: process.env.SERVER_ANNOUNCEMENT ?? defaultConfig.serverAnnouncement,
    sessionSecret: process.env.SESSION_SECRET ?? defaultConfig.sessionSecret,
    loginBlacklistDuration: Number.parseInt(process.env.LOGIN_BLACKLIST_DURATION ?? `${defaultConfig.loginBlacklistDuration}`, 10),
    displayIp: process.env.DISPLAY_IP ?? defaultConfig.displayIp,
    defaultAvatar: process.env.DEFAULT_AVATAR ?? defaultConfig.defaultAvatar,
    enableUpdateCheck: parseBoolean(process.env.ENABLE_UPDATE_CHECK, defaultConfig.enableUpdateCheck),
    trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? `${defaultConfig.trustProxyHops}`, 10),
    captchaProvider: (process.env.CAPTCHA_PROVIDER || 'none').toLowerCase() as  'geetest' | 'none',
    geetestId: process.env.GEETEST_ID,
    geetestKey: process.env.GEETEST_KEY,
    // 联邦节点
    federationEnabled: parseBoolean(process.env.FEDERATION_ENABLED, defaultConfig.federationEnabled),
    federationSeedNodes: (process.env.FEDERATION_SEED_NODES || '').split(',').map(s => s.trim()).filter(s => s !== ''),
    federationSecret: process.env.FEDERATION_SECRET ?? defaultConfig.federationSecret,
    federationNodeId: process.env.FEDERATION_NODE_ID ?? defaultConfig.federationNodeId,
    federationNodeUrl: process.env.FEDERATION_NODE_URL ?? defaultConfig.federationNodeUrl,
    federationHealthInterval: Number.parseInt(process.env.FEDERATION_HEALTH_INTERVAL ?? `${defaultConfig.federationHealthInterval}`, 10),
    federationSyncInterval: Number.parseInt(process.env.FEDERATION_SYNC_INTERVAL ?? `${defaultConfig.federationSyncInterval}`, 10),
    federationAllowLocal: parseBoolean(process.env.FEDERATION_ALLOW_LOCAL, defaultConfig.federationAllowLocal),
  };

  return {
    ...envConfig,
    ...overrides,
    protocol: {
      ...envConfig.protocol,
      ...overrides.protocol,
    },
    logging: {
      ...envConfig.logging,
      ...overrides.logging,
    },
  };
};

export class ConfigService {
  private readonly config: ServerConfig;

  constructor(overrides?: Partial<ServerConfig>) {
    this.config = createServerConfig(overrides);
  }

  getConfig(): ServerConfig {
    return this.config;
  }
}
