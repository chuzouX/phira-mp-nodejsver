# Phira 多人游戏服务器

中文说明 | [English](README.md)

基于 TypeScript 的 Node.js 服务器，支持 TCP 协议，专为多人在线游戏设计。

> **提示**：本项目中的部分代码是在 AI 辅助下完成的。

## 功能特性

- ✅ 支持 TypeScript，具备严格的类型检查
- ✅ 基于 TCP 套接字的实时通信服务器
- ✅ 通过环境变量进行配置管理
- ✅ 具备**洪泛保护**的结构化日志记录
- ✅ 易于依赖注入的架构设计
- ✅ 完善的房间管理系统
- ✅ 协议处理层
- ✅ 使用 Jest 进行单元测试
- ✅ 使用 ESLint 和 Prettier 保证代码质量

### 新增增强功能 (由 chuzouX 贡献)

- 🖥️ **管理后台**：独立的 `/panel` 页面，用于服务器管理和实时监控。
- 🎨 **UI/UX 增强**：支持深色模式（Dark Mode）和多语言国际化（i18n）。
- 🔐 **隐藏入口**：通过标题触发的管理员安全访问通道。
- ⚙️ **优化的房间逻辑**：改进了单人房间处理及全服广播系统。
- 🛡️ **高级安全防护**：
    - **多重 IP 识别**：支持 **Proxy Protocol v2** (TCP) 及 **HTTP 转发头** (X-Forwarded-For, X-Real-IP)，确保在各种反代环境下都能精准识别玩家真实 IP。
    - **全站 Web 拦截**：被封禁的 IP 将无法访问任何 Web 资源（管理面板、公开 API、WebSocket），有效防止恶意扫描与 API 滥用。
    - **防暴力破解**：管理面板集成“登录黑名单”机制，自动拦截多次尝试失败的 IP，防御爆破攻击及潜在的 SSRF 探测。
    - **差异化封禁**：区分管理员封禁与系统封禁（系统封禁即时断开，管理员封禁显示详细原因与时长）。
    - **自定义显示 IP**：通过 `DISPLAY_IP` 配置，可在网页端显示自定义的服务器地址或域名。
    - **封禁联动**：封禁 IP 时自动踢出该 IP 下的所有在线玩家。
    - **审计日志**：专用 `logs/ban.log` 记录所有封禁、解封及异常登录尝试。

## 项目结构

```
.
├── data/           # 持久化数据 (封禁列表、黑名单)
├── public/         # Web 仪表盘资源 (HTML, JS, CSS, 多语言)
└── src/
    ├── config/     # 配置管理
    ├── logging/    # 日志工具
    ├── network/    # TCP、HTTP 和 WebSocket 服务器实现
    ├── domain/
    │   ├── auth/     # 玩家身份验证与封禁管理
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

## 环境变量配置 (.env)

| 变量名 | 描述 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 游戏 TCP 服务器监听端口 | `12346` |
| `WEB_PORT` | HTTP/WS 管理服务器端口 | `8080` |
| `TCP_ENABLED` | 是否启用 TCP 游戏服务器 | `true` |
| `USE_PROXY_PROTOCOL` | 是否开启 Proxy Protocol v2 以获取真实 IP | `false` |
| `ENABLE_WEB_SERVER` | 是否启用 Web 管理服务器 | `true` |
| `SERVER_NAME` | 服务器在游戏内显示的播报名称 | `Server` |
| `PHIRA_API_URL` | Phira 官方 API 地址 | `https://phira.5wyxi.com` |
| `ROOM_SIZE` | 默认房间最大玩家人数 | `8` |
| `ADMIN_NAME` | 管理后台登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理后台登录密码 | `password` |
| `ADMIN_SECRET` | 外部脚本使用的加密密钥 | (空) |
| `ADMIN_PHIRA_ID` | 管理员 Phira ID 列表 (逗号分隔) | (空) |
| `OWNER_PHIRA_ID` | 所有者 Phira ID 列表 (逗号分隔) | (空) |
| `BAN_ID_WHITELIST` | 封禁白名单 ID (逗号分隔) | (空) |
| `BAN_IP_WHITELIST` | 封禁白名单 IP (逗号分隔) | (空) |
| `SILENT_PHIRA_IDS` | **静默用户** ID 列表 (不产生日志) | (空) |
| `SERVER_ANNOUNCEMENT` | 玩家加入服务器时显示的欢迎公告内容 | (简版默认值) |
| `SESSION_SECRET` | 会话加密密钥 | (默认不安全值) |
| `LOGIN_BLACKLIST_DURATION` | 后台登录失败后的黑名单拦截时长 (秒) | `600` |
| `LOG_LEVEL` | 日志级别 (`debug`, `info`, `warn`, `error`) | `info` |
| `DISPLAY_IP` | 在网页底部显示的服务器 IP/域名 | `phira.funxlink.fun:19723` |
| `DEFAULT_AVATAR` | 默认头像 URL (用于无头像用户/机器人) | (Phira 默认值) |
| `CAPTCHA_PROVIDER` | 验证码提供商 (`geetest` 或 `none`) | `none` |

## 部署与运行

本项目支持打包为独立的可执行文件（无需安装 Node.js 即可运行）。

### 1. 下载或构建
使用 `npm run package:all` 构建所有版本（文件将生成在 `outputs/` 目录中）。

### 2. 各平台运行方式

#### **Windows**
- 直接双击 `phira-mp-nodejsver.exe`。
- 首次运行会自动生成默认的 `.env` 配置文件。

#### **Linux**
- 赋予执行权限：`chmod +x phira-mp-nodejsver-linux`
- 启动：`./phira-mp-nodejsver-linux`

#### **macOS**
- 赋予执行权限：`chmod +x phira-mp-nodejsver-macos-arm64` (或 `x64`)
- **修复签名警告**：如果无法启动，请在终端运行：
  ```bash
  codesign --sign - phira-mp-nodejsver-macos-arm64
  ```
- **右键打开**：如果被系统拦截，请右键点击文件选择“打开”。

### 生产环境 (源码模式)

启动构建后的应用：

```bash
npm start
```

### Nginx 反向代理配置

如果您使用 Nginx 反向代理管理后台和 WebSocket，请参考以下配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080; # 替换为您的 WEB_PORT
    
    proxy_set_header Host $proxy_host;
    proxy_set_header Origin $scheme://$host;
    
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # 获取真实 IP 的关键配置
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

## Web API

### 鉴权方式

管理类接口要求通过以下任一方式进行鉴权：

1.  **Session (浏览器)**：通过 `/admin` 页面登录。后续请求将通过 Cookie 自动鉴权。
2.  **本地访问**: 来自 `127.0.0.1` 或 `::1` 的请求会被自动授权为管理员（前提是你的 HTTP 不走代理）。
3.  **动态管理密钥 (Admin Secret)**：适用于外部脚本或机器人。需发送基于 `.env` 中 `ADMIN_SECRET` 加密后的字符串。

### 公开接口

| 方法 | URL | 描述 | 请求参数 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/status` | 返回服务器信息、在线人数及房间列表 | 无 |
| `GET` | `/check-auth` | 返回当前管理员鉴权状态 | 无 |

### 管理员接口 (需要鉴权)

| 方法 | URL | 描述 | 请求参数 (JSON) |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/all-players` | 列出全服所有在线玩家（含大厅） | 无 |
| `POST` | `/api/admin/server-message` | 向指定房间发送系统消息 | `roomId`, `content` |
| `POST` | `/api/admin/broadcast` | 向全服或指定房间发送广播 | `content`, `target?` |
| `POST` | `/api/admin/bulk-action` | 批量控制房间 | `action`, `target`, `value?` |
| `POST` | `/api/admin/kick-player` | 踢出玩家并切断其网络连接 | `userId` |
| `POST` | `/api/admin/force-start` | 强制开始指定房间的游戏 | `roomId` |
| `POST` | `/api/admin/toggle-lock` | 切换房间锁定状态 | `roomId` |
| `POST` | `/api/admin/set-max-players` | 修改房间人数上限 | `roomId`, `maxPlayers` |
| `POST` | `/api/admin/close-room` | 强制关闭指定房间 | `roomId` |
| `POST` | `/api/admin/toggle-mode` | 切换房间模式（普通/循环） | `roomId` |
| `GET` | `/api/admin/bans` | 列出所有用户 ID 和控制台 IP 封禁 | 无 |
| `POST` | `/api/admin/ban` | 执行新的封禁（限时或永久） | `type`, `target`, `duration?`, `reason?` |
| `POST` | `/api/admin/unban` | 解除对指定 ID 或 IP 的封禁 | `type`, `target` |
| `GET` | `/api/admin/login-blacklist` | 获取管理面板登录黑名单 | 无 |
| `POST` | `/api/admin/blacklist-ip` | 手动拉黑后台登录 IP | `ip`, `duration?` |
| `POST` | `/api/admin/unblacklist-ip` | 解除后台登录 IP 拉黑 | `ip` |

### API 调用示例

#### **获取服务器状态**
```bash
curl http://localhost:8080/api/status
```

#### **发送全服广播 (使用 Admin Secret 鉴权)**
```bash
curl -X POST http://localhost:8080/api/admin/broadcast \
     -H "Content-Type: application/json" \
     -H "X-Admin-Secret: 你的加密密钥" \
     -d '{"content": "大家好！", "target": "all"}'
```

#### **踢出玩家 (JavaScript Fetch 示例)**
```javascript
fetch('/api/admin/kick-player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 12345 })
});
```

## 相关项目

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira)：适用于本项目的 NoneBot2 机器人管理插件。

## 开源协议

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
