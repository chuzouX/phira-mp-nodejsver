/*
 * MIT License
 * Copyright (c) 2024
 */

// 只在开发环境加载 .env 文件
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  const result = dotenv.config();
  
  if (result.error) {
    console.error('加载 .env 文件失败:', result.error);
  } else {
    console.log('✅ 开发环境：已从 .env 加载配置');
  }
} else {
  console.log('✅ 生产环境：使用系统环境变量');
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
  protocol: ProtocolOptions;
  logging: LoggingOptions;
  phiraApiUrl: string;
  serverName: string;
  roomSize: number;
  adminName: string;
  adminPassword: string;
  adminPhiraId: number[];
  ownerPhiraId: number[];
  sessionSecret: string;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
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
  adminPhiraId: [],
  ownerPhiraId: [],
  sessionSecret: 'a-very-insecure-secret-change-it',
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
  
  // 房间过滤配置
  enablePubWeb: parseBoolean(process.env.ENABLE_PUB_WEB, false),
  pubPrefix: process.env.PUB_PREFIX || 'pub',
  enablePriWeb: parseBoolean(process.env.ENABLE_PRI_WEB, false),
  priPrefix: process.env.PRI_PREFIX || 'sm',

  roomSize: parseInt(process.env.ROOM_SIZE || '8', 10),
  
  // Admin
  adminName: process.env.ADMIN_NAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'password',
  adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, []),
  ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, []),
  sessionSecret: process.env.SESSION_SECRET || 'a-very-insecure-secret-change-it',
  
  // Turnstile
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,

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
    adminPhiraId: parseNumberList(process.env.ADMIN_PHIRA_ID, defaultConfig.adminPhiraId),
    ownerPhiraId: parseNumberList(process.env.OWNER_PHIRA_ID, defaultConfig.ownerPhiraId),
    sessionSecret: process.env.SESSION_SECRET ?? defaultConfig.sessionSecret,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
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
