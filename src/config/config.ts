/*
 * MIT License
 * Copyright (c) 2024
 */

import * as fs from 'fs';
import * as path from 'path';

const ensureEnvFile = () => {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    const defaultEnv = `# Phira Multiplayer Server Configuration

# TCP Server Port
PORT=12346
# HTTP/WS Server Port
WEB_PORT=8080
# Server Name shown in broadcast
SERVER_NAME=Server
# Enable Proxy Protocol (v2) for getting real IP behind frp/nginx
USE_PROXY_PROTOCOL=false

# Phira API Base URL
PHIRA_API_URL=https://phira.5wyxi.com

# Default Room Size
ROOM_SIZE=8

# Admin Credentials for /panel
ADMIN_NAME=admin
ADMIN_PASSWORD=password
# AES Secret for remote API access
ADMIN_SECRET=

# IDs of users to silence in logs
SILENT_PHIRA_IDS=

# Server Announcement Message
# Supports {{name}} and {{serverName}} placeholders
# Use \\n for new lines
SERVER_ANNOUNCEMENT="你好{{name}}，欢迎来到 {{serverName}} 服务器"

# Session Encryption Secret
SESSION_SECRET=a-very-insecure-secret-change-it

# Log Level (debug, info, mark, warn, error)
LOG_LEVEL=info

# Server IP displayed at the bottom of the web pages
DISPLAY_IP=phira.funxlink.fun:19723

# Captcha Provider (geetest or none)
CAPTCHA_PROVIDER=none
# GEETEST_ID=
# GEETEST_KEY=
`;
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
  captchaProvider: 'geetest' | 'none';
  geetestId?: string;
  geetestKey?: string;
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
  captchaProvider: 'none',
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
    captchaProvider: (process.env.CAPTCHA_PROVIDER || 'none').toLowerCase() as  'geetest' | 'none',
    geetestId: process.env.GEETEST_ID,
    geetestKey: process.env.GEETEST_KEY,
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
