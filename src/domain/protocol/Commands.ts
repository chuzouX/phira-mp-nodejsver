/*
 * MIT License
 * Copyright (c) 2024
 * 
 * IMPORTANT: This file must match phira-mp-common/src/command.rs exactly
 * Source: https://github.com/TeamFlos/phira-mp/blob/main/phira-mp-common/src/command.rs
 */

import { BinaryReader, BinaryWriter } from './BinaryProtocol';

// Source: phira-mp-common/src/command.rs:157-178
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
  GameResult = 16,
}

// Source: phira-mp-common/src/command.rs:276-308
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
  LockRoom = 12,
  CycleRoom = 13,
  SelectChart = 14,
  RequestStart = 15,
  Ready = 16,
  CancelReady = 17,
  Played = 18,
  Abort = 19,
}

// Source: phira-mp-common/src/command.rs:157-178
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
  | { type: ClientCommandType.Abort }
  | {
      type: ClientCommandType.GameResult;
      score: number;
      accuracy: number;
      perfect: number;
      good: number;
      bad: number;
      miss: number;
      maxCombo: number;
    };

// Source: phira-mp-common/src/command.rs:250-254
export interface UserInfo {
  id: number;
  name: string;
  monitor: boolean;
}

export interface PlayerScore {
  score: number;
  accuracy: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  maxCombo: number;
  finishTime: number;
}

export interface PlayerRanking {
  rank: number;
  userId: number;
  userName: string;
  score: PlayerScore | null;
}

// Source: phira-mp-common/src/command.rs:236-247
export type RoomState =
  | { type: 'SelectChart'; chartId: number | null }
  | { type: 'WaitingForReady' }
  | { type: 'Playing' };

// Source: phira-mp-common/src/command.rs:256-266
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

// Source: phira-mp-common/src/command.rs:268-273
export interface JoinRoomResponse {
  state: RoomState;
  users: UserInfo[];
  live: boolean;
}

// Source: phira-mp-common/src/command.rs:181-234
export type Message =
  | { type: 'Chat'; user: number; content: string }
  | { type: 'CreateRoom'; user: number }
  | { type: 'JoinRoom'; user: number; name: string }
  | { type: 'LeaveRoom'; user: number; name: string }
  | { type: 'NewHost'; user: number }
  | { type: 'SelectChart'; user: number; name: string; id: number }
  | { type: 'GameStart'; user: number }
  | { type: 'Ready'; user: number }
  | { type: 'CancelReady'; user: number }
  | { type: 'CancelGame'; user: number }
  | { type: 'StartPlaying' }
  | { type: 'Played'; user: number; score: number; accuracy: number; fullCombo: boolean }
  | { type: 'GameEnd' }
  | { type: 'Abort'; user: number }
  | { type: 'LockRoom'; lock: boolean }
  | { type: 'CycleRoom'; cycle: boolean };

// Helper type for Result<T, String> pattern used in Rust
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Source: phira-mp-common/src/command.rs:276-308
export type ServerCommand =
  | { type: ServerCommandType.Pong }
  | { type: ServerCommandType.Authenticate; result: Result<[UserInfo, ClientRoomState | null]> }
  | { type: ServerCommandType.Chat; result: Result<void> }
  | { type: ServerCommandType.Touches; player: number; frames: unknown }
  | { type: ServerCommandType.Judges; player: number; judges: unknown }
  | { type: ServerCommandType.Message; message: Message }
  | { type: ServerCommandType.ChangeState; state: RoomState }
  | { type: ServerCommandType.ChangeHost; isHost: boolean }
  | { type: ServerCommandType.CreateRoom; result: Result<void> }
  | { type: ServerCommandType.JoinRoom; result: Result<JoinRoomResponse> }
  | { type: ServerCommandType.OnJoinRoom; user: UserInfo }
  | { type: ServerCommandType.LeaveRoom; result: Result<void> }
  | { type: ServerCommandType.LockRoom; result: Result<void> }
  | { type: ServerCommandType.CycleRoom; result: Result<void> }
  | { type: ServerCommandType.SelectChart; result: Result<void> }
  | { type: ServerCommandType.RequestStart; result: Result<void> }
  | { type: ServerCommandType.Ready; result: Result<void> }
  | { type: ServerCommandType.CancelReady; result: Result<void> }
  | { type: ServerCommandType.Played; result: Result<void> }
  | { type: ServerCommandType.Abort; result: Result<void> }

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

      case ClientCommandType.GameResult: {
        const score = reader.i32();
        const accuracy = reader.f32();
        const perfect = reader.i32();
        const good = reader.i32();
        const bad = reader.i32();
        const miss = reader.i32();
        const maxCombo = reader.i32();
        return {
          rawType: commandType,
          command: {
            type: ClientCommandType.GameResult,
            score,
            accuracy,
            perfect,
            good,
            bad,
            miss,
            maxCombo,
          },
        };
      }

      case ClientCommandType.Touches:
      case ClientCommandType.Judges:
        reader.readRemaining();
        return { rawType: commandType };

      default:
        reader.readRemaining();
        return { rawType: commandType };
    }
  }

  // Source: phira-mp-common/src/bin.rs (Result serialization pattern)
  static writeServerCommand(writer: BinaryWriter, command: ServerCommand): void {
    writer.u8(command.type);

    switch (command.type) {
      case ServerCommandType.Pong:
        // No payload
        break;

      case ServerCommandType.Authenticate:
        // Result<(UserInfo, Option<ClientRoomState>), String>
        if (command.result.ok) {
          writer.bool(true);
          const [user, room] = command.result.value;
          CommandParser.writeUserInfo(writer, user);
          if (room) {
            writer.bool(true);
            CommandParser.writeClientRoomState(writer, room);
          } else {
            writer.bool(false);
          }
        } else {
          writer.bool(false);
          writer.string(command.result.error);
        }
        break;

      case ServerCommandType.Chat:
      case ServerCommandType.CreateRoom:
      case ServerCommandType.LeaveRoom:
      case ServerCommandType.LockRoom:
      case ServerCommandType.CycleRoom:
      case ServerCommandType.SelectChart:
      case ServerCommandType.RequestStart:
      case ServerCommandType.Ready:
      case ServerCommandType.CancelReady:
      case ServerCommandType.Played:
      case ServerCommandType.Abort:
        // Result<(), String>
        if (command.result.ok) {
          writer.bool(true);
          // () has no payload
        } else {
          writer.bool(false);
          writer.string(command.result.error);
        }
        break;

      case ServerCommandType.JoinRoom:
        // Result<JoinRoomResponse, String>
        if (command.result.ok) {
          writer.bool(true);
          CommandParser.writeJoinRoomResponse(writer, command.result.value);
        } else {
          writer.bool(false);
          writer.string(command.result.error);
        }
        break;

      case ServerCommandType.Message:
        CommandParser.writeMessage(writer, command.message);
        break;

      case ServerCommandType.ChangeState:
        CommandParser.writeRoomState(writer, command.state);
        break;

      case ServerCommandType.ChangeHost:
        writer.bool(command.isHost);
        break;

      case ServerCommandType.OnJoinRoom:
        CommandParser.writeUserInfo(writer, command.user);
        break;

      case ServerCommandType.Touches:
      case ServerCommandType.Judges:
        // Not implemented - these are monitor-only features
        throw new Error('Touches/Judges not implemented');

      default:
        throw new Error('Unimplemented server command type');
    }
  }

  private static writeUserInfo(writer: BinaryWriter, user: UserInfo): void {
    writer.i32(user.id);
    writer.string(user.name);
    writer.bool(user.monitor);
  }

  private static writePlayerScoreOption(writer: BinaryWriter, score: PlayerScore | null): void {
    if (score) {
      writer.bool(true);
      CommandParser.writePlayerScore(writer, score);
    } else {
      writer.bool(false);
    }
  }

  private static writePlayerScore(writer: BinaryWriter, score: PlayerScore): void {
    writer.i32(score.score);
    writer.f32(score.accuracy);
    writer.i32(score.perfect);
    writer.i32(score.good);
    writer.i32(score.bad);
    writer.i32(score.miss);
    writer.i32(score.maxCombo);
    writer.u64(BigInt(Math.max(0, score.finishTime)));
  }

  private static writeRoomState(writer: BinaryWriter, state: RoomState): void {
    switch (state.type) {
      case 'SelectChart':
        writer.u8(0);
        if (state.chartId !== null) {
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
        throw new Error(`Unsupported room state: ${(state as any).type}`);
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

    // HashMap<i32, UserInfo>
    const entries = room.users instanceof Map ? Array.from(room.users.entries()) : [];
    writer.uleb(entries.length);
    for (const [userId, user] of entries) {
      writer.i32(userId);
      CommandParser.writeUserInfo(writer, user);
    }
  }

  private static writeJoinRoomResponse(writer: BinaryWriter, response: JoinRoomResponse): void {
    CommandParser.writeRoomState(writer, response.state);
    writer.uleb(response.users.length);
    for (const user of response.users) {
      CommandParser.writeUserInfo(writer, user);
    }
    writer.bool(response.live);
  }

  private static writeMessage(writer: BinaryWriter, message: Message): void {
    // Enum discriminant as u8
    switch (message.type) {
      case 'Chat':
        writer.u8(0);
        writer.i32(message.user);
        writer.string(message.content);
        break;
      case 'CreateRoom':
        writer.u8(1);
        writer.i32(message.user);
        break;
      case 'JoinRoom':
        writer.u8(2);
        writer.i32(message.user);
        writer.string(message.name);
        break;
      case 'LeaveRoom':
        writer.u8(3);
        writer.i32(message.user);
        writer.string(message.name);
        break;
      case 'NewHost':
        writer.u8(4);
        writer.i32(message.user);
        break;
      case 'SelectChart':
        writer.u8(5);
        writer.i32(message.user);
        writer.string(message.name);
        writer.i32(message.id);
        break;
      case 'GameStart':
        writer.u8(6);
        writer.i32(message.user);
        break;
      case 'Ready':
        writer.u8(7);
        writer.i32(message.user);
        break;
      case 'CancelReady':
        writer.u8(8);
        writer.i32(message.user);
        break;
      case 'CancelGame':
        writer.u8(9);
        writer.i32(message.user);
        break;
      case 'StartPlaying':
        writer.u8(10);
        break;
      case 'Played':
        writer.u8(11);
        writer.i32(message.user);
        writer.i32(message.score);
        writer.f32(message.accuracy);
        writer.bool(message.fullCombo);
        break;
      case 'GameEnd':
        writer.u8(12);
        break;
      case 'Abort':
        writer.u8(13);
        writer.i32(message.user);
        break;
      case 'LockRoom':
        writer.u8(14);
        writer.bool(message.lock);
        break;
      case 'CycleRoom':
        writer.u8(15);
        writer.bool(message.cycle);
        break;
      default:
        throw new Error(`Unsupported message type: ${(message as any).type}`);
    }
  }
}
