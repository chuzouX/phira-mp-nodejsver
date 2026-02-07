# Phira 多人游戏服务器

中文说明 | [English](README.md)

基于 TypeScript 的 Node.js 服务器，支持 TCP 协议，专为多人在线游戏设计。

> **提示**：本项目中的部分代码是在 AI 辅助下完成的。

## 功能特性

- ✅ 支持 TypeScript，具备严格的类型检查
- ✅ 基于 TCP 套接字的实时通信服务器
- ✅ 通过环境变量进行配置管理
- ✅ 结构化日志记录
- ✅ 易于依赖注入的架构设计
- ✅ 完善的房间管理系统
- ✅ 协议处理层
- ✅ 使用 Jest 进行单元测试
- ✅ 使用 ESLint 和 Prettier 保证代码质量

### 新增增强功能 (由 chuzouX 贡献)

- 🖥️ **Web 仪表盘与管理系统**：提供完善的响应式 Web 界面，用于服务器管理和房间监控。
- 🎨 **UI/UX 增强**：支持深色模式（Dark Mode）和多语言国际化（i18n）。
- 🔐 **隐藏管理入口**：为超级管理员提供的安全隐藏访问通道。
- 🆔 **服务器身份自定义**：可通过环境变量自定义服务器播报名称和房间人数限制。
- ⚙️ **优化的房间逻辑**：改进了单人房间的处理逻辑及服务器端公告系统。
- 🛡️ **安全性与认证**：集成了管理员登录系统，支持会话管理及多平台验证码（Cloudflare Turnstile / 阿里云验证码 2.0）。

## 项目结构

```
.
├── public/         # Web 仪表盘资源 (HTML, JS, CSS, 多语言)
└── src/
    ├── config/     # 配置管理
    ├── logging/    # 日志工具
    ├── network/    # TCP、HTTP 和 WebSocket 服务器实现
    ├── domain/
    │   ├── auth/     # 玩家身份验证服务
    │   ├── rooms/    # 房间管理逻辑
    │   └── protocol/ # 二进制协议处理与指令定义
    ├── app.ts      # 应用工厂 (组件装配)
    └── index.ts    # 程序入口
```

## 快速开始

### 前置条件

- Node.js 18+ 
- npm 或 pnpm

### 安装

```bash
npm install
```

### 配置

复制示例环境配置文件：

```bash
cp .env.example .env
```

可用配置选项：

- `PORT`: 服务器端口（默认：3000）
- `HOST`: 服务器主机（默认：0.0.0.0）
- `TCP_ENABLED`: 启用 TCP 服务器（默认：true）
- `LOG_LEVEL`: 日志级别（默认：info）

### 开发模式

启动带热重载的开发服务器：

```bash
npm run dev
```

### 构建

编译 TypeScript 项目：

```bash
npm run build
```

### 生产环境

启动构建后的应用：

```bash
npm start
```

### 测试

运行测试：

```bash
npm test
```

以监听模式运行测试：

```bash
npm run test:watch
```

### 代码检查与格式化

检查代码质量：

```bash
npm run lint
```

修复 lint 问题：

```bash
npm run lint:fix
```

格式化代码：

```bash
npm run format
```

## Web API

服务器提供 Web API 用于状态监控和管理操作。

### 鉴权方式

管理类接口要求通过以下任一方式进行鉴权：

1.  **Session (浏览器)**：通过 `/admin` 页面登录。后续请求将通过 Cookie 自动鉴权。
2.  **动态管理密钥 (Admin Secret)**：适用于外部脚本或机器人。需发送基于 `.env` 中 `ADMIN_SECRET` 加密后的字符串。
    *   **Header**: `X-Admin-Secret: <加密十六进制串>`
    *   **URL 参数**: `?admin_secret=<加密十六进制串>`

请使用根目录下的 `generate_secret.py` 工具生成**当日有效**的加密串。

### 公开接口

#### **服务器状态**
返回服务器信息、在线人数及房间列表。
- **URL**: `GET /api/status`
- **示例**: `curl http://localhost:8080/api/status`

### 管理员接口

需要鉴权。

#### **所有玩家**
列出全服所有房间内当前连接的玩家。
- **URL**: `GET /api/all-players`

#### **系统广播**
向所有房间或指定房间发送系统消息。
- **URL**: `POST /api/admin/broadcast`
- **JSON 参数**:
  - `content`: 消息内容。
  - `target` (可选): 以 `#` 开头的房间 ID，例如 `#room1,room2`。

#### **踢出玩家**
强制将指定 ID 的玩家移出服务器。
- **URL**: `POST /api/admin/kick-player`
- **JSON 参数**: `{"userId": 12345}`

#### **房间管理**
- **强制开始**: `POST /api/admin/force-start` - `{"roomId": "123"}`
- **切换锁定**: `POST /api/admin/toggle-lock` - `{"roomId": "123"}`
- **设置人数上限**: `POST /api/admin/set-max-players` - `{"roomId": "123", "maxPlayers": 8}`
- **关闭房间**: `POST /api/admin/close-room` - `{"roomId": "123"}`

## TCP 协议

服务器使用 TCP 套接字进行通信。客户端可以使用 TCP 套接字连接到服务器并发送 JSON 格式的消息。

完整示例请参阅 `examples/tcp-client.ts`。

连接示例：
```typescript
import { createConnection } from 'net';

const client = createConnection({ port: 3000, host: 'localhost' });

client.on('connect', () => {
  console.log('Connected to Phira server');
  
  // 发送消息
  const message = JSON.stringify({ type: 'join', payload: { roomId: 'example' } });
  client.write(message);
});

client.on('data', (data) => {
  console.log('Received:', data.toString());
});
```

## 相关项目

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira)：适用于本项目的 NoneBot2 机器人插件。提供实时房间查询、网页截图监控、服务器节点状态查看以及完善的远程管理功能。

## 开源协议

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
