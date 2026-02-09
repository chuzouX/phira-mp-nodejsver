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
- 🔐 **隐藏入口**：通过点击标题 5 次触发的管理员安全访问通道。
- ⚙️ **优化的房间逻辑**：改进了单人房间处理及全服广播系统。
- 🛡️ **安全防护**：非法包即时切断、自动 IP 封禁、以及 Nginx 真实 IP 识别。

## 环境变量配置 (.env)

| 变量名 | 描述 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 游戏 TCP 服务器监听端口 | `12346` |
| `WEB_PORT` | HTTP/WS 管理服务器端口 | `8080` |
| `TCP_ENABLED` | 是否启用 TCP 游戏服务器 | `true` |
| `ENABLE_WEB_SERVER` | 是否启用 Web 管理服务器 | `true` |
| `SERVER_NAME` | 服务器在游戏内显示的播报名称 | `Server` |
| `PHIRA_API_URL` | Phira 官方 API 地址 | `https://phira.5wyxi.com` |
| `ROOM_SIZE` | 默认房间最大玩家人数 | `8` |
| `ADMIN_NAME` | 管理后台登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理后台登录密码 | `password` |
| `ADMIN_SECRET` | 外部脚本使用的加密密钥 | (空) |
| `ADMIN_PHIRA_ID` | 管理员 Phira ID 列表 (逗号分隔) | (空) |
| `OWNER_PHIRA_ID` | 所有者 Phira ID 列表 (逗号分隔) | (空) |
| `SILENT_PHIRA_IDS` | **静默用户** ID 列表 (不产生日志) | (空) |
| `SESSION_SECRET` | 会话加密密钥 | (默认不安全值) |
| `LOG_LEVEL` | 日志级别 (`debug`, `info`, `warn`, `error`) | `info` |
| `CAPTCHA_PROVIDER` | 验证码提供商 (`geetest` 或 `none`) | `none` |

## Web API

### 公开接口

| 方法 | URL | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/status` | 返回服务器信息、在线人数及房间列表 |
| `GET` | `/api/config/public` | 返回公共配置（如验证码类型） |
| `POST` | `/api/test/verify-captcha` | 验证验证码 Token |
| `GET` | `/check-auth` | 返回当前管理员鉴权状态 |

### 管理员接口 (需要鉴权)

| 方法 | URL | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/all-players` | 列出全服所有在线玩家（含大厅） |
| `POST` | `/api/admin/server-message` | 向指定房间发送系统消息 |
| `POST` | `/api/admin/broadcast` | 向全服或指定房间发送广播 |
| `POST` | `/api/admin/bulk-action` | 批量关闭/锁定/解锁房间或修改人数 |
| `POST` | `/api/admin/kick-player` | 踢出玩家并切断其网络连接 |
| `POST` | `/api/admin/force-start` | 强制开始指定房间的游戏 |
| `POST` | `/api/admin/toggle-lock` | 切换房间锁定状态 |
| `POST` | `/api/admin/set-max-players` | 修改房间人数上限 |
| `POST` | `/api/admin/close-room` | 强制关闭指定房间 |
| `POST` | `/api/admin/toggle-mode` | 切换房间模式（普通/循环） |
| `GET` | `/api/admin/bans` | 列出所有用户 ID 和控制台 IP 封禁 |
| `POST` | `/api/admin/ban` | 执行新的封禁（限时或永久） |
| `POST` | `/api/admin/unban` | 解除对指定 ID 或 IP 的封禁 |

## 相关项目

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira)：适用于本项目的 NoneBot2 机器人管理插件。

## 开源协议

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。
