/*
 * MIT License
 * Copyright (c) 2024
 */

import { config as loadEnvironment } from 'dotenv';

loadEnvironment();

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
  port: 3000,
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
