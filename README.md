# Phira Multiplayer Server

[中文说明](README-CN.md) | English

TypeScript-based Node.js server with TCP support for multiplayer gaming.

> **Note**: Some parts of the code in this project were completed with the assistance of AI.

## Features

- ✅ TypeScript support with strict type checking
- ✅ TCP socket server for real-time communication
- ✅ Configuration management via environment variables
- ✅ Structured logging with Flood Protection
- ✅ Dependency injection-friendly architecture
- ✅ Room management system
- ✅ Protocol handling layer
- ✅ Unit testing with Jest
- ✅ Code quality with ESLint and Prettier

### Enhanced Features (by chuzouX)

- 🖥️ **Web Dashboard & Admin System**: A standalone `/panel` for server management.
- 🎨 **Enhanced UI/UX**: Support for Dark Mode and multi-language internationalization (i18n).
- 🔐 **Hidden Management Portal**: Secure hidden access for super administrators via Easter Egg.
- ⚙️ **Optimized Room Logic**: Improved handling for solo rooms and server-side announcements.
- 🛡️ **Security**: Anti-clogging for illegal packets, auto IP banning, and proxy support (Nginx).

## Configuration (.env)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Game TCP server port | `12346` |
| `WEB_PORT` | HTTP/WS management server port | `8080` |
| `TCP_ENABLED` | Enable/Disable TCP server | `true` |
| `ENABLE_WEB_SERVER` | Enable/Disable HTTP server | `true` |
| `SERVER_NAME` | Server broadcast name | `Server` |
| `PHIRA_API_URL` | Base URL for Phira API | `https://phira.5wyxi.com` |
| `ROOM_SIZE` | Default maximum players per room | `8` |
| `ADMIN_NAME` | Admin dashboard username | `admin` |
| `ADMIN_PASSWORD` | Admin dashboard password | `password` |
| `ADMIN_SECRET` | Secret key for encrypted admin API access | (Empty) |
| `ADMIN_PHIRA_ID` | List of Admin Phira IDs (comma separated) | (Empty) |
| `OWNER_PHIRA_ID` | List of Owner Phira IDs (comma separated) | (Empty) |
| `SILENT_PHIRA_IDS` | IDs of users whose actions won't be logged | (Empty) |
| `SESSION_SECRET` | Secret for session encryption | (Insecure Default) |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |
| `CAPTCHA_PROVIDER` | Captcha system (`geetest` or `none`) | `none` |

## Web API

### Public Endpoints

| Method | URL | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Returns server info, player count, and room list |
| `GET` | `/api/config/public` | Returns public config (e.g., captcha provider) |
| `POST` | `/api/test/verify-captcha` | Verifies a captcha token |
| `GET` | `/check-auth` | Returns current administrative status |

### Administrative Endpoints (Requires Auth)

| Method | URL | Description |
| :--- | :--- | :--- |
| `GET` | `/api/all-players` | List all connected players (including lobby) |
| `POST` | `/api/admin/server-message` | Send system message to a specific room |
| `POST` | `/api/admin/broadcast` | Send global broadcast to all/selected rooms |
| `POST` | `/api/admin/bulk-action` | Close/Lock/Unlock/Resize multiple rooms |
| `POST` | `/api/admin/kick-player` | Kick player and terminate connection |
| `POST` | `/api/admin/force-start` | Forcefully start a game in a room |
| `POST` | `/api/admin/toggle-lock` | Toggle the lock status of a room |
| `POST` | `/api/admin/set-max-players` | Update max players for a room |
| `POST` | `/api/admin/close-room` | Forcefully close a specific room |
| `POST` | `/api/admin/toggle-mode` | Toggle room mode (Normal/Cycle) |
| `GET` | `/api/admin/bans` | List all User ID and Console IP bans |
| `POST` | `/api/admin/ban` | Issue a new ban (Timed or Permanent) |
| `POST` | `/api/admin/unban` | Remove a ban from ID or IP |

## Related Projects

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira): A bot plugin for NoneBot2 that manages and monitors this server.

## License

MIT License - see [LICENSE](LICENSE) file for details.