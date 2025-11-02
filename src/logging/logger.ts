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

const COLOR_CODES: Record<string, string> = {
  RESET: '\x1b[0m',
  DEBUG: '\x1b[90m', // 灰色
  INFO: '\x1b[32m',  // 绿色
  WARN: '\x1b[33m',  // 黄色
  ERROR: '\x1b[31m', // 红色
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
    if (metadata && Object.keys(metadata).length > 0) {
      console.info(this.formatMessage('INFO', message), metadata);
    } else {
      console.info(this.formatMessage('INFO', message));
    }
  }

  warn(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('warn')) {
      return;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      console.warn(this.formatMessage('WARN', message), metadata);
    } else {
      console.warn(this.formatMessage('WARN', message));
    }
  }

  error(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('error')) {
      return;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      console.error(this.formatMessage('ERROR', message), metadata);
    } else {
      console.error(this.formatMessage('ERROR', message));
    }
  }

  debug(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('debug')) {
      return;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      console.debug(this.formatMessage('DEBUG', message), metadata);
    } else {
      console.debug(this.formatMessage('DEBUG', message));
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minimumLevel];
  }

  private formatMessage(level: string, message: any): string {
    const timestamp = new Date().toISOString();
    let color = COLOR_CODES.RESET;
    if (level === 'DEBUG') color = COLOR_CODES.DEBUG;
    else if (level === 'INFO') color = COLOR_CODES.INFO;
    else if (level === 'WARN') color = COLOR_CODES.WARN;
    else if (level === 'ERROR') color = COLOR_CODES.ERROR;

    let msgStr = '';
    if (
      message === undefined ||
      message === null ||
      (typeof message === 'string' && message.trim() === '') ||
      (typeof message === 'object' && Object.keys(message).length === 0)
    ) {
      msgStr = '';
    } else if (typeof message === 'object') {
      msgStr = JSON.stringify(message);
    } else {
      msgStr = message;
    }

    return msgStr
      ? `[${timestamp}]${color}[${this.context}][${level}] ${msgStr}${COLOR_CODES.RESET}`
      : `[${timestamp}]${color}[${this.context}][${level}]${COLOR_CODES.RESET}`;
  }
}
