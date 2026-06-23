/**
 * Phira Multiplayer Server — Plugin API Type Declarations
 *
 * 本文件为插件开发者提供完整的类型定义，无需依赖项目源码。
 *
 * TypeScript 插件使用方式:
 *   1. 将此文件放到插件项目中
 *   2. 在 tsconfig.json 中 include 此文件
 *   3. import type { PluginModule, PluginApi } from 'phira-plugin-api'
 *
 * JavaScript 插件使用方式:
 *   使用 JSDoc: @type {PhiraPlugin.PluginApi}
 */

declare module 'phira-plugin-api' {
  import type { Application as ExpressApp, RequestHandler, Request, Response, NextFunction } from 'express';
  import type { Server as HttpNodeServer } from 'http';

  // ======================== 日志 ========================

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

  // ======================== 协议 / 命令 ========================

  export interface CompactPos { xBits: number; yBits: number; }
  export interface TouchFrame { time: number; points: Array<{ id: number; pos: CompactPos }>; }

  export enum Judgement {
    Perfect = 0, Good = 1, Bad = 2, Miss = 3,
    HoldPerfect = 4, HoldGood = 5,
  }

  export interface JudgeEvent { time: number; lineId: number; noteId: number; judgement: Judgement; }

  export enum ClientCommandType {
    Ping = 0, Authenticate = 1, Chat = 2, Touches = 3, Judges = 4,
    CreateRoom = 5, JoinRoom = 6, LeaveRoom = 7, LockRoom = 8,
    CycleRoom = 9, SelectChart = 10, RequestStart = 11, Ready = 12,
    CancelReady = 13, Played = 14, Abort = 15, GameResult = 16,
  }

  export enum ServerCommandType {
    Pong = 0, Authenticate = 1, Chat = 2, Touches = 3, Judges = 4,
    Message = 5, ChangeState = 6, ChangeHost = 7, CreateRoom = 8,
    JoinRoom = 9, OnJoinRoom = 10, LeaveRoom = 11, LockRoom = 12,
    CycleRoom = 13, SelectChart = 14, RequestStart = 15, Ready = 16,
    CancelReady = 17, Played = 18, Abort = 19,
  }

  export type ClientCommand =
    | { type: ClientCommandType.Ping }
    | { type: ClientCommandType.Authenticate; token: string }
    | { type: ClientCommandType.Chat; message: string }
    | { type: ClientCommandType.Touches; frames: TouchFrame[] }
    | { type: ClientCommandType.Judges; judges: JudgeEvent[] }
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
    | { type: ClientCommandType.GameResult; score: number; accuracy: number; perfect: number; good: number; bad: number; miss: number; maxCombo: number };

  export interface UserInfo {
    id: number;
    name: string;
    avatar?: string;
    monitor: boolean;
    rks?: number;
    bio?: string;
  }

  export interface PlayerScore {
    score: number; accuracy: number; perfect: number; good: number;
    bad: number; miss: number; maxCombo: number; finishTime: number;
  }

  export interface PlayerRanking {
    rank: number; userId: number; userName: string; score: PlayerScore | null;
  }

  export type RoomState =
    | { type: 'SelectChart'; chartId: number | null }
    | { type: 'WaitingForReady' }
    | { type: 'Playing' };

  export interface ClientRoomState {
    id: string; state: RoomState; live: boolean; locked: boolean;
    cycle: boolean; isHost: boolean; isReady: boolean;
    users: Map<number, UserInfo>;
  }

  export interface JoinRoomResponse {
    state: RoomState; users: UserInfo[]; live: boolean;
  }

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

  export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

  export type ServerCommand =
    | { type: ServerCommandType.Pong }
    | { type: ServerCommandType.Authenticate; result: Result<[UserInfo, ClientRoomState | null]> }
    | { type: ServerCommandType.Chat; result: Result<void> }
    | { type: ServerCommandType.Touches; player: number; frames: TouchFrame[] }
    | { type: ServerCommandType.Judges; player: number; judges: JudgeEvent[] }
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
    | { type: ServerCommandType.Abort; result: Result<void> };

  // ======================== 房间 ========================

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
    uploaderInfo?: { id: number; name: string; avatar: string; rks: number; bio?: string };
  }

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
    removePlayerFromAllRooms(userId: number): void;
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

  // ======================== 协议处理器 ========================

  export interface ProtocolHandler {
    getSessionCount(): number;
    getAllSessions(): { id: number; name: string; roomId?: string; roomName?: string; ip: string }[];
    sendServerMessage(roomId: string, content: string): void;
    kickPlayer(userId: number): boolean;
    kickIp(ip: string): void;
    forceStartGame(roomId: string): boolean;
    toggleRoomLock(roomId: string): boolean;
    setRoomMaxPlayers(roomId: string, maxPlayers: number): boolean;
    closeRoomByAdmin(roomId: string): boolean;
    toggleRoomMode(roomId: string): boolean;
    sendCommandToUser(userId: number, command: ServerCommand): boolean;
    broadcastToRoomById(roomId: string, command: ServerCommand): boolean;
    broadcastRoomUpdate(room: Room): void;
    setRoomBlacklistByAdmin(roomId: string, userIds: number[]): Promise<boolean>;
    setRoomWhitelistByAdmin(roomId: string, userIds: number[]): Promise<boolean>;
    getConnectionIdByUserId(userId: number): string | undefined;
    handleConnection(connectionId: string, closeConnection?: () => void, ip?: string): void;
    handleDisconnection(connectionId: string): void;
    handleData(connectionId: string, data: Buffer): void;
    updateConnectionIp(connectionId: string, ip: string): void;
  }

  // ======================== 封禁 ========================

  export interface BanInfo {
    target: string | number;
    reason: string;
    createdAt: number;
    expiresAt: number | null;
    adminName?: string;
  }

  export interface BanManager {
    banId(userId: number, durationSeconds: number | null, reason: string, adminName?: string): void;
    banIp(ip: string, durationSeconds: number | null, reason: string, adminName?: string): void;
    unbanId(userId: number, adminName?: string): boolean;
    unbanIp(ip: string, adminName?: string): boolean;
    isIdBanned(userId: number): BanInfo | null;
    isIpBanned(ip: string): BanInfo | null;
    getAllBans(): { idBans: BanInfo[]; ipBans: BanInfo[] };
    getRemainingTimeStr(expiresAt: number | null): string;
    setWhitelists(ids: number[], ips: string[]): void;
  }

  // ======================== 联邦 ========================

  export interface FederationConfig {
    enabled: boolean;
    seedNodes: string[];
    secret: string;
    nodeId: string;
    nodeUrl: string;
    instanceId?: string;
    healthInterval: number;
    syncInterval: number;
    serverName: string;
    allowLocal: boolean;
  }

  export interface FederationNode {
    id: string;
    url: string;
    instanceId?: string;
    serverName: string;
    lastSeen: number;
    status: 'online' | 'offline' | 'unknown';
    addedAt: number;
  }

  export interface FederationRoomInfo {
    id: string;
    name: string;
    nodeId: string;
    nodeUrl: string;
    nodeName: string;
    playerCount: number;
    maxPlayers: number;
    state: RoomState;
    locked: boolean;
    cycle: boolean;
    ownerId: number;
    selectedChart?: any;
    messages?: any[];
    players: { id: number; name: string; avatar?: string }[];
  }

  export interface FederationManager {
    getNodeId(): string;
    getInstanceId(): string;
    getConfig(): FederationConfig;
    getNodes(): FederationNode[];
    getOnlineNodes(): FederationNode[];
    getRemoteRooms(): FederationRoomInfo[];
    getRemoteRoomInfo(roomId: string): FederationRoomInfo | undefined;
    getLocalRoomsForFederation(): any[];
    handleIncomingHandshake(data: { nodeId: string; nodeUrl: string; serverName: string; instanceId?: string; isReverse?: boolean }): any;
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  // ======================== 网络 ========================

  export interface NetworkServer {
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  export interface HttpServer {
    getExpressApp(): ExpressApp;
    getInternalServer(): HttpNodeServer;
    getSessionParser(): RequestHandler;
    getBlacklistedIps(): { ip: string; expiresAt: number }[];
    blacklistIpManual(ip: string, durationSeconds: number, adminName?: string): void;
    unblacklistIpManual(ip: string, adminName?: string): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  // ======================== 配置 ========================

  export interface ServerConfig {
    port: number;
    host: string;
    webPort: number;
    enableWebServer: boolean;
    useProxyProtocol: boolean;
    protocol: { tcp: boolean };
    logging: { level: string };
    phiraApiUrl: string;
    serverName: string;
    roomSize: number;
    adminPhiraId: number[];
    ownerPhiraId: number[];
    banIdWhitelist: number[];
    banIpWhitelist: string[];
    silentPhiraIds: number[];
    serverAnnouncement: string;
    defaultAvatar: string;
    enableUpdateCheck: boolean;
    trustProxyHops: number;
    enablePubWeb: boolean;
    pubPrefix: string;
    enablePriWeb: boolean;
    priPrefix: string;
    federationEnabled: boolean;
    federationSeedNodes: string[];
    federationSecret: string;
    federationNodeId: string;
    federationNodeUrl: string;
    federationHealthInterval: number;
    federationSyncInterval: number;
    federationAllowLocal: boolean;
    pluginsEnabled: boolean;
    // 以下为插件可选配置（由各插件通过 readPluginConfig 自行管理）
    sessionSecret?: string;
    loginBlacklistDuration?: number;
    displayIp?: string;
    allowedOrigins?: string[];
    captchaProvider?: 'geetest' | 'none';
    geetestId?: string;
    geetestKey?: string;
    [key: string]: any;
  }

  // ======================== 事件系统 ========================

  export type PluginEventMap = {
    'player:connect': { connectionId: string; ip: string };
    'player:auth:success': { connectionId: string; user: UserInfo; ip: string };
    'player:disconnect': { connectionId: string; userId?: number; user?: UserInfo; ip?: string };
    'room:beforeCreate': { connectionId: string; userId: number; roomId: string };
    'room:create': { room: Room; user: UserInfo; connectionId: string };
    'room:join': { room: Room; user: UserInfo; connectionId: string };
    'room:leave': { roomId: string; userId: number; userName: string; connectionId: string };
    'room:gameStart': { room: Room; triggeredBy: number; mode: 'ready' | 'solo-confirm' | 'force' };
    'room:gameEnd': { room: Room; rankings: Array<{ rank: number; userId: number; userName: string; score: number; accuracy: number }> };
    'protocol:beforeHandle': { connectionId: string; command: ClientCommand };
    'protocol:afterHandle': { connectionId: string; command: ClientCommand };
    'chat:message': { room: Room; userId: number; content: string; connectionId: string };
    [key: `custom:${string}`]: any;
  };

  export type PluginEventName = keyof PluginEventMap | `custom:${string}`;
  export type PluginEventHandler<T = any> = (payload: T) => void | Promise<void>;

  export interface PluginEventBus {
    on<T = any>(event: PluginEventName, handler: PluginEventHandler<T>): () => void;
    emit<T = any>(event: PluginEventName, payload: T): void;
    emitAsync<T = any>(event: PluginEventName, payload: T): Promise<void>;
  }

  // ======================== 插件 API ========================

  export type PluginRouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head' | 'use';

  export interface PacketHandlerRegistration {
    commandType: number;
    handler: (context: { connectionId: string; command: ClientCommand }) => void | Promise<void>;
  }

  export interface PluginApi {
    readonly config: ServerConfig;
    readonly logger: Logger;
    readonly roomManager: RoomManager;
    readonly protocolHandler: ProtocolHandler;
    readonly networkServer: NetworkServer;
    readonly httpServer?: HttpServer;
    readonly webSocketServer?: { broadcast(type: string, payload: any): void };
    readonly expressApp?: ExpressApp;
    readonly banManager: BanManager;
    readonly federationManager?: FederationManager;
    readonly events: PluginEventBus;
    readonly pluginName: string;

    /** 注册 HTTP 路由（需要 ENABLE_WEB_SERVER=true） */
    registerRoute(method: PluginRouteMethod, routePath: string, handler: RequestHandler): void;
    /** 挂载静态文件目录（rootDir 为相对路径时，相对于插件的 res/ 目录解析） */
    serveStatic(mountPath: string, rootDir: string): void;
    /** 获取 Express 应用实例 */
    getExpressApp(): ExpressApp | undefined;
    /** 获取插件配置目录路径 */
    getPluginConfigDir(): string;
    /** 读取 config/<pluginName>/config.yaml */
    readPluginConfig<T = any>(): T | undefined;
    /** 写入插件配置（自动创建目录） */
    writePluginConfig(config: unknown): void;
    /** 向所有 WebSocket 客户端广播 */
    broadcastWs(event: string, data: any): void;
    /** 注册控制台命令（通过 /<name> 调用） */
    registerCommand(name: string, handler: (...args: string[]) => void | Promise<void>): void;
    /** 注册协议数据包处理器 */
    registerPacketHandler(registration: PacketHandlerRegistration): void;
    /** 向指定房间广播协议命令 */
    broadcastToRoom(roomId: string, command: ServerCommand): boolean;
  }

  // ======================== 插件模块 ========================

  /**
   * 插件元数据（plugin.yaml 文件格式）
   */
  export interface PluginMetadata {
    /** 插件唯一标识符（必需） */
    id: string;
    /** 插件显示名称（必需） */
    name: string;
    /** 插件版本号（必需，推荐语义化版本） */
    version: string;
    /** 插件描述（可选） */
    description?: string;
    /** 作者信息（可选） */
    author?: string;
    /** 许可证（可选） */
    license?: string;
    /** 项目主页（可选） */
    homepage?: string;
    /** 仓库地址（可选） */
    repository?: string;
    /** 插件主文件，相对于 res/ 目录（可选，默认为 main.js） */
    main?: string;
    /** 依赖的其他插件（可选） */
    dependencies?: Record<string, string>;
    /** 要求的服务器版本（可选） */
    serverVersion?: string;
    /** 插件标签（可选） */
    tags?: string[];
  }

  export interface PluginModule {
    /** 插件名称（已废弃，请使用 plugin.yaml 中的 name 字段） */
    name?: string;
    /** 插件初始化入口 */
    init(api: PluginApi): void | Promise<void>;
    /** 插件销毁（可选） */
    destroy?(): void | Promise<void>;
  }
}

// ======================== 全局命名空间（供 JS / JSDoc 使用）========================

declare namespace PhiraPlugin {
  // Re-export all types for JSDoc usage: /** @type {PhiraPlugin.PluginApi} */
  export type LogLevel = import('phira-plugin-api').LogLevel;
  export type Logger = import('phira-plugin-api').Logger;
  export type ServerConfig = import('phira-plugin-api').ServerConfig;
  export type RoomManager = import('phira-plugin-api').RoomManager;
  export type Room = import('phira-plugin-api').Room;
  export type PlayerInfo = import('phira-plugin-api').PlayerInfo;
  export type ChartInfo = import('phira-plugin-api').ChartInfo;
  export type UserInfo = import('phira-plugin-api').UserInfo;
  export type ProtocolHandler = import('phira-plugin-api').ProtocolHandler;
  export type BanManager = import('phira-plugin-api').BanManager;
  export type BanInfo = import('phira-plugin-api').BanInfo;
  export type FederationManager = import('phira-plugin-api').FederationManager;
  export type HttpServer = import('phira-plugin-api').HttpServer;
  export type NetworkServer = import('phira-plugin-api').NetworkServer;
  export type ClientCommand = import('phira-plugin-api').ClientCommand;
  export type ServerCommand = import('phira-plugin-api').ServerCommand;
  export type RoomState = import('phira-plugin-api').RoomState;
  export type Message = import('phira-plugin-api').Message;
  export type PluginApi = import('phira-plugin-api').PluginApi;
  export type PluginModule = import('phira-plugin-api').PluginModule;
  export type PluginEventBus = import('phira-plugin-api').PluginEventBus;
  export type PluginEventMap = import('phira-plugin-api').PluginEventMap;
  export type PluginEventName = import('phira-plugin-api').PluginEventName;
  export type PacketHandlerRegistration = import('phira-plugin-api').PacketHandlerRegistration;
  export type PluginRouteMethod = import('phira-plugin-api').PluginRouteMethod;
}
