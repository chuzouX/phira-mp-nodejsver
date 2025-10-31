# Phira Multiplayer Server

TypeScript-based Node.js server with TCP support for multiplayer gaming.

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

## Project Structure

```
src/
├── config/         # Configuration management
├── logging/        # Logging utilities
├── network/        # TCP server components
├── domain/
│   ├── rooms/      # Room management
│   └── protocol/   # Protocol handling
├── __tests__/      # Test files
├── app.ts          # Application bootstrap
└── index.ts        # Entry point
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

## License

MIT License - see [LICENSE](LICENSE) file for details.
