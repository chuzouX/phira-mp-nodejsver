# Phira Multiplayer Server (Node.js)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

** English | [中文文档](docs/README-CN.md) **

High-performance, extensible multiplayer server for the Phira rhythm game, implemented in TypeScript/Node.js with TCP protocol support.

## Features

- **TCP / WebSocket** — dual protocol support for game clients and web dashboard
- **Plugin System** — powerful modular architecture, extend without modifying core
- **Federation Network** — decentralized multi-server mesh (shipped as a plugin)
- **Web Dashboard** — full admin panel with player/room/ban management
- **Titles & Tournament** — champion title system and competitive tournament mode
- **Security** — IP banning, CAPTCHA, Proxy Protocol v2, brute-force protection
- **Virtual Token** — stress-test friendly auth bypass (development only)

## Quick Start

```bash
npm install
cp .env.example .env          # edit server config
npm run dev                   # development with hot-reload
```

Production:
```bash
npm run build && npm start
```

### System Requirements

- Node.js 18+
- npm

## Directory Structure

```
phira-mp-server/
├── src/
│   ├── config/               # configuration service
│   ├── domain/
│   │   ├── auth/             # authentication & ban management
│   │   ├── protocol/         # binary protocol encoding, commands, handlers
│   │   └── rooms/            # room manager (in-memory)
│   ├── logging/              # structured logger with flood protection
│   ├── network/              # TCP, HTTP, console interface
│   └── plugins/              # plugin loader & API types
├── plugins/                  # plugin packages
│   ├── web-dashboard/        # web admin panel
│   ├── websocket/            # real-time push for dashboard
│   ├── federation/           # multi-server mesh networking
│   ├── titles/               # champion title system
│   ├── tournament/           # tournament competition
│   ├── room-announcer/       # public room announcements
│   ├── nonebot-auth/         # NoneBot bot authentication
│   └── example/              # demo plugin
├── config/                   # per-plugin runtime config (auto-generated)
├── data/                     # persistent data (bans, federation nodes)
├── test/                     # Jest test suite
└── docs/                     # documentation
```

## Configuration

Copy `.env.example` to `.env` and edit:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | TCP game server port | `12346` |
| `HOST` | Bind address | `0.0.0.0` |
| `WEB_PORT` | HTTP/WebSocket admin port | `8080` |
| `ENABLE_WEB_SERVER` | Enable web dashboard & API | `false` |
| `LOG_LEVEL` | debug / info / mark / warn / error | `info` |
| `SERVER_NAME` | In-game server display name | `Server` |
| `ROOM_SIZE` | Default max players per room | `8` |
| `PHIRA_API_URL` | Phira API base URL | `https://phira.5wyxi.com` |
| `ADMIN_PHIRA_ID` | Admin user IDs (comma-separated) | |
| `OWNER_PHIRA_ID` | Owner user IDs (comma-separated) | |
| `USE_PROXY_PROTOCOL` | Enable Proxy Protocol v2 for real IP | `false` |
| `TRUST_PROXY_HOPS` | Proxy trust depth (1=Nginx, 2=CDN+Nginx) | `1` |

Plugins have their own config files under `config/<plugin-name>/config.yaml`, auto-generated from `config.default.yaml` on first load.

## Plugin System

Plugins extend the server without modifying core code. Each plugin is a directory under `plugins/` with a `plugin.yaml` manifest.

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| **web-dashboard** | Web admin panel — login, room/player/ban/federation management |
| **websocket** | Real-time WebSocket push for the dashboard |
| **federation** | Decentralized multi-server mesh (node discovery, room sync, cross-server proxy) |
| **titles** | Champion title & ranking system |
| **tournament** | Tournament competition (pairing, elimination, ranking) |
| **room-announcer** | Broadcasts public room changes to players |
| **nonebot-auth** | AES-256-CBC / SHA-256 auth for NoneBot & external scripts |
| **example** | Demo plugin showing API usage |

### Developing Plugins

See [docs/Plugins.md](docs/Plugins.md) for the full plugin development guide.

Minimal TypeScript plugin:

```ts
import type { PluginModule, PluginApi } from 'phira-plugin-api';

const plugin: PluginModule = {
  init(api: PluginApi) {
    api.logger.info('Hello from my plugin!');
    api.events.on('player:auth:success', ({ user }) => {
      api.logger.info(`Welcome ${user.name}!`);
    });
  },
  destroy() {},
};
export default plugin;
```

## Federation

Federation is a **plugin** — enable it via `config/federation/config.yaml`:

```yaml
enabled: true
secret: "shared-key"             # must match across all nodes
nodeUrl: http://your-ip:8080     # external URL of this node
seedNodes:
  - http://other-server:8080     # initial peers to discover from
```

All federation configuration is managed through the plugin config file, not `.env`.

See [the federation plugin repo](https://github.com/chuzouX/phira-mp-nodejsver-federation) for full documentation.

## Console Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help menu |
| `/room` | List all rooms |
| `/list` | List online players |
| `/status` | TCP protocol handshake test |
| `/kick <uid>` | Kick a player |
| `/fstart <rid>` | Force start a room |
| `/lock <rid>` | Toggle room lock |
| `/close <rid>` | Force close a room |
| `/ban id <uid> [duration] [reason]` | Ban a player |
| `/ban ip <ip> [duration] [reason]` | Ban an IP |
| `/op <uid>` | Grant admin |
| `/deop <uid>` | Revoke admin |
| `/info` | Server status and uptime |
| `/set <key> <value>` | Update .env config |
| `/log <level>` | Change log level |
| `/plugins` | Plugin management |

## Web API

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/version` | Server version |
| `GET` | `/api/status` | Server status, rooms, online players |

### Admin Endpoints (requires authentication)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/all-players` | All online players |
| `POST` | `/api/admin/broadcast` | Server-wide broadcast |
| `POST` | `/api/admin/kick-player` | Kick a player |
| `POST` | `/api/admin/ban` | Create a ban |
| `POST` | `/api/admin/unban` | Remove a ban |
| `GET` | `/api/admin/bans` | List all bans |
| `POST` | `/api/admin/force-start` | Force start game |
| `POST` | `/api/admin/close-room` | Close a room |
| `POST` | `/api/admin/server-message` | Send system message to room |

## Performance

Stress-tested on a single machine (localhost), 25 threads:

| Metric | Value |
|--------|-------|
| Max clean concurrent connections | **5,000** (0 errors) |
| Max total concurrent connections | **10,000** (63% auth success, ~1% TCP failures) |
| Connection TPS | 620 |
| Room operation TPS | 290 (create/join/leave, zero errors) |
| Room latency (P50) | 89ms create / 91ms join / 93ms leave |
| Connection latency (P50) | 2ms |
| Auth latency (P50) | 54ms (virtual token) |

See `tools/stress-test/` for the stress testing toolkit.

## Deployment

### From Source

```bash
npm install
npm run build
npm start
```

### Packaged Executable

```bash
npm run package:all     # builds exe for Win/Linux/macOS
```

### Nginx Reverse Proxy

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

## Related Projects

- [phira-mp-nodejsver-federation](https://github.com/chuzouX/phira-mp-nodejsver-federation) — Federation plugin
- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira) — NoneBot2 management plugin

## License

[MIT](LICENSE)
