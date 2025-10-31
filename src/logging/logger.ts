/*
 * MIT License
 * Copyright (c) 2024
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const normaliseLevel = (level: string | undefined): LogLevel => {
  const candidate = level?.toLowerCase();
  if (candidate === 'debug' || candidate === 'info' || candidate === 'warn' || candidate === 'error') {
    return candidate;
  }

  return 'info';
};

export class ConsoleLogger implements Logger {
  private readonly minimumLevel: LogLevel;

  constructor(private readonly context: string = 'app', level: string | undefined = 'info') {
    this.minimumLevel = normaliseLevel(level);
  }

  info(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('info')) {
      return;
    }

    console.info(this.formatMessage('INFO', message), metadata);
  }

  warn(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('warn')) {
      return;
    }

    console.warn(this.formatMessage('WARN', message), metadata);
  }

  error(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('error')) {
      return;
    }

    console.error(this.formatMessage('ERROR', message), metadata);
  }

  debug(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('debug')) {
      return;
    }

    console.debug(this.formatMessage('DEBUG', message), metadata);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minimumLevel];
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.context}] [${level}] ${message}`;
  }
}
