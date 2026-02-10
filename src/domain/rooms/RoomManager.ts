/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { UserInfo, RoomState, PlayerScore, Message } from '../protocol/Commands';

export interface PlayerInfo {
  user: UserInfo;
  connectionId: string;
  avatar?: string;
  isReady: boolean;
  isFinished: boolean;
  score: PlayerScore | null;
  isConnected: boolean;
  disconnectTime?: number;
  rks?: number;
  bio?: string;
}

export interface ChartInfo {
  id: number;
  name: string;
  charter?: string;
  level?: string;
  difficulty?: number;
  composer?: string;
  illustration?: string;
  uploader?: number;
  rating?: number;
  ratingCount?: number;
  uploaderInfo?: {
      id: number;
      name: string;
      avatar: string;
      rks: number;
      bio?: string;
  };
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
  lastGameChart?: ChartInfo;
  createdAt: number;
  soloConfirmPending?: boolean;
  messages: Message[];
  blacklist: number[];
  whitelist: number[];
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
  setRoomMaxPlayers(roomId: string, maxPlayers: number): boolean;
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
  addMessageToRoom(roomId: string, message: Message): void;
  setRoomBlacklist(roomId: string, userIds: number[]): boolean;
  isUserBlacklisted(roomId: string, userId: number): boolean;
  setRoomWhitelist(roomId: string, userIds: number[]): boolean;
  getAllPlayers(): { id: number; name: string; roomId: string; roomName: string }[];
  setGlobalLocked(locked: boolean): void;
  isGlobalLocked(): boolean;
}

export class InMemoryRoomManager implements RoomManager {
  private readonly rooms = new Map<string, Room>();
  private onRoomsChanged: (() => void) | null = null;
  private globalLocked = false;

  constructor(
    private readonly logger: Logger,
    private readonly roomSize: number = 8,
    onRoomsChanged: (() => void) | null = null,
  ) {
    this.onRoomsChanged = onRoomsChanged;
  }

  setGlobalLocked(locked: boolean): void {
    this.globalLocked = locked;
    this.logger.info(`全局房间创建锁定状态已更改为: ${locked}`, { userId: -1 });
  }

  isGlobalLocked(): boolean {
    return this.globalLocked;
  }

  getAllPlayers(): { id: number; name: string; roomId: string; roomName: string }[] {
    const allPlayers: { id: number; name: string; roomId: string; roomName: string }[] = [];
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        allPlayers.push({
          id: player.user.id,
          name: player.user.name,
          roomId: room.id,
          roomName: room.name,
        });
      }
    }
    return allPlayers;
  }


  private notifyRoomsChanged(): void {
    if (this.onRoomsChanged) {
      this.onRoomsChanged();
    }
  }

  createRoom(options: CreateRoomOptions): Room {
    const { id, name, ownerId, ownerInfo, connectionId, maxPlayers = this.roomSize, password } = options;

    if (this.globalLocked) {
      throw new Error('服务器当前已禁止创建新房间');
    }

    if (this.rooms.has(id)) {
      throw new Error(`房间 ${id} 已存在`);
    }

    const players = new Map<number, PlayerInfo>();
    players.set(ownerId, {
      user: ownerInfo,
      connectionId,
      avatar: ownerInfo.avatar,
      isReady: false,
      isFinished: false,
      score: null,
      isConnected: true,
      rks: ownerInfo.rks,
      bio: ownerInfo.bio,
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
      messages: [],
      blacklist: [],
      whitelist: [],
    };

    this.rooms.set(id, room);
    this.logger.info(`房间 “${id}” 已被创建`, { userId: ownerId });
    this.notifyRoomsChanged();

    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): boolean {
    const deleted = this.rooms.delete(id);

    if (deleted) {
      this.logger.info(`由于 “${id}” 房间没有人，删除房间 “${id}”`, { userId: -1 });
      this.notifyRoomsChanged();
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
      this.logger.warn(`无法将玩家 ${userId} 添加到不存在的房间 “${roomId}”`, { userId: -1 });
      return false;
    }

    if (room.players.size >= room.maxPlayers) {
      this.logger.warn(`无法将玩家 ${userId} 加入到满人房 “${roomId}”`, { userId });
      return false;
    }

    if (room.locked) {
      this.logger.warn(`无法将玩家 ${userId} 加入到锁定的房间 “${roomId}”`, { userId });
      return false;
    }

    if (room.blacklist.includes(userId)) {
      this.logger.warn(`无法将玩家 ${userId} 加入到黑名单中的房间 “${roomId}”`, { userId });
      return false;
    }

    if (room.whitelist.length > 0 && !room.whitelist.includes(userId)) {
      this.logger.warn(`无法将玩家 ${userId} 加入到有白名单限制的房间 “${roomId}” (不在名单内)`, { userId });
      return false;
    }

    if (room.soloConfirmPending) {
      room.soloConfirmPending = false;
    }

    room.players.set(userId, {
      user: userInfo,
      connectionId,
      avatar: userInfo.avatar,
      isReady: false,
      isFinished: false,
      score: null,
      isConnected: true,
      rks: userInfo.rks,
      bio: userInfo.bio,
    });

    this.logger.debug(`已添加玩家 ${userId} 到房间 “${roomId}” (当前人数: ${room.players.size})`, { userId });
    this.notifyRoomsChanged();
    return true;
  }

  removePlayerFromRoom(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const removed = room.players.delete(userId);
    if (removed) {
      this.logger.info(`从房间 “${roomId}” 移除玩家 ${userId}`, { userId });
      this.notifyRoomsChanged();

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
    this.logger.debug(`房间 “${roomId}” 状态改变: ${state.type}`, { userId: room.ownerId });
    this.notifyRoomsChanged();
    return true;
  }

  setRoomLocked(roomId: string, locked: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.locked = locked;
    this.logger.debug(`房间 “${roomId}” 锁定状态改变: ${locked}`, { userId: room.ownerId });
    this.notifyRoomsChanged();
    return true;
  }

  setRoomCycle(roomId: string, cycle: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.cycle = cycle;
    this.logger.debug(`房间 “${roomId}” 循环状态改变: ${cycle}`, { userId: room.ownerId });
    return true;
  }

  setRoomMaxPlayers(roomId: string, maxPlayers: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.maxPlayers = maxPlayers;
    this.logger.debug(`房间 “${roomId}” 最大人数改变: ${maxPlayers}`, { userId: room.ownerId });
    this.notifyRoomsChanged();
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
    this.logger.debug(`房间 “${roomId}” 玩家 ${userId} 准备状态改变: ${ready}`, { userId });
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
    this.logger.info(`房间 “${roomId}” 房主已更换为: ${newOwnerId}`, { userId: -1 });
    return true;
  }

  setRoomChart(roomId: string, chart: ChartInfo | undefined): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.selectedChart = chart;
    this.logger.debug(`房间 “${roomId}” 谱面已更改: ${chart?.id}`, { userId: room.ownerId });
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

    if (emptyRooms.length > 0) {
        this.logger.info(`已清理 ${emptyRooms.length} 个空房间`, { userId: -1 });
    }
    emptyRooms.forEach((id) => this.deleteRoom(id));
  }

  migrateConnection(userId: number, oldConnectionId: string, newConnectionId: string): void {
    const room = this.getRoomByUserId(userId);
    if (!room) {
      this.logger.warn(`[重连迁移] 找不到玩家 ${userId} 的房间 (连接: ${oldConnectionId} -> ${newConnectionId})`, { userId });
      return;
    }

    const player = room.players.get(userId);
    if (!player) {
      this.logger.warn(`[重连迁移] 在房间 “${room.id}” 中找不到玩家 ${userId} (连接: ${oldConnectionId} -> ${newConnectionId})`, { userId });
      return;
    }

    // 更新连接ID，保留所有游戏状态
    player.connectionId = newConnectionId;
    player.isConnected = true;
    player.disconnectTime = undefined;

    this.logger.info(`[重连迁移] 玩家 ${userId} 的连接已从 ${oldConnectionId} 迁移至 ${newConnectionId} (房间 “${room.id}”)`, { userId });
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

  addMessageToRoom(roomId: string, message: Message): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.messages.push(message);
      if (room.messages.length > 50) {
        room.messages.shift();
      }
      this.notifyRoomsChanged();
    }
  }

  setRoomBlacklist(roomId: string, userIds: number[]): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.blacklist = userIds;
    this.logger.debug(`房间 “${roomId}” 黑名单已更新，人数: ${userIds.length}`, { userId: -1 });
    return true;
  }

  isUserBlacklisted(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.blacklist.includes(userId);
  }

  setRoomWhitelist(roomId: string, userIds: number[]): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.whitelist = userIds;
    this.logger.debug(`房间 “${roomId}” 白名单已更新，人数: ${userIds.length}`, { userId: -1 });
    return true;
  }
}
