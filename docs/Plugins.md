# Plugins.md — 插件开发指南

本文档介绍 phira-mp-server 的插件系统，包括开发规范、API 参考和事件列表。

---

## 目录

- [概览](#概览)
- [插件管理](#插件管理)
- [社区插件开发](#社区插件开发)
  - [JavaScript 插件（推荐入门）](#javascript-插件推荐入门)
  - [TypeScript 插件](#typescript-插件)
- [插件生命周期](#插件生命周期)
- [PluginApi 参考](#pluginapi-参考)
  - [上下文属性](#上下文属性)
  - [事件总线](#事件总线)
  - [HTTP 路由](#http-路由)
  - [控制台命令](#控制台命令)
  - [数据包处理器](#数据包处理器)
  - [WebSocket 广播](#websocket-广播)
  - [房间广播](#房间广播)
  - [插件配置](#插件配置)
- [事件参考](#事件参考)
- [内置插件](#内置插件)

---

## 概览

插件系统允许在不修改核心代码的前提下扩展服务器功能。**社区开发者无需项目源码**，只需将插件文件夹放入 `plugins/` 目录即可被服务端自动加载。

### 插件索引

社区插件可访问 **插件索引仓库** 浏览和发现：

> **[github.com/chuzouX/phira-mp-nodejsver-index](https://github.com/chuzouX/phira-mp-nodejsver-index)**

该仓库收录了由社区开发者贡献的可用插件，每个插件包含简要说明、版本要求和安装方式。开发者也可通过提交 PR 将自己的插件加入索引。

### 插件目录结构

```
plugins/
├── my-plugin/
│   ├── plugin.yaml           # 插件元数据（必需）
│   ├── config.default.yaml   # 默认配置模板（可选，用于自动创建配置）
│   ├── README.md             # 插件文档（可选）
│   └── res/                  # 资源目录
│       ├── main.js           # 插件入口（必需）
│       ├── main.ts           # TypeScript 源文件
│       ├── lib/              # 其他代码文件
│       └── public/           # 静态资源（Web UI）
├── web-dashboard/
│   ├── plugin.yaml
│   ├── config.default.yaml
│   └── res/
│       ├── main.js
│       └── public/
└── websocket/
    ├── plugin.yaml
    └── res/
        ├── main.js
        └── lib/
```

### 插件元数据（plugin.yaml）

每个插件**必须**包含 `plugin.yaml` 元数据文件：

```yaml
# 插件唯一标识符（必需）
id: my-plugin

# 插件 UUID（必需，使用 UUID v4 格式）
uuid: a7f3e8d1-4b2c-4a9f-8e7d-1c5b9a3f6e2d

# 插件显示名称（必需）
name: My Plugin

# 版本号（必需，推荐使用语义化版本）
version: 1.0.0

# 插件描述（可选）
description: 这是一个示例插件

# 作者信息（可选）
author: Your Name

# 许可证（可选）
license: MIT

# 项目主页（可选）
homepage: https://github.com/user/my-plugin

# 仓库地址（可选）
repository: https://github.com/user/my-plugin

# 插件主文件（可选，默认为 main.js）
main: main.js

# 依赖的其他插件（可选，使用依赖插件的 UUID）
dependencies:
  - b9e2f5a8-7c3d-4f1e-9a6b-2d8c4e5f7a1b  # web-dashboard 的 UUID
  web-dashboard: ">=1.0.0"

# 要求的服务器版本（可选）
serverVersion: ">=0.4.0"

# 插件标签（可选）
tags:
  - utility
  - admin
```

插件配置文件存放在 `config/<plugin-name>/config.yaml`：

```
config/
├── my-plugin/
│   └── config.yaml
└── web-dashboard/
    └── config.yaml
```

启用条件：`.env` 中设置 `PLUGINS_ENABLED=true`（默认启用）。

---

## 插件管理

服务器提供控制台命令来管理插件：

### 控制台命令

| 命令 | 说明 |
|------|------|
| `/plugins [list]` | 列出所有插件（包括已禁用） |
| `/plugins info <name>` | 查看插件详细信息 |
| `/plugins help` | 显示帮助信息 |
| `/plugins reload [name]` | 重载插件（不指定则重载全部） |
| `/plugins enable <name>` | 启用已禁用的插件 |
| `/plugins disable <name>` | 禁用插件（添加前缀 !） |
| `/plugins install <name>` | 安装并加载 plugins 目录下的插件 |
| `/plugins uninstall <name>` | 卸载并删除插件目录 |

### 插件状态

- **已启用**: 插件目录正常，已加载运行
- **已禁用**: 插件目录以 `!` 开头，不会被加载

### 自动配置创建

插件加载时会自动检查配置文件：

1. 检查 `config/{pluginName}/config.yaml` 是否存在
2. 如果不存在，查找默认配置模板：
   - `plugins/{pluginName}/config.default.yaml`
   - `plugins/{pluginName}/res/config.default.yaml`
3. 如果找到模板，自动创建配置文件

这使得插件首次加载时无需手动创建配置文件。

---

## 社区插件开发

### JavaScript 插件（推荐入门）

最简单的方式 — 直接编写 `.js` 文件，无需编译，无需源码：

**1. 创建插件目录结构**

```bash
mkdir -p plugins/my-plugin/res
```

**2. 创建 plugin.yaml 元数据文件**

```yaml
# plugins/my-plugin/plugin.yaml
id: my-plugin
name: My Plugin
version: 1.0.0
description: 我的第一个插件
author: Your Name
license: MIT
main: main.js
serverVersion: ">=0.4.0"
```

**3. 编写插件代码**

```js
// plugins/my-plugin/res/main.js

/** @type {PhiraPlugin.PluginModule} */
module.exports = {
  init(api) {
    api.logger.info('[my-plugin] 已加载');

    // 监听事件
    api.events.on('player:auth:success', ({ user }) => {
      api.logger.info(`[my-plugin] 欢迎 ${user.name}!`);
    });

    // 注册 HTTP 路由
    api.registerRoute('get', '/api/my-plugin/hello', (_req, res) => {
      res.json({ message: 'hello', players: api.protocolHandler.getSessionCount() });
    });

    // 注册控制台命令（/greet 张三）
    api.registerCommand('greet', (name) => {
      api.logger.info(`[my-plugin] 你好, ${name || '世界'}!`);
    });
  },

  destroy() {
    // 清理资源（可选）
  }
};
```

**4. 启动服务器**

插件会自动加载，无需编译。

如需类型提示（JSDoc），从 Release 页面下载 `plugin-api.d.ts`，放在插件目录中，编辑器会自动识别 `PhiraPlugin.*` 命名空间。

### TypeScript 插件

适合大型插件开发，拥有完整类型检查：

**1. 创建插件目录结构**

```bash
mkdir -p plugins/my-plugin/res/lib
```

**2. 创建 plugin.yaml 元数据文件**

```yaml
# plugins/my-plugin/plugin.yaml
id: my-plugin
name: My Plugin
version: 1.0.0
description: TypeScript 示例插件
author: Your Name
license: MIT
main: main.js  # 编译后的文件
serverVersion: ">=0.4.0"
```

**3. 获取类型声明文件**

从 Release 页面下载 `plugin-api.d.ts`，放到项目根目录或插件目录中。

**4. 编写插件**

```ts
// plugins/my-plugin/res/main.ts
import type { PluginModule, PluginApi } from 'phira-plugin-api';

const pluginModule: PluginModule = {
  init(api: PluginApi) {
    api.logger.info('[my-plugin] 已加载');

    // 支持相对路径加载其他模块
    // import { helper } from './lib/helper';
    
    // 静态资源使用相对路径（相对于 res 目录）
    // api.serveStatic('/my-plugin', 'public');
  },

  destroy() {},
};

export default pluginModule;
```

**5. 编译插件**

插件的 TypeScript 文件会随服务器一起编译：

```bash
npx tsc
```

将生成的 `index.js` 和其他资源文件放入 `plugins/my-plugin/` 即可。服务端只加载 `index.js`。

---

## 插件生命周期

```
服务器启动
  → TCP / HTTP 服务启动完毕
  → 联邦节点启动（如已启用）
  → PluginManager.loadAllFromDirectory()
      → 按目录名字母序扫描 plugins/
      → 对每个插件: require(index.js) → 调用 init(api)
  → 控制台就绪

服务器关闭
  → PluginManager.destroyAll()
      → 对每个插件: 调用 destroy()（如已定义）
  → 联邦节点停止
  → TCP / HTTP 服务停止
```

**重要事项：**
- 服务端优先加载 `index.js`；仅在开发模式（ts-node）下才 fallback 到 `index.ts`
- 加载顺序由目录名字母序决定。如果插件间有依赖关系，可通过命名前缀控制（如 `00-base`、`01-dashboard`）
- `init` 支持同步和异步（`async init`）
- `destroy` 中应清理所有资源：取消事件监听、清除定时器、关闭连接等

---

## PluginApi 参考

`init(api)` 中的 `api` 对象提供以下能力：

### 上下文属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | `ServerConfig` | 服务器配置（只读） |
| `logger` | `Logger` | 日志记录器（`info` / `debug` / `warn` / `error`） |
| `roomManager` | `RoomManager` | 房间管理器 |
| `protocolHandler` | `ProtocolHandler` | 协议处理器（管理玩家会话） |
| `networkServer` | `NetworkServer` | TCP 服务器实例 |
| `httpServer` | `HttpServer \| undefined` | HTTP 服务器（`ENABLE_WEB_SERVER=false` 时为 `undefined`） |
| `banManager` | `BanManager` | 封禁管理器 |
| `federationManager` | `FederationManager \| undefined` | 联邦管理器（未启用联邦时为 `undefined`） |
| `pluginName` | `string` | 当前插件名称 |

### 事件总线

通过 `api.events` 访问，用于监听服务器内部事件。

```js
// 监听事件，返回取消函数
const unsub = api.events.on('player:auth:success', ({ user }) => {
  api.logger.info(`玩家 ${user.name} 已认证`);
});

// 取消监听
unsub();

// 只监听一次；首次调用前会自动注销，递归触发也不会重复执行
api.events.once('room:gameStart', ({ room }) => {
  api.logger.info(`房间 ${room.name} 首次开始游戏`);
});

// 也可以按原处理函数注销；返回是否成功移除了监听器
const onChat = ({ content }) => api.logger.info(content);
api.events.on('chat:message', onChat);
api.events.off('chat:message', onChat);

// 查询当前监听器数量
api.logger.debug(`聊天监听器数量: ${api.events.listenerCount('chat:message')}`);

// 触发自定义事件（同步）
api.events.emit('custom:my-event', { data: 123 });

// 触发自定义事件（异步，等待所有处理器完成）
await api.events.emitAsync('custom:my-event', { data: 123 });
```

### HTTP 路由

需要 `ENABLE_WEB_SERVER=true`。

```js
// 注册路由
api.registerRoute('get', '/api/my-plugin/status', (req, res) => {
  res.json({ ok: true });
});

// 支持的方法: get, post, put, patch, delete, options, head, use
// 'use' 可挂载中间件或子路由器（Express Router）

// 挂载静态文件目录
// 相对路径会相对于插件的 res 目录解析
api.serveStatic('/my-plugin', 'public');  // 推荐：相对路径

// 或使用绝对路径
const path = require('path');
api.serveStatic('/my-plugin', path.join(__dirname, 'public'));

// 获取 Express 应用实例（高级用法）
const app = api.getExpressApp();
```

### 控制台命令

注册后可在服务器控制台通过 `/<命令名>` 调用。

```js
api.registerCommand('greet', (name) => {
  api.logger.info(`你好, ${name || '世界'}!`);
});
// 控制台输入: /greet 张三
```

### 数据包处理器

拦截特定类型的客户端协议数据包。

```js
api.registerPacketHandler({
  commandType: 0x10, // 数据包类型编号
  handler: async ({ connectionId, command }) => {
    api.logger.debug(`收到数据包 0x10 来自 ${connectionId}`);
  },
});
```

### WebSocket 广播

向所有已连接的 WebSocket 客户端广播消息（需要 `websocket` 插件已加载）。

```js
api.broadcastWs('my-event', { message: 'hello' });
```

### 房间广播

向指定房间内所有玩家发送协议命令。

```js
api.broadcastToRoom(roomId, serverCommand);
```

### 服务器数据访问 API

插件可以通过以下 API 获取服务器数据：

#### 获取在线玩家

```js
const players = api.getOnlinePlayers();
// 返回: [{ id, name, connectionId, roomId, roomName, ip, isAdmin, isOwner }, ...]
```

#### 获取房间列表

```js
const rooms = api.getRooms();
// 返回: [{ id, name, playerCount, maxPlayers, state, locked, cycle, ownerId, players }, ...]
```

#### 获取房间详情

```js
const room = api.getRoom('room-id');
// 返回: { id, name, playerCount, maxPlayers, state, locked, cycle, ownerId, players } 或 undefined
```

#### 获取服务器统计

```js
const stats = api.getServerStats();
// 返回: { serverName, onlinePlayers, roomCount, uptime, memoryUsage }
```

#### 获取封禁列表

```js
const bans = api.getBanList();
// 返回: { idBans: [...], ipBans: [...] }
```

#### 权限检查

```js
const isAdmin = api.isUserAdmin(userId);
const isOwner = api.isUserOwner(userId);
```

`Owner` 是最高权限角色并继承全部 `Admin` 权限，因此 Owner 调用
`api.isUserAdmin(userId)` 时也会返回 `true`。

#### 获取玩家信息

```js
const player = api.getPlayer(userId);
// 返回: { id, name, connectionId, roomId, roomName, ip, isAdmin, isOwner } 或 undefined
```

#### 管理操作

```js
// 发送系统消息
api.sendServerMessage(roomId, 'Hello!');

// 踢出玩家
api.kickPlayer(userId);

// 封禁/解封玩家
api.banPlayer(userId, 3600, '违规', 'Admin');
api.unbanPlayer(userId, 'Admin');

// 封禁/解封 IP
api.banIp('192.168.1.1', 3600, '违规', 'Admin');
api.unbanIp('192.168.1.1', 'Admin');

// 房间管理
api.forceStartGame(roomId);
api.toggleRoomLock(roomId);
api.setRoomMaxPlayers(roomId, 4);
api.closeRoom(roomId);
```

### 插件配置

插件配置以 YAML 格式存储在 `config/<plugin-name>/config.yaml`。

```js
// 读取配置（文件不存在时返回 undefined）
const cfg = api.readPluginConfig();

// 写入配置（自动创建目录）
api.writePluginConfig({ greeting: '你好', maxRetries: 3 });

// 获取配置目录路径
const dir = api.getPluginConfigDir();
// → "config/my-plugin"
```

配置文件示例 (`config/example/config.yaml`)：

```yaml
greeting: "你好"
maxRetries: 3
```

### 默认配置模板

插件可以在目录中提供 `config.default.yaml` 文件作为默认配置模板：

```
plugins/my-plugin/
├── plugin.yaml
├── config.default.yaml   ← 默认配置模板
└── res/
    └── main.ts
```

当插件首次加载时，如果 `config/{pluginName}/config.yaml` 不存在，系统会自动使用模板创建配置文件。

示例 `config.default.yaml`：

```yaml
# 插件配置
enabled: true
greeting: "你好"
maxRetries: 3
```

---

## 事件参考

以下是 `api.events.on(event, handler)` 可监听的全部事件：

| 事件名 | 载荷类型 | 触发时机 |
|--------|----------|----------|
| `player:connect` | `{ connectionId, ip }` | 玩家 TCP 连接建立 |
| `player:auth:success` | `{ connectionId, user, ip }` | 玩家认证成功 |
| `player:disconnect` | `{ connectionId, userId?, user?, ip? }` | 玩家断开连接 |
| `room:beforeCreate` | `{ connectionId, userId, roomId }` | 房间创建前 |
| `room:create` | `{ room, user, connectionId }` | 房间创建后 |
| `room:join` | `{ room, user, connectionId }` | 玩家加入房间 |
| `room:leave` | `{ roomId, userId, userName, connectionId }` | 玩家离开房间 |
| `room:gameStart` | `{ room, triggeredBy, mode }` | 游戏开始（`mode`: `ready` / `solo-confirm` / `force`） |
| `room:gameEnd` | `{ room, rankings }` | 游戏结束，附带排名数据 |
| `protocol:beforeHandle` | `{ connectionId, command }` | 协议命令处理前 |
| `protocol:afterHandle` | `{ connectionId, command }` | 协议命令处理后 |
| `chat:message` | `{ room, userId, content, connectionId }` | 房间内聊天消息 |
| `custom:*` | `any` | 插件自定义事件（`custom:` 前缀） |

其中 `user` 类型为 `UserInfo`（包含 `id`、`name` 等字段），`room` 类型为 `Room`，`command` 类型为 `ClientCommand`。

---

## 内置插件

项目自带以下内置插件：

### 1. **web-dashboard** — Web 管理面板

提供完整的 Web 管理界面，包括服务器状态监控、房间管理、玩家管理等功能。

**配置文件**: `config/web-dashboard/config.yaml`

```yaml
# 显示的服务器 IP/域名
displayIp: "your-server.com:666"

# Session 密钥（强烈建议修改）
sessionSecret: "change-this-to-a-random-secret"

# 登录失败后 IP 黑名单持续时间（秒）
loginBlacklistDuration: 600

# 验证码提供商 (geetest / none)
captchaProvider: none

# 极验验证码配置
# geetestId: "your-geetest-id"
# geetestKey: "your-geetest-key"

# 允许的跨域来源
allowedOrigins:
  - http://localhost:28080
  - https://your-domain.com

# Web 房间过滤规则
enablePubWeb: false  # 仅显示特定前缀的房间
pubPrefix: "pub"     # 公开房间前缀
enablePriWeb: false  # 隐藏特定前缀的房间
priPrefix: "sm"      # 私密房间前缀
```

**注意**: 这些配置项在 v0.4.2 之前位于 `.env` 文件中，现已迁移到插件配置。旧的环境变量仍然作为后备选项保留。

### 2. **websocket** — WebSocket 实时通信

为 Web 管理面板提供实时房间和玩家状态更新。依赖 `web-dashboard` 插件。

**配置文件**: `config/websocket/config.yaml`

```yaml
# 允许的跨域来源（可选，默认继承服务器配置）
allowedOrigins:
  - http://localhost:28080
```

### 3. **example** — 示例插件

展示插件系统核心 API 的用法，可作为开发模板。

**配置文件**: `config/example/config.yaml`

```yaml
# 问候语
greeting: "你好"
```

### 4. **nonebot-auth** — NoneBot 鉴权插件

为 NoneBot 机器人和外部脚本提供 API 访问鉴权。支持 SHA-256 和 AES-256-CBC 两种认证方式。

**配置文件**: `config/nonebot-auth/config.yaml`

```yaml
# 管理员密钥
adminSecret: "your-admin-secret"

# 哈希算法 (sha256 或 sha512)
secretHashAlgorithm: sha256

# 认证模式 (sha256 / aes-cbc / both)
authMode: both

# 是否启用日志
enableLogging: true
```

**API 端点**:
- `GET /api/nonebot/test` - 测试鉴权
- `GET /api/nonebot/status` - 服务器状态

### 5. **room-announcer** — 房间播报插件

实时监测公开房间列表，当房间列表变化时自动向未在房间中的玩家播报。

**配置文件**: `config/room-announcer/config.yaml`

```yaml
# 是否启用插件
enabled: true

# 检测间隔（毫秒）
checkInterval: 5000

# 玩家登录时是否播报
announceOnJoin: true

# 登录播报延迟（毫秒）
announceDelay: 1500

# 是否显示房间人数
showPlayerCount: true

# 是否显示房间状态
showRoomState: true

# 是否只播报公开房间
publicOnly: true

# 公开房间前缀
publicPrefix: "pub"

# 播报消息前缀
messagePrefix: "【房间播报】"
```

**控制台命令**:
- `/roomlist` - 查看当前房间列表
- `/roomannouncer status` - 查看插件状态
- `/roomannouncer announce` - 手动触发播报

---

| 插件 | 目录 | 说明 |
|------|------|------|
| **web-dashboard** | `plugins/web-dashboard/` | Web 管理面板，提供登录、房间管理、封禁管理、联邦路由等完整后台 |
| **websocket** | `plugins/websocket/` | WebSocket 服务，为前端提供实时房间状态推送 |
| **example** | `plugins/example/` | 示例插件，展示事件监听、路由注册、控制台命令、配置读写等核心用法 |
| **nonebot-auth** | `plugins/nonebot-auth/` | NoneBot 鉴权插件，支持 SHA-256 和 AES-256-CBC 认证 |
| **room-announcer** | `plugins/room-announcer/` | 房间播报插件，自动向玩家播报公开房间列表 |
