# Phira Multiplayer Server

TypeScript-based Node.js server with HTTP and WebSocket support for multiplayer gaming.

## Features

- ✅ TypeScript support with strict type checking
- ✅ HTTP REST API with Express
- ✅ WebSocket support for real-time communication
- ✅ Configuration management via environment variables
- ✅ Structured logging
- ✅ Dependency injection-friendly architecture
- ✅ Room management system
- ✅ Protocol handling layer
- ✅ Health check endpoint
- ✅ Unit testing with Jest
- ✅ Code quality with ESLint and Prettier

## Project Structure

```
src/
├── config/         # Configuration management
├── logging/        # Logging utilities
├── network/        # HTTP and WebSocket server components
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
- `HTTP_ENABLED`: Enable HTTP server (default: true)
- `WS_ENABLED`: Enable WebSocket server (default: true)
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

## API Endpoints

### Health Check

```
GET /health
```

Returns server health status.

### Rooms

```
GET /api/rooms
```

Returns list of active rooms.

## License

MIT License - see [LICENSE](LICENSE) file for details.
