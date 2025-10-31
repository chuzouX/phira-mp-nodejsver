/*
 * MIT License
 * Copyright (c) 2024
 */

import { BinaryReader, BinaryWriter } from './BinaryProtocol';

export enum ClientCommandType {
  Ping = 0,
  Authenticate = 1,
  Chat = 2,
  Touches = 3,
  Judges = 4,
  CreateRoom = 5,
  JoinRoom = 6,
  LeaveRoom = 7,
  LockRoom = 8,
  CycleRoom = 9,
  SelectChart = 10,
  RequestStart = 11,
  Ready = 12,
  CancelReady = 13,
  Played = 14,
  Abort = 15,
}

export enum ServerCommandType {
  Pong = 0,
  Authenticate = 1,
  Chat = 2,
  Touches = 3,
  Judges = 4,
  Message = 5,
  ChangeState = 6,
  ChangeHost = 7,
  CreateRoom = 8,
  JoinRoom = 9,
  OnJoinRoom = 10,
  LeaveRoom = 11,
  OnLeaveRoom = 12,
  LockRoom = 13,
  CycleRoom = 14,
  SelectChart = 15,
  OnSelectChart = 16,
  RequestStart = 17,
  OnRequestStart = 18,
  Ready = 19,
  CancelReady = 20,
  Played = 21,
  Abort = 22,
}

export type ClientCommand =
  | { type: ClientCommandType.Ping }
  | { type: ClientCommandType.Authenticate; token: string }
  | { type: ClientCommandType.Chat; message: string }
  | { type: ClientCommandType.Touches }
  | { type: ClientCommandType.Judges }
  | { type: ClientCommandType.CreateRoom; id: string }
  | { type: ClientCommandType.JoinRoom; id: string; monitor: boolean }
  | { type: ClientCommandType.LeaveRoom }
  | { type: ClientCommandType.LockRoom; lock: boolean }
  | { type: ClientCommandType.CycleRoom; cycle: boolean }
  | { type: ClientCommandType.SelectChart; id: number }
  | { type: ClientCommandType.RequestStart }
  | { type: ClientCommandType.Ready }
  | { type: ClientCommandType.CancelReady }
  | { type: ClientCommandType.Played; id: number }
  | { type: ClientCommandType.Abort };

export interface UserInfo {
  id: number;
  name: string;
  monitor: boolean;
}

export interface RoomState {
  state: 'SelectChart' | 'WaitingForReady' | 'Playing';
  chartId?: number;
}

export interface ClientRoomState {
  id: string;
  state: RoomState;
  live: boolean;
  locked: boolean;
  cycle: boolean;
  isHost: boolean;
  isReady: boolean;
  users: Map<number, UserInfo>;
}

export type ServerCommand =
  | { type: ServerCommandType.Pong }
  | {
      type: ServerCommandType.Authenticate;
      success: boolean;
      error?: string;
      user?: UserInfo;
      room?: ClientRoomState;
    }
  | { type: ServerCommandType.Chat; success: boolean; error?: string }
  | { type: ServerCommandType.Message; message: string }
  | { type: ServerCommandType.ChangeState; state: RoomState }
  | { type: ServerCommandType.ChangeHost; newHostId: number }
  | { type: ServerCommandType.CreateRoom; success: boolean; error?: string; room?: ClientRoomState }
  | { type: ServerCommandType.JoinRoom; success: boolean; error?: string; room?: ClientRoomState }
  | { type: ServerCommandType.OnJoinRoom; user: UserInfo }
  | { type: ServerCommandType.LeaveRoom; success: boolean; error?: string }
  | { type: ServerCommandType.OnLeaveRoom; userId: number }
  | { type: ServerCommandType.LockRoom; locked: boolean }
  | { type: ServerCommandType.CycleRoom; cycle: boolean }
  | { type: ServerCommandType.SelectChart; success: boolean; error?: string }
  | { type: ServerCommandType.OnSelectChart; chartId: number }
  | { type: ServerCommandType.RequestStart; success: boolean; error?: string }
  | { type: ServerCommandType.OnRequestStart }
  | { type: ServerCommandType.Ready; userId: number }
  | { type: ServerCommandType.CancelReady; userId: number }
  | { type: ServerCommandType.Played; userId: number; chartId: number }
  | { type: ServerCommandType.Abort };

export interface ParsedClientCommand {
  rawType: number;
  command?: ClientCommand;
}

export class CommandParser {
  static parseClientCommand(reader: BinaryReader): ParsedClientCommand {
    const commandType = reader.u8();

    switch (commandType) {
      case ClientCommandType.Ping:
        return { rawType: commandType, command: { type: ClientCommandType.Ping } };

      case ClientCommandType.Authenticate: {
        const token = reader.string();
        return {
          rawType: commandType,
          command: { type: ClientCommandType.Authenticate, token },
        };
      }

      case ClientCommandType.Chat: {
        const message = reader.string();
        return { rawType: commandType, command: { type: ClientCommandType.Chat, message } };
      }

      case ClientCommandType.CreateRoom: {
        const id = reader.string();
        return { rawType: commandType, command: { type: ClientCommandType.CreateRoom, id } };
      }

      case ClientCommandType.JoinRoom: {
        const id = reader.string();
        const monitor = reader.bool();
        return {
          rawType: commandType,
          command: { type: ClientCommandType.JoinRoom, id, monitor },
        };
      }

      case ClientCommandType.LeaveRoom:
        return { rawType: commandType, command: { type: ClientCommandType.LeaveRoom } };

      case ClientCommandType.LockRoom: {
        const lock = reader.bool();
        return {
          rawType: commandType,
          command: { type: ClientCommandType.LockRoom, lock },
        };
      }

      case ClientCommandType.CycleRoom: {
        const cycle = reader.bool();
        return {
          rawType: commandType,
          command: { type: ClientCommandType.CycleRoom, cycle },
        };
      }

      case ClientCommandType.SelectChart: {
        const id = reader.i32();
        return {
          rawType: commandType,
          command: { type: ClientCommandType.SelectChart, id },
        };
      }

      case ClientCommandType.RequestStart:
        return { rawType: commandType, command: { type: ClientCommandType.RequestStart } };

      case ClientCommandType.Ready:
        return { rawType: commandType, command: { type: ClientCommandType.Ready } };

      case ClientCommandType.CancelReady:
        return {
          rawType: commandType,
          command: { type: ClientCommandType.CancelReady },
        };

      case ClientCommandType.Played: {
        const id = reader.i32();
        return { rawType: commandType, command: { type: ClientCommandType.Played, id } };
      }

      case ClientCommandType.Abort:
        return { rawType: commandType, command: { type: ClientCommandType.Abort } };

      case ClientCommandType.Touches:
      case ClientCommandType.Judges:
        reader.readRemaining();
        return { rawType: commandType };

      default:
        reader.readRemaining();
        return { rawType: commandType };
    }
  }

  static writeServerCommand(writer: BinaryWriter, command: ServerCommand): void {
    writer.u8(command.type);

    switch (command.type) {
      case ServerCommandType.Pong:
        break;

      case ServerCommandType.Authenticate:
        if (command.success && command.user) {
          writer.bool(true);
          CommandParser.writeUserInfo(writer, command.user);
          if (command.room) {
            writer.bool(true);
            CommandParser.writeClientRoomState(writer, command.room);
          } else {
            writer.bool(false);
          }
        } else {
          writer.bool(false);
          writer.string(command.error || 'Authentication failed');
        }
        break;

      case ServerCommandType.Chat:
        if (command.success) {
          writer.bool(true);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Chat failed');
        }
        break;

      case ServerCommandType.Message:
        writer.string(command.message);
        break;

      case ServerCommandType.ChangeState:
        CommandParser.writeRoomState(writer, command.state);
        break;

      case ServerCommandType.ChangeHost:
        writer.i32(command.newHostId);
        break;

      case ServerCommandType.CreateRoom:
        if (command.success && command.room) {
          writer.bool(true);
          CommandParser.writeClientRoomState(writer, command.room);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Failed to create room');
        }
        break;

      case ServerCommandType.JoinRoom:
        if (command.success && command.room) {
          writer.bool(true);
          CommandParser.writeClientRoomState(writer, command.room);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Failed to join room');
        }
        break;

      case ServerCommandType.OnJoinRoom:
        CommandParser.writeUserInfo(writer, command.user);
        break;

      case ServerCommandType.LeaveRoom:
        if (command.success) {
          writer.bool(true);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Failed to leave room');
        }
        break;

      case ServerCommandType.OnLeaveRoom:
        writer.i32(command.userId);
        break;

      case ServerCommandType.LockRoom:
        writer.bool(command.locked);
        break;

      case ServerCommandType.CycleRoom:
        writer.bool(command.cycle);
        break;

      case ServerCommandType.SelectChart:
        if (command.success) {
          writer.bool(true);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Failed to select chart');
        }
        break;

      case ServerCommandType.OnSelectChart:
        writer.i32(command.chartId);
        break;

      case ServerCommandType.RequestStart:
        if (command.success) {
          writer.bool(true);
        } else {
          writer.bool(false);
          writer.string(command.error || 'Failed to start game');
        }
        break;

      case ServerCommandType.OnRequestStart:
        break;

      case ServerCommandType.Ready:
        writer.i32(command.userId);
        break;

      case ServerCommandType.CancelReady:
        writer.i32(command.userId);
        break;

      case ServerCommandType.Played:
        writer.i32(command.userId);
        writer.i32(command.chartId);
        break;

      case ServerCommandType.Abort:
        break;

      default:
        throw new Error('Unimplemented server command type');
    }
  }

  private static writeUserInfo(writer: BinaryWriter, user: UserInfo): void {
    writer.i32(user.id);
    writer.string(user.name);
    writer.bool(user.monitor);
  }

  private static writeRoomState(writer: BinaryWriter, state: RoomState): void {
    switch (state.state) {
      case 'SelectChart':
        writer.u8(0);
        if (typeof state.chartId === 'number') {
          writer.bool(true);
          writer.i32(state.chartId);
        } else {
          writer.bool(false);
        }
        break;
      case 'WaitingForReady':
        writer.u8(1);
        break;
      case 'Playing':
        writer.u8(2);
        break;
      default:
        throw new Error(`Unsupported room state: ${state.state}`);
    }
  }

  private static writeClientRoomState(writer: BinaryWriter, room: ClientRoomState): void {
    writer.string(room.id);
    CommandParser.writeRoomState(writer, room.state);
    writer.bool(room.live);
    writer.bool(room.locked);
    writer.bool(room.cycle);
    writer.bool(room.isHost);
    writer.bool(room.isReady);

    const entries = room.users instanceof Map ? Array.from(room.users.entries()) : [];
    writer.uleb(entries.length);
    for (const [userId, user] of entries) {
      writer.i32(userId);
      CommandParser.writeUserInfo(writer, user);
    }
  }
}
