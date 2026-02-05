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
src/
├── config/         # 配置管理
├── logging/        # 日志工具
├── network/        # TCP 服务器组件
├── domain/
│   ├── rooms/      # 房间管理
│   └── protocol/   # 协议处理
├── __tests__/      # 测试文件
├── app.ts          # 应用引导
└── index.ts        # 入口文件
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

## 开源协议

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
