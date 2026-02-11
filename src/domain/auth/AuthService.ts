/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { UserInfo } from '../protocol/Commands';

interface PhiraUserResponse {
  id: number;
  name: string;
  avatar?: string;
  language?: string;
}

export interface AuthService {
  authenticate(token: string): Promise<UserInfo>;
}

export class PhiraAuthService implements AuthService {
  constructor(
    private readonly apiUrl: string,
    private readonly logger: Logger,
    private readonly defaultAvatar: string = 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404',
  ) {}

  async authenticate(token: string): Promise<UserInfo> {
    this.logger.debug(`正在验证玩家 (Token长度: ${token.length})`);

    try {
      const response = await fetch(`${this.apiUrl}/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'PhiraServer/1.0',
        },
        redirect: 'error'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.warn(`验证玩家失败: ${response.status} ${response.statusText} (${errorText})`);
        throw new Error(`验证失败: ${response.status} ${response.statusText}`);
      }

      const userData: PhiraUserResponse = await response.json();

      this.logger.info(`验证玩家成功：“${userData.name}”（用户ID：${userData.id}）`, { userId: userData.id });

      return {
        id: userData.id,
        name: userData.name,
        avatar: userData.avatar ?? this.defaultAvatar,
        monitor: false,
      };
    } catch (error) {
      this.logger.error(`验证玩家失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}