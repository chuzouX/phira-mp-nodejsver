/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { UserInfo } from '../protocol/Commands';

interface PhiraUserResponse {
  id: number;
  name: string;
  language?: string;
}

export interface AuthService {
  authenticate(token: string): Promise<UserInfo>;
}

export class PhiraAuthService implements AuthService {
  constructor(
    private readonly apiUrl: string,
    private readonly logger: Logger,
  ) {}

  async authenticate(token: string): Promise<UserInfo> {
    this.logger.debug('Authenticating with Phira API', {
      tokenLength: token.length,
      apiUrl: this.apiUrl,
    });

    try {
      const response = await fetch(`${this.apiUrl}/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.warn('Phira API authentication failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
      }

      const userData: PhiraUserResponse = await response.json();

      this.logger.info('Phira API authentication successful', {
        userId: userData.id,
        userName: userData.name,
      });

      return {
        id: userData.id,
        name: userData.name,
        monitor: false,
      };
    } catch (error) {
      this.logger.error('Failed to authenticate with Phira API', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
