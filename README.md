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

Administrative endpoints require authentication via one of two methods:

1.  **Session (Browser)**: Log in via the `/admin` portal. Subsequent requests will be authenticated via cookies.
2.  **Dynamic Admin Secret**: For external scripts/bots. Send an encrypted string using the `ADMIN_SECRET` configured in `.env`.
    *   **Header**: `X-Admin-Secret: <ENCRYPTED_HEX>`
    *   **Query**: `?admin_secret=<ENCRYPTED_HEX>`

Use the `generate_secret.py` tool in the root directory to generate the required hex string for the current day.

### Public Endpoints

#### **Server Status**
Returns server information, player count, and room list.
- **URL**: `GET /api/status`
- **Example**: `curl http://localhost:8080/api/status`

### Administrative Endpoints

Requires authentication.

#### **All Players**
List all currently connected players across all rooms.
- **URL**: `GET /api/all-players`

#### **Broadcast Message**
Send a system message to all rooms or specific rooms.
- **URL**: `POST /api/admin/broadcast`
- **Body (JSON)**:
  - `content`: Message text.
  - `target` (optional): Room IDs starting with `#`, e.g., `#room1,room2`.

#### **Kick Player**
Forcefully remove a player from the server.
- **URL**: `POST /api/admin/kick-player`
- **Body (JSON)**: `{"userId": 12345}`

#### **Room Management**
- **Force Start**: `POST /api/admin/force-start` - `{"roomId": "123"}`
- **Toggle Lock**: `POST /api/admin/toggle-lock` - `{"roomId": "123"}`
- **Set Max Players**: `POST /api/admin/set-max-players` - `{"roomId": "123", "maxPlayers": 8}`
- **Close Room**: `POST /api/admin/close-room` - `{"roomId": "123"}`

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
