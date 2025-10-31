/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';

export interface Room {
  id: string;
  name: string;
  participants: string[];
}

export interface RoomManager {
  createRoom(name: string): Room;
  getRoom(id: string): Room | undefined;
  deleteRoom(id: string): boolean;
  listRooms(): Room[];
  count(): number;
}

export class InMemoryRoomManager implements RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly logger: Logger) {}

  createRoom(name: string): Room {
    const id = this.generateId();
    const room: Room = {
      id,
      name,
      participants: [],
    };

    this.rooms.set(id, room);
    this.logger.info('Room created', { id, name, totalRooms: this.rooms.size });

    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): boolean {
    const deleted = this.rooms.delete(id);

    if (deleted) {
      this.logger.info('Room deleted', { id, totalRooms: this.rooms.size });
    }

    return deleted;
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }

  count(): number {
    return this.rooms.size;
  }

  private generateId(): string {
    return `room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
