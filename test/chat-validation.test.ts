import { isValidChatContent } from '../src/domain/protocol/ChatValidation';
import { handleChat } from '../src/domain/protocol/handlers/chat';
import { ProtocolHandler } from '../src/domain/protocol/ProtocolHandler';
import { InMemoryRoomManager } from '../src/domain/rooms/RoomManager';

describe('authoritative chat text validation', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['ordinary Unicode', '中文 English 123 🎵 & friends', true],
    ['boundary', 'x'.repeat(2048), true],
    ['emoji boundary', '🎵'.repeat(1024), true],
    ['blank', '  ', false],
    ['empty', '', false],
    ['number', 12, false],
    ['object', {}, false],
    ['array', ['hi'], false],
    ['null', null, false],
    ['markup', '<img src=x>', false],
    ['oversize', 'x'.repeat(2049), false],
    ['emoji oversize', '🎵'.repeat(1025), false],
    ['line break', 'a\nb', false],
    ['tab', 'a\tb', false],
    ['NUL', 'a\u0000b', false],
    ['C1', 'a\u0085b', false],
    ['bidi override', 'a\u202eb', false],
    ['bidi isolate', 'a\u2066b', false],
    ['lone surrogate', 'a\ud800b', false],
  ];
  it.each(cases)(
    '%s agrees across shared validator, TCP and room broadcast',
    (_name, value, expected) => {
      const logger: any = { info: jest.fn(), debug: jest.fn() };
      const rooms = new InMemoryRoomManager(logger);
      const room = rooms.createRoom({
        id: 'a',
        name: 'a',
        ownerId: 1,
        ownerInfo: { id: 1, name: 'User', monitor: false },
        connectionId: 'tcp',
      });
      const protocol = new ProtocolHandler(
        rooms,
        {} as any,
        logger,
        'Test',
        'https://example.test',
      );
      const respond = jest.fn();
      const broadcastMessage = jest.fn();
      const ctx: any = {
        roomManager: rooms,
        logger,
        respond,
        broadcastMessage,
        sessions: new Map([['tcp', { userId: 1, userInfo: { name: 'User' } }]]),
      };
      expect(isValidChatContent(value)).toBe(expected);
      expect(protocol.isValidChatContent(value)).toBe(expected);
      expect(protocol.sendRoomMessage('a', 1, value as string)).toBe(expected);
      handleChat(ctx, 'tcp', value as string, jest.fn());
      expect(respond.mock.calls[0][2].result.ok).toBe(expected);
      expect(broadcastMessage).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(room.messages).toHaveLength(expected ? 1 : 0);
    },
  );
});
