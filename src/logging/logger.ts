/*
 * MIT License
 * Copyright (c) 2024
 */

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'mark' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, metadata?: LogMetadata): void;
  mark(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
  ban(message: string, metadata?: LogMetadata): void;
  command(message: string, metadata?: LogMetadata): void;
  setSilentIds(ids: number[]): void;
  setLevel(level: LogLevel): void;
  setAllowedLevels(levels: LogLevel[]): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  mark: 25,
  warn: 30,
  error: 40,
};

const COLOR_CODES: Record<string, string> = {
  RESET: '\x1b[0m',
  DEBUG: '\x1b[90m', // 灰色
  INFO: '\x1b[32m',  // 绿色
  MARK: '\x1b[36m',  // 青色
  BAN: '\x1b[35m',   // 紫色
  WARN: '\x1b[33m',  // 黄色
  ERROR: '\x1b[31m', // 红色
  CMD: '\x1b[36m',   // 青色 (与 MARK 相同)
};

const normaliseLevel = (level: string | undefined): LogLevel => {
  const candidate = level?.toLowerCase();
  if (candidate === 'debug' || candidate === 'info' || candidate === 'mark' || candidate === 'warn' || candidate === 'error') {
    return candidate;
  }

  return 'info';
};

export class ConsoleLogger implements Logger {
  private minimumLevel: LogLevel;
  private silentIds: number[] = [];
  private allowedLevels: Set<LogLevel> | null = null;
  private static rl: any = null;
  public static isPromptSuppressed: boolean = false;

  public static setReadline(rl: any): void {
    ConsoleLogger.rl = rl;
  }

  // Flood protection static properties
  private static messageCount = 0;
  private static isSuppressing = false;
  private static readonly THRESHOLD = 30; // Max logs per second before suppression
  private static lastResetTime = Date.now();

  constructor(private readonly context: string = 'app', level: string | undefined = 'info') {
    this.minimumLevel = normaliseLevel(level);
    
    // Ensure logs directory exists
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Initialize flood protection check if not already running
    if ((global as any).logFloodInterval === undefined) {
        (global as any).logFloodInterval = setInterval(() => {
            const now = Date.now();
            if (ConsoleLogger.isSuppressing && ConsoleLogger.messageCount < ConsoleLogger.THRESHOLD) {
                ConsoleLogger.isSuppressing = false;
                console.info(`\x1b[32m[SYSTEM] 日志输出已恢复正常 (速率: ${ConsoleLogger.messageCount} msg/s)\x1b[0m`);
            }
            ConsoleLogger.messageCount = 0;
            ConsoleLogger.lastResetTime = now;
        }, 1000);
    }
  }

  setSilentIds(ids: number[]): void {
    this.silentIds = ids;
  }

  setLevel(level: LogLevel): void {
    this.minimumLevel = level;
    this.allowedLevels = null;
  }

  setAllowedLevels(levels: LogLevel[]): void {
    this.allowedLevels = new Set(levels);
  }

  private isSilent(metadata: LogMetadata): boolean {
    const userId = metadata.userId;
    if (typeof userId === 'number' && this.silentIds.includes(userId)) {
      return true;
    }
    return false;
  }

  private checkFloodAndEmit(level: string, message: string, metadata: LogMetadata, logToConsole: boolean = true): void {
    ConsoleLogger.messageCount++;

    if (ConsoleLogger.messageCount > ConsoleLogger.THRESHOLD) {
        if (!ConsoleLogger.isSuppressing) {
            ConsoleLogger.isSuppressing = true;
            const warnMsg = `\x1b[31m[WARNING] 遭受到大量的连接/错误，暂时停止详细日志输出以保护性能 (当前速率: >${ConsoleLogger.THRESHOLD} msg/s)\x1b[0m`;
            this.emitToConsole(warnMsg);
            this.writeToFile(`[SYSTEM] [WARNING] 遭受到大量的连接/错误，暂时停止详细日志输出`);
        }
        return;
    }

    if (ConsoleLogger.isSuppressing) return;

    const formatted = this.formatMessage(level, message, metadata);
    if (logToConsole) {
        this.emitToConsole(formatted.console);
    }
    this.writeToFile(formatted.file);
  }

  private emitToConsole(text: string): void {
    if (ConsoleLogger.rl) {
        // Clear current line, move cursor to 0, print text
        process.stdout.write('\r\x1b[K'); 
        process.stdout.write(text + '\n');
        
        // Only restore prompt if not explicitly suppressed
        if (!ConsoleLogger.isPromptSuppressed) {
            ConsoleLogger.rl.prompt(true);
        }
    } else {
        console.log(text);
    }
  }

  info(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('info') || this.isSilent(metadata)) {
      return;
    }
    this.checkFloodAndEmit('INFO', message, metadata);
  }

  mark(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('mark') || this.isSilent(metadata)) {
      return;
    }
    this.checkFloodAndEmit('MARK', message, metadata);
  }

  warn(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('warn') || this.isSilent(metadata)) {
      return;
    }
    this.checkFloodAndEmit('WARN', message, metadata);
  }

  error(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('error') || this.isSilent(metadata)) {
      return;
    }
    this.checkFloodAndEmit('ERROR', message, metadata);
  }

  debug(message: string, metadata: LogMetadata = {}): void {
    if (!this.shouldLog('debug') || this.isSilent(metadata)) {
      return;
    }
    this.checkFloodAndEmit('DEBUG', message, metadata);
  }

  ban(message: string, metadata: LogMetadata = {}): void {
    // Ban logs are always logged, ignore level and silence
    const formatted = this.formatMessage('BAN', message, metadata);
    // Use MARK color for BAN logs in console
    const colorFormatted = formatted.console.replace('[BAN]', `${COLOR_CODES.MARK}[BAN]${COLOR_CODES.RESET}`);
    this.emitToConsole(colorFormatted);
    this.writeToFile(formatted.file);
    this.writeToBanFile(formatted.file);
  }

  command(message: string, metadata: LogMetadata = {}): void {
    const formatted = this.formatMessage('CMD', message, metadata);
    this.emitToConsole(formatted.console);
    this.writeToFile(formatted.file);
    this.writeToCommandFile(formatted.file);
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.allowedLevels) {
        return this.allowedLevels.has(level);
    }
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minimumLevel];
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(process.cwd(), 'logs', `server-${date}.log`);
  }

  private writeToFile(line: string): void {
    try {
      const logFile = this.getLogFilePath();
      fs.appendFileSync(logFile, line + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }

  private writeToBanFile(line: string): void {
    try {
      const logFile = path.join(process.cwd(), 'logs', 'ban.log');
      fs.appendFileSync(logFile, line + '\n');
    } catch (err) {
      console.error('Failed to write to ban log file:', err);
    }
  }

  private writeToCommandFile(line: string): void {
    try {
      const logFile = path.join(process.cwd(), 'logs', 'command.log');
      fs.appendFileSync(logFile, line + '\n');
    } catch (err) {
      console.error('Failed to write to command log file:', err);
    }
  }

  private formatMessage(level: string, message: any, metadata: LogMetadata): { console: string; file: string } {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    
    let color = COLOR_CODES.RESET;
    if (level === 'DEBUG') color = COLOR_CODES.DEBUG;
    else if (level === 'INFO') color = COLOR_CODES.INFO;
    else if (level === 'MARK') color = COLOR_CODES.MARK;
    else if (level === 'BAN') color = COLOR_CODES.BAN;
    else if (level === 'CMD') color = COLOR_CODES.CMD;
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

    const otherMetadata = { ...metadata };
    delete otherMetadata.userId;
    const metaStr = Object.keys(otherMetadata).length > 0 ? ' ' + JSON.stringify(otherMetadata) : '';
    
    return {
      console: `[${timestamp}] ${color}[${level}] ${msgStr}${metaStr}${COLOR_CODES.RESET}`,
      file: `[${timestamp}] [${level}] ${msgStr}${metaStr}`
    };
  }
}