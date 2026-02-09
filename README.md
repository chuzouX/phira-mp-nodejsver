# Phira Multiplayer Server

[中文说明](README-CN.md) | English

TypeScript-based Node.js server with TCP support for multiplayer gaming.

> **Note**: Some parts of the code in this project were completed with the assistance of AI.

## Features

- ✅ TypeScript support with strict type checking
- ✅ TCP socket server for real-time communication
- ✅ Configuration management via environment variables
- ✅ Structured logging
- ✅ Dependency injection-friendly architecture
- ✅ Room management system
- ✅ Protocol handling layer
- ✅ Unit testing with Jest
- ✅ Code quality with ESLint and Prettier

### Enhanced Features (by chuzouX)

- 🖥️ **Web Dashboard & Admin System**: A complete responsive web interface for server management and room monitoring.
- 🎨 **Enhanced UI/UX**: Support for Dark Mode and multi-language internationalization (i18n).
- 🔐 **Hidden Management Portal**: Secure hidden access for super administrators.
- 🆔 **Server Identity Customization**: Customizable server broadcast names and room size limits via environment variables.
- ⚙️ **Optimized Room Logic**: Improved handling for solo rooms and server-side announcements.
- 🛡️ **Security & Authentication**: Integrated admin login system with session management and multi-provider captcha support (Cloudflare Turnstile / Aliyun).

## Project Structure

```
.
├── public/         # Web dashboard assets (HTML, JS, CSS, Locales)
└── src/
    ├── config/     # Configuration management
    ├── logging/    # Logging utilities
    ├── network/    # TCP, HTTP, and WebSocket server implementations
    ├── domain/
    │   ├── auth/     # Player authentication services
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

### Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Available configuration options:

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `TCP_ENABLED`: Enable TCP server (default: true)
- `LOG_LEVEL`: Logging level (default: info)

### Development

Start the development server with hot reload:

```bash
npm run dev
```

### Building

Build the TypeScript project:

```bash
npm run build
```

### Production

Start the built application:

```bash
npm start
```

### Testing

Run tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

### Linting and Formatting

Check code quality:

```bash
npm run lint
```

Fix linting issues:

```bash
npm run lint:fix
```

Format code:

```bash
npm run format
```

## Web API

The server provides a Web API for status monitoring and administration.

### Authentication

Administrative endpoints require authentication via one of three methods:

1.  **Session (Browser)**: Log in via the `/admin` portal. Subsequent requests will be authenticated via cookies.
2.  **Local Access**: Requests originating from `127.0.0.1` or `::1` are automatically authorized as administrator.
3.  **Dynamic Admin Secret**: For external scripts/bots. Send an encrypted string using the `ADMIN_SECRET` configured in `.env`.
    *   **Header**: `X-Admin-Secret: <ENCRYPTED_HEX>`
    *   **Query**: `?admin_secret=<ENCRYPTED_HEX>`

Use the `generate_secret.py` tool in the root directory to generate the required hex string for the current day.

### Public Endpoints

#### **Server Status**
Returns server information, player count, and room list.
- **URL**: `GET /api/status`
- **Response**: JSON containing `serverName`, `onlinePlayers`, `roomCount`, and `rooms` array.

#### **Public Config**
Returns public configuration like captcha provider.
- **URL**: `GET /api/config/public`

#### **Captcha Test**
Verifies a captcha token.
- **URL**: `POST /api/test/verify-captcha`
- **Body**: Captcha parameters (Geetest).

### Administrative Endpoints

Requires authentication.

#### **All Players**
List all currently connected players across all rooms and lobby.
- **URL**: `GET /api/all-players`

#### **Check Auth**
Returns current administrative status.
- **URL**: `GET /check-auth`

#### **Server Message**
Send a system message to a specific room.
- **URL**: `POST /api/admin/server-message`
- **Body**: `{"roomId": "123", "content": "Message"}`

#### **Broadcast Message**
Send a system message to all rooms or specific rooms.
- **URL**: `POST /api/admin/broadcast`
- **Body**:
  - `content`: Message text.
  - `target` (optional): `"all"` or room IDs starting with `#`, e.g., `"#room1,room2"`.

#### **Bulk Action**
Perform actions on multiple rooms at once.
- **URL**: `POST /api/admin/bulk-action`
- **Body**:
  - `action`: `"close_all"`, `"lock_all"`, `"unlock_all"`, `"set_max_players"`, `"disable_room_creation"`, `"enable_room_creation"`.
  - `target`: `"all"` or room IDs starting with `#`.
  - `value`: Optional value (e.g., for `set_max_players`).

#### **Kick Player**
Forcefully remove a player from the server and terminate their connection.
- **URL**: `POST /api/admin/kick-player`
- **Body**: `{"userId": 12345}`

#### **Force Start**
Forcefully start a game in a room.
- **URL**: `POST /api/admin/force-start`
- **Body**: `{"roomId": "123"}`

#### **Toggle Lock**
Toggle the lock status of a room.
- **URL**: `POST /api/admin/toggle-lock`
- **Body**: `{"roomId": "123"}`

#### **Set Max Players**
Update the maximum number of players for a room.
- **URL**: `POST /api/admin/set-max-players`
- **Body**: `{"roomId": "123", "maxPlayers": 8}`

#### **Close Room**
Forcefully close a specific room.
- **URL**: `POST /api/admin/close-room`
- **Body**: `{"roomId": "123"}`

#### **Toggle Mode**
Toggle room mode between normal and cycle.
- **URL**: `POST /api/admin/toggle-mode`
- **Body**: `{"roomId": "123"}`

#### **Room Blacklist/Whitelist**
Manage room-specific access lists.
- **Get Blacklist**: `GET /api/admin/room-blacklist?roomId=123`
- **Set Blacklist**: `POST /api/admin/set-room-blacklist` - Body: `{"roomId": "123", "userIds": [1, 2, 3]}`
- **Get Whitelist**: `GET /api/admin/room-whitelist?roomId=123`
- **Set Whitelist**: `POST /api/admin/set-room-whitelist` - Body: `{"roomId": "123", "userIds": [1, 2, 3]}`

#### **Global Ban Management**
Manage server-wide bans for User IDs and Console access.
- **List Bans**: `GET /api/admin/bans`
- **Issue Ban**: `POST /api/admin/ban`
  - Body: `{"type": "id"|"ip", "target": "id/ip", "duration": seconds|null, "reason": "text"}`
- **Remove Ban**: `POST /api/admin/unban`
  - Body: `{"type": "id"|"ip", "target": "id/ip"}`

## TCP Protocol

The server uses TCP sockets for communication. Clients can connect to the server using a TCP socket and send JSON-formatted messages.

See `examples/tcp-client.ts` for a complete example.

Example connection:
```typescript
import { createConnection } from 'net';

const client = createConnection({ port: 3000, host: 'localhost' });

client.on('connect', () => {
  console.log('Connected to Phira server');
  
  // Send a message
  const message = JSON.stringify({ type: 'join', payload: { roomId: 'example' } });
  client.write(message);
});

client.on('data', (data) => {
  console.log('Received:', data.toString());
});
```

## Related Projects

- [nonebot_plugin_nodejsphira](https://github.com/chuzouX/nonebot_plugin_nodejsphira): A bot plugin for NoneBot2 that manages and monitors the Phira Multiplayer (Node.js version) backend. It offers real-time room queries, web screenshot monitoring, server node status viewing, and comprehensive remote administration functions.

## License

MIT License - see [LICENSE](LICENSE) file for details.
