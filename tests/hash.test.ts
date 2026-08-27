import { describe, expect, it } from 'vitest';
import { createOpaqueKey } from '../src/core/hash';

describe('createOpaqueKey', () => {
  it('returns a 32-char hex string for any input', () => {
    expect(createOpaqueKey('')).toMatch(/^[0-9a-f]{32}$/);
    expect(createOpaqueKey('a')).toMatch(/^[0-9a-f]{32}$/);
    expect(createOpaqueKey('wss://example.com/connection/websocket')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic — same input yields same output', () => {
    const input = 'price.feed.usd.jpy';
    const first = createOpaqueKey(input);
    for (let i = 0; i < 5; i += 1) {
      expect(createOpaqueKey(input)).toBe(first);
    }
  });

  it('produces different keys for different inputs', () => {
    expect(createOpaqueKey('a')).not.toBe(createOpaqueKey('b'));
    expect(createOpaqueKey('ab')).not.toBe(createOpaqueKey('ba'));
    expect(createOpaqueKey('topic')).not.toBe(createOpaqueKey('topix'));
  });

  it('is case-sensitive', () => {
    expect(createOpaqueKey('Abc')).not.toBe(createOpaqueKey('abc'));
    expect(createOpaqueKey('ABC')).not.toBe(createOpaqueKey('abc'));
  });

  it('handles empty string without throwing', () => {
    const key = createOpaqueKey('');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key.length).toBe(32);
  });

  it('handles very long input without throwing or changing length', () => {
    const long = 'x'.repeat(10_000);
    const key = createOpaqueKey(long);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key.length).toBe(32);
  });

  it('diffuses similar inputs across all 128 bits', () => {
    // 'foo' vs 'foop' differ by one trailing char; the avalanche should
    // make the hex outputs differ in the vast majority of positions.
    const a = createOpaqueKey('foo');
    const b = createOpaqueKey('foop');
    let differingHexChars = 0;
    for (let i = 0; i < 32; i += 1) {
      if (a[i] !== b[i]) differingHexChars += 1;
    }
    // Each hex char carries 4 bits; with 128-bit avalanche we expect ~50%
    // of nibbles to differ. Require at least 20 of 32 to catch a broken
    // mixing function that only perturbs the low bits.
    expect(differingHexChars).toBeGreaterThanOrEqual(20);
  });

  it('produces distinct keys for typical connection URLs', () => {
    const urls = [
      'wss://a.example.com/connection/websocket',
      'wss://b.example.com/connection/websocket',
      'wss://a.example.com/connection/websocket?token=x',
      'wss://a.example.com/other/websocket'
    ];
    const keys = urls.map(createOpaqueKey);
    expect(new Set(keys).size).toBe(urls.length);
  });
});
