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

- 🖥️ **Web Dashboard & Admin System**: A standalone `/panel` for server management and real-time monitoring.
- 🎨 **Enhanced UI/UX**: Support for Dark Mode and multi-language internationalization (i18n).
- 🔐 **Hidden Management Portal**: Secure hidden access for super administrators via Easter Egg.
- ⚙️ **Optimized Room Logic**: Improved handling for solo rooms and server-side announcements.
- 🛡️ **Advanced Security**: 
    - Support for **Proxy Protocol v2** (TCP) and **HTTP Forwarded Headers** (X-Forwarded-For, X-Real-IP) for reliable real IP detection behind all types of proxies.
    - **Global Web Interception**: Banned IPs are instantly blocked from accessing any web resources (Dashboard, APIs, WebSocket) with a 403 error.
    - **Anti-Brute Force**: Automatic login blacklist for the admin panel after repeated failures to mitigate brute-force and credential stuffing attacks.
    - Differentiated **Admin vs System bans** (System bans drop connections instantly; Admin bans show detailed reasons).
    - **Customizable Display IP**: Show your own domain or IP on the web UI via `DISPLAY_IP` config.
    - Automatic **IP kicking** when an IP is banned.
    - **Audit Log**: Dedicated `logs/ban.log` for tracking all ban/unban actions and suspicious activities.

## Project Structure

```
.
├── data/           # Persistent data (Bans, Blacklists)
├── public/         # Web dashboard assets (HTML, JS, CSS, Locales)
└── src/
    ├── config/     # Configuration management
    ├── logging/    # Logging utilities
    ├── network/    # TCP, HTTP, and WebSocket server implementations
    ├── domain/
    │   ├── auth/     # Player authentication & Ban management
    │   ├── rooms/    # Room management logic
    │   └── protocol/ # Binary protocol handling & commands
    ├── app.ts      # Application factory (wiring components)
    └── index.ts    # Main entry point
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or pnpm

### Installation

```bash
npm install
```

## Configuration (.env)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Game TCP server port | `12346` |
| `WEB_PORT` | HTTP/WS management server port | `8080` |
| `TCP_ENABLED` | Enable/Disable TCP server | `true` |
| `USE_PROXY_PROTOCOL` | Enable Proxy Protocol v2 for real IP | `false` |
| `ENABLE_WEB_SERVER` | Enable/Disable HTTP server | `true` |
| `SERVER_NAME` | Server broadcast name | `Server` |
| `PHIRA_API_URL` | Base URL for Phira API | `https://phira.5wyxi.com` |
| `ROOM_SIZE` | Default maximum players per room | `8` |
| `ADMIN_NAME` | Admin dashboard username | `admin` |
| `ADMIN_PASSWORD` | Admin dashboard password | `password` |
| `ADMIN_SECRET` | Secret key for encrypted admin API access | (Empty) |
| `ADMIN_PHIRA_ID` | List of Admin Phira IDs (comma separated) | (Empty) |
| `OWNER_PHIRA_ID` | List of Owner Phira IDs (comma separated) | (Empty) |
| `BAN_ID_WHITELIST` | IDs that cannot be banned | (Empty) |
| `BAN_IP_WHITELIST` | IPs that cannot be banned | (Empty) |
| `SILENT_PHIRA_IDS` | IDs of users whose actions won't be logged | (Empty) |
| `SERVER_ANNOUNCEMENT` | Welcome message shown to players upon joining | (Simplified Default) |
| `SESSION_SECRET` | Secret for session encryption | (Insecure Default) |
| `LOGIN_BLACKLIST_DURATION` | Seconds to blacklist IP after login failures | `600` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `info` |
| `DISPLAY_IP` | Server IP displayed at the bottom of the web pages | `phira.funxlink.fun:19723` |
| `DEFAULT_AVATAR` | Default avatar URL for users/bots without one | (Phira Default) |
| `CAPTCHA_PROVIDER` | Captcha system (`geetest` or `none`) | `none` |

## Deployment & Running

The project can be built into a standalone executable for multiple platforms.

### 1. Download/Build Executable
Build the versions using `npm run package:all` (files will be in `outputs/`).

### 2. Platform Specifics

#### **Windows**
- Simply double-click `phira-mp-nodejsver.exe`.
- A default `.env` file will be generated automatically on first run.

#### **Linux**
- Grant executable permission: `chmod +x phira-mp-nodejsver-linux`
- Run: `./phira-mp-nodejsver-linux`

#### **macOS**
- Grant executable permission: `chmod +x phira-mp-nodejsver-macos-arm64` (or `x64`)
- **Signature Fix**: If the app fails to start, run this in terminal:
  ```bash
  codesign --sign - phira-mp-nodejsver-macos-arm64
  ```
- Open via Right Click -> Open if blocked by Gatekeeper.

### Production (Source Mode)

Start the built application:

```bash
npm start
```

### Nginx Reverse Proxy Configuration

If you want to use Nginx as a reverse proxy for the web management interface and WebSocket, use the following configuration:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080; # Replace with your WEB_PORT
    
    proxy_set_header Host $proxy_host;
    proxy_set_header Origin $scheme://$host;
    
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # Critical for real IP detection
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

## Web API

### Authentication

Administrative endpoints require authentication via one of three methods:

1.  **Session (Browser)**: Log in via the `/admin` portal. Subsequent requests will be authenticated via cookies.
2.  **Local Access**: Requests originating from `127.0.0.1` or `::1` are automatically authorized as administrator.
3.  **Dynamic Admin Secret**: For external scripts/bots. Send an encrypted string using the `ADMIN_SECRET` configured in `.env`.
    *   **Header**: `X-Admin-Secret: <ENCRYPTED_HEX>`
    *   **Query**: `?admin_secret=<ENCRYPTED_HEX>`

### Public Endpoints

| Method | URL | Description | Parameters |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/status` | Returns server info and room list | None |
| `GET` | `/check-auth` | Returns admin status | None |

### Administrative Endpoints (Requires Auth)

| Method | URL | Description | Parameters (JSON) |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/all-players` | List all connected players | None |
| `POST` | `/api/admin/server-message` | Send message to room | `roomId`, `content` |
| `POST` | `/api/admin/broadcast` | Global broadcast | `content`, `target?` |
| `POST` | `/api/admin/bulk-action` | Batch control rooms | `action`, `target`, `value?` |
| `POST` | `/api/admin/kick-player` | Force disconnect player | `userId` |
| `POST` | `/api/admin/force-start` | Force start room game | `roomId` |
| `POST` | `/api/admin/toggle-lock` | Toggle room lock | `roomId` |
| `POST` | `/api/admin/set-max-players` | Update room size | `roomId`, `maxPlayers` |
| `POST` | `/api/admin/close-room` | Close a specific room | `roomId` |
| `POST` | `/api/admin/toggle-mode` | Toggle Cycle mode | `roomId` |
| `GET` | `/api/admin/bans` | List current bans | None |
| `POST` | `/api/admin/ban` | Issue a new ban | `type`, `target`, `duration?`, `reason?` |
| `POST` | `/api/admin/unban` | Remove a ban | `type`, `target` |
| `GET` | `/api/admin/login-blacklist` | List panel login blacklist | None |
| `POST` | `/api/admin/blacklist-ip` | Manually blacklist IP for login | `ip`, `duration?` |
| `POST` | `/api/admin/unblacklist-ip` | Remove IP from login blacklist | `ip` |

### API Examples

#### **Get Server Status**
```bash
curl http://localhost:8080/api/status
```

#### **Send Global Broadcast (via Admin Secret)**
```bash
curl -X POST http://localhost:8080/api/admin/broadcast \
     -H "Content-Type: application/json" \
     -H "X-Admin-Secret: YOUR_ENCRYPTED_SECRET" \
     -d '{"content": "Hello Players!", "target": "all"}'
```

#### **Kick Player (via Fetch)**
```javascript
fetch('/api/admin/kick-player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 12345 })
});
```

## TCP Protocol

The server uses TCP sockets for communication. Clients can connect to the server using a TCP socket and send binary-formatted messages (compatible with the Phira protocol).

## Related Projects

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira): A bot plugin for NoneBot2 that manages and monitors this server.

## License

MIT License - see [LICENSE](LICENSE) file for details.