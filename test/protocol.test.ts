import { BinaryReader, BinaryWriter } from '../src/domain/protocol/BinaryProtocol';
import { CommandParser, ClientCommandType, ServerCommandType } from '../src/domain/protocol/Commands';

describe('二进制协议 (BinaryProtocol)', () => {
  test('应当能正确编解码基本类型', () => {
    const writer = new BinaryWriter();
    writer.u8(123);
    writer.u16(45678);
    writer.u32(1234567890);
    writer.string('你好, Phira!');
    writer.bool(true);
    writer.bool(false);
    writer.uleb(1234567n);

    const buffer = writer.toBuffer();
    const reader = new BinaryReader(buffer);

    expect(reader.u8()).toBe(123);
    expect(reader.u16()).toBe(45678);
    expect(reader.u32()).toBe(1234567890);
    expect(reader.string()).toBe('你好, Phira!');
    expect(reader.bool()).toBe(true);
    expect(reader.bool()).toBe(false);
    expect(reader.uleb()).toBe(1234567n);
  });

  test('应当能正确处理 ULEB128 编码', () => {
    const values = [0n, 1n, 127n, 128n, 16383n, 16384n, 2097151n, 2097152n];
    for (const v of values) {
      const writer = new BinaryWriter();
      writer.uleb(v);
      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.uleb()).toBe(v);
    }
  });
});

describe('指令解析器 (CommandParser)', () => {
  test('应当能解析客户端 Ping 指令', () => {
    const writer = new BinaryWriter();
    writer.u8(ClientCommandType.Ping);
    const reader = new BinaryReader(writer.toBuffer());
    const parsed = CommandParser.parseClientCommand(reader);
    expect(parsed.command).toEqual({ type: ClientCommandType.Ping });
  });

  test('应当能解析客户端 Authenticate 指令', () => {
    const token = '12345678901234567890';
    const writer = new BinaryWriter();
    writer.u8(ClientCommandType.Authenticate);
    writer.string(token);
    
    const reader = new BinaryReader(writer.toBuffer());
    const parsed = CommandParser.parseClientCommand(reader);
    expect(parsed.command).toEqual({
      type: ClientCommandType.Authenticate,
      token: token
    });
  });

  test('应当能生成服务器 Pong 响应', () => {
    const writer = new BinaryWriter();
    CommandParser.writeServerCommand(writer, { type: ServerCommandType.Pong });
    const buffer = writer.toBuffer();
    
    expect(buffer[0]).toBe(ServerCommandType.Pong);
    expect(buffer.length).toBe(1);
  });

  test('应当能生成服务器 Message (聊天) 消息', () => {
    const writer = new BinaryWriter();
    const message = {
      type: 'Chat' as const,
      user: 1001,
      content: '你好，世界'
    };
    CommandParser.writeServerCommand(writer, {
      type: ServerCommandType.Message,
      message
    });
    
    const buffer = writer.toBuffer();
    const reader = new BinaryReader(buffer);
    
    expect(reader.u8()).toBe(ServerCommandType.Message);
    expect(reader.u8()).toBe(0); // 聊天类型的判别值
    expect(reader.i32()).toBe(1001);
    expect(reader.string()).toBe('你好，世界');
  });
});