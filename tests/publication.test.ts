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
});
