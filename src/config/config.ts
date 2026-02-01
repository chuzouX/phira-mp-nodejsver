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
  protocol: ProtocolOptions;
  logging: LoggingOptions;
  phiraApiUrl: string;
}

const defaultConfig: ServerConfig = {
  port: 12346,
  host: '0.0.0.0',
  protocol: {
    tcp: true,
  },
  logging: {
    level: 'info',
  },
  phiraApiUrl: 'https://phira.5wyxi.com',
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

// 导出环境变量配置（统一接口）
export const env = {
  // 服务器配置
  port: parseInt(process.env.PORT || '12346', 10),
  host: process.env.HOST || '0.0.0.0',
  
  // Phira API
  phiraApiUrl: process.env.PHIRA_API_URL || 'https://phira.5wyxi.com',
  
  // 协议配置
  tcpEnabled: parseBoolean(process.env.TCP_ENABLED, true),
  
  // 日志配置
  logLevel: process.env.LOG_LEVEL || 'info',
  
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
    protocol: {
      tcp: parseBoolean(process.env.TCP_ENABLED, defaultConfig.protocol.tcp),
    },
    logging: {
      level: process.env.LOG_LEVEL ?? defaultConfig.logging.level,
    },
    phiraApiUrl: process.env.PHIRA_API_URL ?? defaultConfig.phiraApiUrl,
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
