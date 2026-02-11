/*
 * MIT License
 * Copyright (c) 2024
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../logging/logger';

export interface BanInfo {
  target: string | number; // userId (number) or IP (string)
  reason: string;
  createdAt: number;
  expiresAt: number | null; // null for permanent
  adminName?: string;
}

export class BanManager {
  private idBans: Map<number, BanInfo> = new Map();
  private ipBans: Map<string, BanInfo> = new Map();
  private readonly idBanFile = path.join(process.cwd(), 'data', 'banidList.json');
  private readonly ipBanFile = path.join(process.cwd(), 'data', 'banipList.json');
  private idWhitelist: number[] = [];
  private ipWhitelist: string[] = [];

  constructor(private readonly logger: Logger) {
    this.ensureDataDir();
    this.loadBans();
  }

  public setWhitelists(ids: number[], ips: string[]) {
    this.idWhitelist = ids;
    this.ipWhitelist = ips;
  }

  private ensureDataDir() {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadBans() {
    try {
      if (fs.existsSync(this.idBanFile)) {
        const data = JSON.parse(fs.readFileSync(this.idBanFile, 'utf8'));
        Object.entries(data).forEach(([id, info]) => {
          this.idBans.set(Number(id), info as BanInfo);
        });
      }
      if (fs.existsSync(this.ipBanFile)) {
        const data = JSON.parse(fs.readFileSync(this.ipBanFile, 'utf8'));
        Object.entries(data).forEach(([ip, info]) => {
          this.ipBans.set(ip, info as BanInfo);
        });
      }
      this.logger.info(`已加载 ${this.idBans.size} 个用户封禁和 ${this.ipBans.size} 个 IP 封禁。`);
      this.cleanupExpiredBans();
    } catch (error) {
      this.logger.error(`加载封禁列表失败: ${error}`);
    }
  }

  private saveBans() {
    try {
      const idData = Object.fromEntries(this.idBans);
      const ipData = Object.fromEntries(this.ipBans);
      fs.writeFileSync(this.idBanFile, JSON.stringify(idData, null, 2));
      fs.writeFileSync(this.ipBanFile, JSON.stringify(ipData, null, 2));
    } catch (error) {
      this.logger.error(`保存封禁列表失败: ${error}`);
    }
  }

  public cleanupExpiredBans() {
    const now = Date.now();
    let changed = false;

    for (const [id, info] of this.idBans.entries()) {
      if (info.expiresAt && info.expiresAt < now) {
        this.idBans.delete(id);
        changed = true;
      }
    }

    for (const [ip, info] of this.ipBans.entries()) {
      if (info.expiresAt && info.expiresAt < now) {
        this.ipBans.delete(ip);
        changed = true;
      }
    }

    if (changed) {
      this.saveBans();
      this.logger.info('已清理过期的封禁条目。');
    }
  }

  public banId(userId: number, durationSeconds: number | null, reason: string, adminName?: string) {
    if (this.idWhitelist.includes(userId)) {
      this.logger.warn(`尝试封禁白名单用户 ID ${userId}，已拦截。`);
      return;
    }
    const expiresAt = durationSeconds ? Date.now() + durationSeconds * 1000 : null;
    this.idBans.set(userId, { target: userId, reason, createdAt: Date.now(), expiresAt, adminName });
    this.saveBans();
    this.logger.ban(`用户 ID ${userId} 已被 ${adminName || '未知'} 封禁。时长: ${durationSeconds ?? '永久'}, 原因: ${reason}`);
  }

  public banIp(ip: string, durationSeconds: number | null, reason: string, adminName?: string) {
    if (this.ipWhitelist.includes(ip)) {
        this.logger.warn(`尝试封禁白名单 IP ${ip}，已拦截。`);
        return;
    }
    const expiresAt = durationSeconds ? Date.now() + durationSeconds * 1000 : null;
    this.ipBans.set(ip, { target: ip, reason, createdAt: Date.now(), expiresAt, adminName });
    this.saveBans();
    this.logger.ban(`IP ${ip} 已被 ${adminName || '未知'} 封禁。时长: ${durationSeconds ?? '永久'}, 原因: ${reason}`);
  }

  public unbanId(userId: number, adminName: string = 'System') {
    if (this.idBans.delete(userId)) {
      this.saveBans();
      this.logger.ban(`用户 ID ${userId} 已被 ${adminName} 解封。`);
      return true;
    }
    return false;
  }

  public unbanIp(ip: string, adminName: string = 'System') {
    if (this.ipBans.delete(ip)) {
      this.saveBans();
      this.logger.ban(`IP ${ip} 已被 ${adminName} 解封。`);
      return true;
    }
    return false;
  }

  public getRemainingTimeStr(expiresAt: number | null): string {
    if (expiresAt === null) return '永久';
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return '已过期';
    
    const seconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天 ${hours % 24}小时`;
    if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
    return `${seconds}秒`;
  }

  public isIdBanned(userId: number): BanInfo | null {
    const info = this.idBans.get(userId);
    if (info) {
      if (info.expiresAt && info.expiresAt < Date.now()) {
        this.idBans.delete(userId);
        this.saveBans();
        return null;
      }
      return info;
    }
    return null;
  }

  public isIpBanned(ip: string): BanInfo | null {
    const info = this.ipBans.get(ip);
    if (info) {
      if (info.expiresAt && info.expiresAt < Date.now()) {
        this.ipBans.delete(ip);
        this.saveBans();
        return null;
      }
      return info;
    }
    return null;
  }

  public getAllBans() {
    return {
      idBans: Array.from(this.idBans.values()),
      ipBans: Array.from(this.ipBans.values()),
    };
  }
}
