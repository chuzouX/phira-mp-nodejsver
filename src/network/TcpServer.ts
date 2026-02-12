/*
 * MIT License
 * Copyright (c) 2024
 */

import { Server as NetServer, Socket, createServer, AddressInfo } from 'net';
import { Logger } from '../logging/logger';
import { ProtocolHandler } from '../domain/protocol/ProtocolHandler';
import { BinaryReader, BinaryWriter } from '../domain/protocol/BinaryProtocol';
import { ClientCommandType, CommandParser, ServerCommand, ServerCommandType } from '../domain/protocol/Commands';

const PROTOCOL_VERSION = 1;

// Source: phira-mp-common/src/lib.rs:17-19
// Source: phira-mp-server/src/session.rs:164-166, 284-300
// 心跳机制：客户端每30秒发送 Ping，服务端立即响应 Pong
// 服务端监控最后收到消息的时间，超过40秒(30+10)无消息则认为心跳超时
const HEARTBEAT_PING_INTERVAL_MS = 30_000; // 30 seconds - 客户端发送 Ping 的间隔
const HEARTBEAT_PONG_TIMEOUT_MS = 10_000; // 10 seconds - 服务端等待下一个消息的容忍时间
const HEARTBEAT_MAX_MISSED = 3; // 最多允许错过3次心跳
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000; // 每5秒检查一次超时

interface ConnectionState {
  socket: Socket;
  proxyHeaderReceived: boolean;
  versionReceived: boolean;
  buffer: Buffer;
  version?: number;
  lastReceivedTime: number;
  missedHeartbeats: number;
  timeoutCheckInterval?: NodeJS.Timeout;
  realIp?: string;
}

export class TcpServer {
  private server?: NetServer;
  private readonly connections = new Map<string, ConnectionState>();
  private readonly connectionsPerIp = new Map<string, number>();
  private readonly illegalPacketCounts = new Map<string, { count: number; lastTime: number }>();
  
  private readonly MAX_PACKET_SIZE = 1024 * 1024; // 1MB limit per packet
  private readonly MAX_CONNECTIONS_PER_IP = 50;   // DoS protection

  private readonly PROXY_V2_SIGNATURE = Buffer.from([
    0x0D, 0x0A, 0x0D, 0x0A, 0x00, 0x0D, 0x0A, 0x51, 0x55, 0x49, 0x54, 0x0A,
  ]);

  constructor(
    private readonly logger: Logger,
    private readonly protocolHandler: ProtocolHandler,
    private readonly useProxyProtocol: boolean = false,
  ) {
      // Periodic cleanup of the tracker every 30 minutes
      setInterval(() => {
          const now = Date.now();
          for (const [ip, data] of this.illegalPacketCounts.entries()) {
              if (now - data.lastTime > 30 * 60 * 1000) {
                  this.illegalPacketCounts.delete(ip);
              }
          }
      }, 30 * 60 * 1000);
  }

  start(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer((socket: Socket) => {
          this.handleConnection(socket);
        });

        this.server.listen(port, host, () => {
          const address = this.server?.address();
          const runtimeHost = typeof address === 'object' && address ? address.address : host;
          const runtimePort = typeof address === 'object' && address ? address.port : port;

          this.logger.info(`TCP 服务器已启动：${runtimeHost}:${runtimePort}`);
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error(`TCP 服务器错误: ${error.message}`);
          reject(error);
        });
      } catch (error) {
        this.logger.error(`启动 TCP 服务器失败: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach((state, connectionId) => {
        this.clearTimeoutMonitor(state);
        state.socket.destroy();
        this.logger.debug(`关机时关闭连接: ${connectionId}`);
      });
      this.connections.clear();

      if (!this.server) {
        this.logger.info('已关闭 TCP 服务器');
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = undefined;
        this.logger.info('已关闭 TCP 服务器');
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    const ip = socket.remoteAddress || 'unknown';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    // Latency and Reliability optimizations
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000); // 1 minute keep-alive

    // Limit connections per IP
    const currentCount = this.connectionsPerIp.get(ip) || 0;
    if (currentCount >= this.MAX_CONNECTIONS_PER_IP) {
        this.logger.warn(`拦截到来自 IP ${ip} 的过多 TCP 连接尝试 (${currentCount})`);
        socket.destroy();
        return;
    }
    this.connectionsPerIp.set(ip, currentCount + 1);

    // Anti-clogging: Check if IP is already banned (skip for local proxy)
    const banManager = this.protocolHandler.getBanManager();
    const banInfo = banManager?.isIpBanned(ip);
    if (!isLocal && banInfo && banInfo.adminName === 'System') {
        this.logger.warn(`拦截到来自系统封禁 IP ${ip} 的 TCP 连接尝试`);
        socket.destroy();
        return;
    }

    const connectionId = this.generateConnectionId();

    const state: ConnectionState = {
      socket,
      proxyHeaderReceived: !this.useProxyProtocol,
      versionReceived: false,
      buffer: Buffer.alloc(0),
      lastReceivedTime: Date.now(),
      missedHeartbeats: 0,
    };

    this.connections.set(connectionId, state);

    this.logger.debug(`建立 TCP 连接: ${connectionId} (${socket.remoteAddress}:${socket.remotePort})`);

    // Initial handle with remoteAddress, will be updated if proxy protocol gives real IP
    this.protocolHandler.handleConnection(connectionId, () => this.forceCloseConnection(connectionId), ip);
    this.startTimeoutMonitor(connectionId, state);

    socket.on('data', (data: Buffer) => {
      try {
        state.lastReceivedTime = Date.now();
        state.missedHeartbeats = 0;
        state.buffer = Buffer.concat([state.buffer, data]);

        if (!state.proxyHeaderReceived) {
          if (!this.processProxyHeader(connectionId, state)) {
            return;
          }
        }

        if (!state.versionReceived) {
          if (state.buffer.length >= 1) {
            const version = state.buffer[0];
            state.buffer = state.buffer.subarray(1);
            state.versionReceived = true;
            state.version = version;

            this.logger.debug(`收到协议版本信息: ${connectionId} (版本: ${version})`);

            if (version !== PROTOCOL_VERSION) {
              this.logger.warn(`客户端协议版本不匹配: ${connectionId} (预期: ${PROTOCOL_VERSION}, 收到: ${version})`);
            }
          } else {
            return;
          }
        }

        this.processPackets(connectionId, state);
      } catch (error) {
        this.logger.error(`处理数据失败: ${connectionId} (${(error as Error).message})`);
      }
    });

    socket.on('close', () => {
      this.clearTimeoutMonitor(state);
      this.connections.delete(connectionId);
      
      const currentCount = this.connectionsPerIp.get(ip) || 1;
      if (currentCount <= 1) {
          this.connectionsPerIp.delete(ip);
      } else {
          this.connectionsPerIp.set(ip, currentCount - 1);
      }

      this.protocolHandler.handleDisconnection(connectionId);
      this.logger.debug(`TCP 连接被关闭: ${connectionId}`);
    });

    socket.on('error', (error) => {
      this.logger.error(`TCP 通信错误: ${connectionId} (${error.message})`);
      if (error.message.includes('ECONNABORTED') || error.message.includes('ECONNRESET')) {
          this.reportSuspiciousActivity(ip, connectionId, `连接重置/中止 (${error.message})`);
      }
    });
  }

  // Source: phira-mp-server/src/session.rs:284-300
  // Monitor last received time and disconnect after repeated heartbeat misses
  private startTimeoutMonitor(connectionId: string, state: ConnectionState): void {
    this.clearTimeoutMonitor(state);

    state.timeoutCheckInterval = setInterval(() => {
      if (state.socket.destroyed) {
        this.clearTimeoutMonitor(state);
        return;
      }

      const now = Date.now();
      const timeSinceLastReceived = now - state.lastReceivedTime;
      const allowableInactivity = HEARTBEAT_PING_INTERVAL_MS + HEARTBEAT_PONG_TIMEOUT_MS;

      if (timeSinceLastReceived <= allowableInactivity) {
        if (state.missedHeartbeats !== 0) {
          this.logger.debug(`[心跳] 恢复正常: ${connectionId} (连续次数: ${state.missedHeartbeats}, 延迟: ${timeSinceLastReceived}ms)`);
          state.missedHeartbeats = 0;
        }
        return;
      }

      state.missedHeartbeats += 1;

      this.logger.warn(`[心跳] 超时警告: ${connectionId} (连续次数: ${state.missedHeartbeats}, 延迟: ${timeSinceLastReceived}ms)`);

      if (state.missedHeartbeats >= HEARTBEAT_MAX_MISSED) {
        this.logger.error(`[心跳] 连续超时，正在断开连接: ${connectionId}`);
        this.clearTimeoutMonitor(state);
        state.socket.destroy(new Error('心跳包超时'));
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  private clearTimeoutMonitor(state: ConnectionState): void {
    if (state.timeoutCheckInterval) {
      clearInterval(state.timeoutCheckInterval);
      state.timeoutCheckInterval = undefined;
    }
  }

  private processProxyHeader(connectionId: string, state: ConnectionState): boolean {
    if (state.buffer.length < 16) {
      return false;
    }

    // Check signature
    if (state.buffer.subarray(0, 12).compare(this.PROXY_V2_SIGNATURE) !== 0) {
      this.logger.warn(`无效的 Proxy Protocol v2 签名: ${connectionId}`);
      state.proxyHeaderReceived = true; // Fallback to normal if signature doesn't match? 
      // Actually if useProxyProtocol is true, we expect it.
      return true;
    }

    const versionCommand = state.buffer[12];
    if ((versionCommand & 0xF0) !== 0x20) {
      this.logger.warn(`不支持的 Proxy Protocol 版本: ${connectionId} (0x${versionCommand.toString(16)})`);
      state.proxyHeaderReceived = true;
      return true;
    }

    const length = state.buffer.readUInt16BE(14);
    if (state.buffer.length < 16 + length) {
      return false;
    }

    const familyProto = state.buffer[13];
    let realIp: string | undefined;

    if (familyProto === 0x11) { // IPv4, Stream
      const srcAddr = `${state.buffer[16]}.${state.buffer[17]}.${state.buffer[18]}.${state.buffer[19]}`;
      realIp = srcAddr;
    } else if (familyProto === 0x21) { // IPv6, Stream
      const parts = [];
      for (let i = 0; i < 8; i++) {
        parts.push(state.buffer.readUInt16BE(16 + i * 2).toString(16));
      }
      realIp = parts.join(':');
    }

    if (realIp) {
      state.realIp = realIp;
      this.logger.info(`Proxy Protocol v2 识别到真实 IP: ${connectionId} -> ${realIp}`);
      
      // Update real IP in ProtocolHandler
      this.protocolHandler.updateConnectionIp(connectionId, realIp);
      
      // Re-check ban for the real IP
      const banManager = this.protocolHandler.getBanManager();
      const realIpBanInfo = banManager?.isIpBanned(realIp);
      if (realIpBanInfo && realIpBanInfo.adminName === 'System') {
          this.logger.warn(`拦截到来自系统封禁真实 IP ${realIp} 的 TCP 连接 (${connectionId})`);
          state.socket.destroy();
          return false;
      }
    }

    state.buffer = state.buffer.subarray(16 + length);
    state.proxyHeaderReceived = true;
    return true;
  }

  private processPackets(connectionId: string, state: ConnectionState): void {
    while (true) {
      if (state.buffer.length === 0) {
        break;
      }

      const lengthResult = this.readULEB(state.buffer);
      if (lengthResult === null) {
        break;
      }

      const { value: packetLength, bytesRead: lengthBytes } = lengthResult;

      if (packetLength > this.MAX_PACKET_SIZE) {
          const ip = state.socket.remoteAddress || 'unknown';
          this.logger.error(`收到过大的包: ${connectionId} (${ip}) (大小: ${packetLength} bytes), 强制断开连接`);
          this.forceCloseConnection(connectionId);
          this.reportSuspiciousActivity(ip, connectionId, '包大小超限');
          return;
      }

      if (state.buffer.length < lengthBytes + packetLength) {
        break;
      }

      const packetData = state.buffer.subarray(lengthBytes, lengthBytes + packetLength);
      state.buffer = state.buffer.subarray(lengthBytes + packetLength);

      try {
        const reader = new BinaryReader(packetData);
        const parsed = CommandParser.parseClientCommand(reader);

        if (parsed.command) {
          // Check for illegal token length (should be 20)
          if (parsed.command.type === ClientCommandType.Authenticate) {
            if (parsed.command.token.length !== 20) {
              const ip = state.socket.remoteAddress || 'unknown';
              this.logger.warn(`检测到非法的 Token 长度: ${connectionId} (${ip}) (长度: ${parsed.command.token.length})`);
              this.reportSuspiciousActivity(ip, connectionId, `非法 Token 长度 (${parsed.command.token.length})`);
              // Let protocolHandler handle the response to client but we've reported it
            }
          }

          // Source: phira-mp-server/src/session.rs:164-166
          // Client sends Ping, server responds with Pong immediately
          if (parsed.command.type === ClientCommandType.Ping) {
            this.logger.debug(`[心跳] 收到客户端 Ping，立即响应 Pong: ${connectionId} (延迟: ${Date.now() - state.lastReceivedTime}ms)`);
            this.sendCommand(state.socket, { type: ServerCommandType.Pong });
            continue;
          }

          this.protocolHandler.handleMessage(
            connectionId,
            parsed.command,
            (response: ServerCommand) => {
              this.sendCommand(state.socket, response);
            },
          );
        } else {
          // Source: phira-mp-common/src/command.rs:157-178
          // Touches (3) and Judges (4) are monitor-only features, silently ignore
          if (parsed.rawType === ClientCommandType.Touches || parsed.rawType === ClientCommandType.Judges) {
            // 静默忽略观战功能消息（Touches/Judges）
            continue;
          }
          
          this.logger.debug(`未处理的命令类型: ${connectionId} (原始类型: ${parsed.rawType})`);
        }
      } catch (error) {
        const ip = state.socket.remoteAddress || 'unknown';
        this.logger.error(`收到非法的包: ${connectionId} (${ip}) (${(error as Error).message})`);
        
        // Immediate action: close connection
        this.forceCloseConnection(connectionId);
        
        // Anti-clogging: Track illegal packets per IP and ban if necessary
        this.reportSuspiciousActivity(ip, connectionId, '非法数据包');
        break; // Stop processing this buffer
      }
    }
  }

  public reportSuspiciousActivity(ip: string, connectionId?: string, reason?: string): void {
      if (ip === 'unknown') return;

      let targetIp = ip;
      if (connectionId) {
          const state = this.connections.get(connectionId);
          if (state && state.realIp) {
              targetIp = state.realIp;
          }
      }

      // Anti-self-ban: skip automatic banning for local/proxy IPs if they are not the real source
      const isLocal = targetIp === '127.0.0.1' || targetIp === '::1' || targetIp === '::ffff:127.0.0.1';
      
      const now = Date.now();
      const data = this.illegalPacketCounts.get(targetIp) || { count: 0, lastTime: now };
      
      // Reset if last failure was long ago
      if (now - data.lastTime > 5 * 60 * 1000) {
          data.count = 0;
      }

      data.count += 1;
      data.lastTime = now;
      this.illegalPacketCounts.set(targetIp, data);

      if (data.count >= 10) {
          if (isLocal) {
              this.logger.warn(`检测到本地/穿透 IP ${targetIp} 触发可疑活动 (${data.count} 次: ${reason || '未知'}), 由于是穿透环境，跳过自动封禁。`);
              return;
          }

          const banManager = this.protocolHandler.getBanManager();
          if (banManager) {
              this.logger.error(`IP ${targetIp} 触发了过多可疑活动 (${data.count} 次: ${reason || '未知'}), 正在自动封禁该 IP 7天`);
              // 7 days = 7 * 24 * 3600 = 604800 seconds
              banManager.banIp(targetIp, 604800, `可疑活动过多 (系统自动封禁): ${reason || '异常行为'}`, 'System');
              this.illegalPacketCounts.delete(targetIp);
          }
      }
  }

  private readULEB(buffer: Buffer): { value: number; bytesRead: number } | null {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;

    while (bytesRead < buffer.length) {
      const byte = buffer[bytesRead];
      bytesRead++;

      result |= (byte & 0x7f) << shift;
      shift += 7;

      if ((byte & 0x80) === 0) {
        return { value: result, bytesRead };
      }

      if (shift > 32) {
        throw new Error('无效的ULEB编码');
      }
    }

    return null;
  }

  private sendCommand(socket: Socket, command: ServerCommand): void {
    try {
      const writer = new BinaryWriter();
      CommandParser.writeServerCommand(writer, command);
      const payload = writer.toBuffer();

      const lengthBuffer = this.writeULEB(payload.length);

      socket.write(lengthBuffer);
      socket.write(payload);
    } catch (error) {
      this.logger.error(`发送命令失败: ${(error as Error).message}`);
    }
  }

  private writeULEB(value: number): Buffer {
    const bytes: number[] = [];
    let v = value;

    while (true) {
      let byte = v & 0x7f;
      v >>= 7;

      if (v !== 0) {
        byte |= 0x80;
      }

      bytes.push(byte);

      if (v === 0) {
        break;
      }
    }

    return Buffer.from(bytes);
  }

  private forceCloseConnection(connectionId: string): void {
    const state = this.connections.get(connectionId);
    if (state && !state.socket.destroyed) {
      this.logger.info(`强制关闭连接: ${connectionId}`);
      this.clearTimeoutMonitor(state);
      state.socket.destroy();
    }
  }

  private generateConnectionId(): string {
    return `连接-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getServer(): NetServer | undefined {
    return this.server;
  }
}