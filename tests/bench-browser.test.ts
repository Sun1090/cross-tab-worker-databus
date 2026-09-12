/**
 * Guards for the browser benchmark's environment inputs.
 *
 * `pnpm bench:browser` feeds the release checklist's regression gate, and its
 * inputs used to be `Number(...)`-coerced with no validation — a typo produced a
 * meaningless run (or an empty one) instead of an error, and the resulting
 * archive silently poisoned `pnpm bench:compare`.
 */
import { describe, expect, it } from 'vitest';
import { parseBenchEnv } from '../scripts/bench-browser.mjs';

describe('parseBenchEnv', () => {
  it('falls back to the documented defaults', () => {
    expect(parseBenchEnv({})).toEqual({
      port: 4173,
      messages: 100,
      modes: ['dedicated', 'shared'],
      baseUrl: 'http://localhost:4173/examples/demo/',
      wsUrl: 'ws://localhost:4173/centrifuge/demo/connection/websocket'
    });
  });

  it('accepts valid overrides and derives the urls from the port', () => {
    const parsed = parseBenchEnv({ PORT: '5000', BENCH_MESSAGES: '250', BENCH_MODES: 'shared' });
    expect(parsed.port).toBe(5_000);
    expect(parsed.messages).toBe(250);
    expect(parsed.modes).toEqual(['shared']);
    expect(parsed.baseUrl).toBe('http://localhost:5000/examples/demo/');
    expect(parsed.wsUrl).toBe('ws://localhost:5000/centrifuge/demo/connection/websocket');
  });

  it('treats an empty or whitespace-only value as absent, matching the old `|| default` behaviour', () => {
    const parsed = parseBenchEnv({ PORT: '', BENCH_MESSAGES: '  ', BENCH_MODES: '   ' });
    expect(parsed.port).toBe(4173);
    expect(parsed.messages).toBe(100);
    expect(parsed.modes).toEqual(['dedicated', 'shared']);
  });

  it('rejects a non-numeric or out-of-range PORT', () => {
    for (const value of ['abc', 'NaN', '0', '-1', '65536', '1.5', 'Infinity']) {
      expect(() => parseBenchEnv({ PORT: value }), `PORT=${value}`).toThrowError(
        /PORT must be an integer between 1 and 65535/
      );
    }
  });

  it('rejects a non-numeric, zero, or fractional BENCH_MESSAGES', () => {
    // `abc` used to become NaN (the loop never ran and the run died on a 30s
    // waitForFunction timeout) and `0` used to make perMessageMs `0/0`, which
    // JSON.stringify archives as null.
    for (const value of ['abc', '0', '-5', '2.5', 'Infinity']) {
      expect(() => parseBenchEnv({ BENCH_MESSAGES: value }), `BENCH_MESSAGES=${value}`).toThrowError(
        /BENCH_MESSAGES must be an integer at least 1/
      );
    }
    expect(parseBenchEnv({ BENCH_MESSAGES: '1' }).messages).toBe(1);
  });

  it('rejects an empty or unknown BENCH_MODES instead of silently running nothing', () => {
    // An empty list used to archive `results: []`, leaving bench:compare with
    // nothing to compare while still reporting OK.
    expect(() => parseBenchEnv({ BENCH_MODES: ',' })).toThrowError(
      /BENCH_MODES must list at least one worker mode \(dedicated, shared\), got ","/
    );
    expect(() => parseBenchEnv({ BENCH_MODES: 'shared,auto' })).toThrowError(
      /BENCH_MODES contains an unknown worker mode "auto"; expected dedicated or shared/
    );
  });

  it('trims each mode and preserves the requested order', () => {
    expect(parseBenchEnv({ BENCH_MODES: ' shared , dedicated ' }).modes).toEqual(['shared', 'dedicated']);
  });
});
