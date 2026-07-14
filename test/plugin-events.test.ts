import { PluginManager } from '../src/plugins/manager';
import type { PluginContext } from '../src/plugins/types';

describe('plugin event bus', () => {
  const createEvents = () => {
    const logger = { error: jest.fn() };
    const manager = new PluginManager({ logger } as unknown as PluginContext);
    return { events: manager.events, logger };
  };

  test('registers and unsubscribes a listener', () => {
    const { events } = createEvents();
    const handler = jest.fn();
    const unsubscribe = events.on('player:connect', handler);

    expect(events.listenerCount('player:connect')).toBe(1);
    events.emit('player:connect', { connectionId: 'conn-1', ip: '127.0.0.1' });
    unsubscribe();
    unsubscribe();
    events.emit('player:connect', { connectionId: 'conn-2', ip: '127.0.0.2' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.listenerCount('player:connect')).toBe(0);
  });

  test('runs once listeners only once, including recursive emits', () => {
    const { events } = createEvents();
    const handler = jest.fn(() => {
      events.emit('custom:recursive', { depth: 2 });
    });
    events.once('custom:recursive', handler);

    events.emit('custom:recursive', { depth: 1 });
    events.emit('custom:recursive', { depth: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('off removes every registration of the same handler', () => {
    const { events } = createEvents();
    const handler = jest.fn();
    events.on('chat:message', handler);
    events.once('chat:message', handler);

    expect(events.off('chat:message', handler)).toBe(true);
    expect(events.off('chat:message', handler)).toBe(false);
    expect(events.listenerCount('chat:message')).toBe(0);
  });

  test('emitAsync waits for listeners and isolates failures', async () => {
    const { events, logger } = createEvents();
    const calls: string[] = [];
    events.on('custom:async', async () => {
      await Promise.resolve();
      calls.push('first');
      throw new Error('boom');
    });
    events.on('custom:async', () => {
      calls.push('second');
    });

    await events.emitAsync('custom:async', null);

    expect(calls).toEqual(['first', 'second']);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
