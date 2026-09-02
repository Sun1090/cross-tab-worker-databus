import { describe, expect, it } from 'vitest';
import { parseDataBusPublication } from '../src/core/publication';

describe('parseDataBusPublication', () => {
  it('accepts legacy, nested, and fallback-topic frames', () => {
    expect(parseDataBusPublication({ topic: 'a', data: 1, messageId: 'm', timestamp: 2 }))
      .toEqual({ topic: 'a', data: 1, messageId: 'm', timestamp: 2 });
    expect(parseDataBusPublication({ op: 'publication', publication: { topic: 'a', data: 1 } }))
      .toEqual({ topic: 'a', data: 1 });
    expect(parseDataBusPublication({ data: 1, messageId: 'm' }, 'a'))
      .toEqual({ topic: 'a', data: 1, messageId: 'm' });
  });

  it('ignores invalid metadata while preserving the publication payload', () => {
    expect(parseDataBusPublication({ topic: 'a', data: 1, messageId: '', timestamp: NaN }))
      .toEqual({ topic: 'a', data: 1 });
    expect(parseDataBusPublication({ topic: 'a', data: 1, messageId: 42, timestamp: Infinity }))
      .toEqual({ topic: 'a', data: 1 });
  });

  it('rejects objects without a topic when no fallback is supplied', () => {
    expect(parseDataBusPublication({ data: 1 })).toBeNull();
  });

  it('uses the fallback topic for primitive and legacy channel payloads', () => {
    expect(parseDataBusPublication('hello', 'chat.room')).toEqual({ topic: 'chat.room', data: 'hello' });
    expect(parseDataBusPublication(null, 'chat.room')).toEqual({ topic: 'chat.room', data: null });
    expect(parseDataBusPublication({ value: 1 }, 'chat.room')).toEqual({ topic: 'chat.room', data: { value: 1 } });
  });

  it('prefers an explicit nested topic and ignores unknown envelope fields', () => {
    expect(parseDataBusPublication({
      op: 'publication',
      requestId: 'ignored',
      publication: { topic: 'nested', data: 2, futureField: true }
    }, 'fallback')).toEqual({ topic: 'nested', data: 2 });
  });

  it('rejects empty topics even when a malformed frame contains metadata', () => {
    expect(parseDataBusPublication({ topic: '', data: 1, messageId: 'm' })).toBeNull();
    expect(parseDataBusPublication({ topic: '', data: 1 }, '')).toBeNull();
  });
});
