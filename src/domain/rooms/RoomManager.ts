/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { UserInfo, RoomState, PlayerScore } from '../protocol/Commands';

export interface PlayerInfo {
  user: UserInfo;
  connectionId: string;
  isReady: boolean;
  isFinished: boolean;
  score: PlayerScore | null;
  isConnected: boolean;
  disconnectTime?: number;
}

export interface ChartInfo {
  id: number;
  name: string;
  charter?: string;
  level?: string;
  // Add other chart fields as needed from the API response
}

export interface Room {
  id: string;
  name: string;
  ownerId: number;
  players: Map<number, PlayerInfo>;
  maxPlayers: number;
  password?: string;
  state: RoomState;
  locked: boolean;
  cycle: boolean;
  live: boolean;
  selectedChart?: ChartInfo;
  createdAt: number;
  soloConfirmPending?: boolean;
}

export interface CreateRoomOptions {
  id: string;
  name: string;
  ownerId: number;
  ownerInfo: UserInfo;
  connectionId: string;
  maxPlayers?: number;
  password?: string;
}

export interface RoomManager {
  createRoom(options: CreateRoomOptions): Room;
  getRoom(id: string): Room | undefined;
  deleteRoom(id: string): boolean;
  listRooms(): Room[];
  count(): number;
  addPlayerToRoom(roomId: string, userId: number, userInfo: UserInfo, connectionId: string): boolean;
  removePlayerFromRoom(roomId: string, userId: number): boolean;
  getRoomByUserId(userId: number): Room | undefined;
  setRoomState(roomId: string, state: RoomState): boolean;
  setRoomLocked(roomId: string, locked: boolean): boolean;
  setRoomCycle(roomId: string, cycle: boolean): boolean;
  setPlayerReady(roomId: string, userId: number, ready: boolean): boolean;
  isRoomOwner(roomId: string, userId: number): boolean;
  changeRoomOwner(roomId: string, newOwnerId: number): boolean;
  setRoomChart(roomId: string, chart: ChartInfo | undefined): boolean;
  getRoomChart(roomId: string): ChartInfo | undefined;
  getPlayerByConnectionId(connectionId: string): { player: PlayerInfo; room: Room } | null;
  cleanupEmptyRooms(): void;
  migrateConnection(userId: number, oldConnectionId: string, newConnectionId: string): void;
  setSoloConfirmPending(roomId: string, pending: boolean): boolean;
  isSoloConfirmPending(roomId: string): boolean;
}

export class InMemoryRoomManager implements RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly logger: Logger) {}

  createRoom(options: CreateRoomOptions): Room {
    const { id, name, ownerId, ownerInfo, connectionId, maxPlayers = 8, password } = options;

    if (this.rooms.has(id)) {
      throw new Error(`房间 ${id} 已存在`);
    }

    const players = new Map<number, PlayerInfo>();
    players.set(ownerId, {
      user: ownerInfo,
      connectionId,
      isReady: false,
      isFinished: false,
      score: null,
      isConnected: true,
    });

    const room: Room = {
      id,
      name,
      ownerId,
      players,
      maxPlayers,
      password,
      state: { type: 'SelectChart', chartId: null },
      locked: false,
      cycle: false,
      live: false,
      createdAt: Date.now(),
      soloConfirmPending: false,
    };

    this.rooms.set(id, room);
    this.logger.info(`${ownerInfo.name}[${ownerId}] 创建了房间 ${id}`);

    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): boolean {
    const deleted = this.rooms.delete(id);

    if (deleted) {
      this.logger.info(`由于 ${id} 房间没有人，删除房间 ${id}`);
    }

    return deleted;
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }

  count(): number {
    return this.rooms.size;
  }

  addPlayerToRoom(
    roomId: string,
    userId: number,
    userInfo: UserInfo,
    connectionId: string,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.logger.warn(`无法将玩家 ${userId} 添加到不存在的房间 ${roomId}`);
      return false;
    }

    if (room.players.size >= room.maxPlayers) {
      this.logger.warn(`无法将玩家 ${userId} 加入到满人房 ${roomId}`);
      return false;
    }

    if (room.locked) {
      this.logger.warn(`无法将玩家 ${userId} 加入到锁定的房间 ${roomId}`);
      return false;
    }

    if (room.soloConfirmPending) {
      room.soloConfirmPending = false;
    }

    room.players.set(userId, {
      user: userInfo,
      connectionId,
      isReady: false,
      isFinished: false,
      score: null,
      isConnected: true,
    });

    this.logger.debug('已添加玩家到房间：', { roomId, userId, playerCount: room.players.size });
    return true;
  }

  removePlayerFromRoom(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const removed = room.players.delete(userId);
    if (removed) {
      this.logger.info(`从房间 ${roomId} 移除玩家 ${userId}`);

      if (room.players.size === 0) {
        this.deleteRoom(roomId);
      } else if (room.ownerId === userId) {
        const newOwner = Array.from(room.players.keys())[0];
        this.changeRoomOwner(roomId, newOwner);
      }
    }

    return removed;
  }

  getRoomByUserId(userId: number): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.has(userId)) {
        return room;
      }
    }
    return undefined;
  }

  setRoomState(roomId: string, state: RoomState): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.state = state;
    this.logger.debug('房间状态改变：', { roomId, state: state.type });
    return true;
  }

  setRoomLocked(roomId: string, locked: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.locked = locked;
    this.logger.debug('房间锁定状态改变：', { roomId, locked });
    return true;
  }

  setRoomCycle(roomId: string, cycle: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.cycle = cycle;
    this.logger.debug('房间循环状态改变：', { roomId, cycle });
    return true;
  }

  setPlayerReady(roomId: string, userId: number, ready: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const player = room.players.get(userId);
    if (!player) {
      return false;
    }

    player.isReady = ready;
    this.logger.debug('玩家准备状态改变：', { roomId, userId, ready });
    return true;
  }

  isRoomOwner(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.ownerId === userId : false;
  }

  changeRoomOwner(roomId: string, newOwnerId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.players.has(newOwnerId)) {
      return false;
    }

    room.ownerId = newOwnerId;
    this.logger.info('房主已更换：', { roomId, newOwnerId });
    return true;
  }

  setRoomChart(roomId: string, chart: ChartInfo | undefined): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.selectedChart = chart;
    this.logger.debug('房间谱面已更改：', { roomId, chartId: chart?.id });
    return true;
  }

  getRoomChart(roomId: string): ChartInfo | undefined {
    const room = this.rooms.get(roomId);
    return room?.selectedChart;
  }

  getPlayerByConnectionId(connectionId: string): { player: PlayerInfo; room: Room } | null {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.connectionId === connectionId) {
          return { player, room };
        }
      }
    }
    return null;
  }

  cleanupEmptyRooms(): void {
    const emptyRooms: string[] = [];
    for (const [id, room] of this.rooms.entries()) {
      if (room.players.size === 0) {
        emptyRooms.push(id);
      }
    }

    emptyRooms.forEach((id) => this.deleteRoom(id));
    if (emptyRooms.length > 0) {
      this.logger.info('清理空房间：', { count: emptyRooms.length });
    }
  }

  migrateConnection(userId: number, oldConnectionId: string, newConnectionId: string): void {
    const room = this.getRoomByUserId(userId);
    if (!room) {
      this.logger.warn('[重连迁移] 找不到玩家的房间', {
        userId,
        oldConnectionId,
        newConnectionId,
      });
      return;
    }

    const player = room.players.get(userId);
    if (!player) {
      this.logger.warn('[重连迁移] 房间中找不到玩家', {
        userId,
        roomId: room.id,
        oldConnectionId,
        newConnectionId,
      });
      return;
    }

    // 保存当前游戏状态
    const preservedState = {
      isFinished: player.isFinished,
      score: player.score,
      isReady: player.isReady,
    };

    // 更新连接ID，保留所有游戏状态
    player.connectionId = newConnectionId;
    player.isConnected = true;
    player.disconnectTime = undefined;

    this.logger.info('[重连迁移] 连接已迁移', {
      userId,
      roomId: room.id,
      oldConnectionId,
      newConnectionId,
      preservedState,
    });
  }

  setSoloConfirmPending(roomId: string, pending: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }
    room.soloConfirmPending = pending;
    return true;
  }

  isSoloConfirmPending(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return room?.soloConfirmPending ?? false;
  }
}
