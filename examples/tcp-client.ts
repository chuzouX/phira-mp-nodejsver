/**
 * Example TCP client for connecting to Phira multiplayer server
 * 
 * This demonstrates how to:
 * - Connect to the TCP server
 * - Send JSON-formatted messages
 * - Receive and handle data from the server
 */

import { createConnection } from 'net';

const PORT = 3000;
const HOST = 'localhost';

const client = createConnection({ port: PORT, host: HOST }, () => {
  console.log('Connected to Phira TCP server');

  // Send a sample message
  const joinMessage = {
    type: 'join',
    payload: {
      roomId: 'example-room',
      username: 'player1',
    },
  };

  client.write(JSON.stringify(joinMessage));
  console.log('Sent:', joinMessage);
});

client.on('data', (data: Buffer) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('收到:', message);
  } catch (error) {
    console.log('收到原数据:', data.toString());
  }
});

client.on('error', (error) => {
  console.error('连接错误:', error.message);
});

client.on('close', () => {
  console.log('连接已关闭');
  process.exit(0);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  client.end();
});
