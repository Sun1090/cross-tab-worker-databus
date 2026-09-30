/**
 * Guards for the browser benchmark's environment inputs.
 *
 * `pnpm bench:browser` feeds the release checklist's regression gate, and its
 * inputs used to be `Number(...)`-coerced with no validation — a typo produced a
 * meaningless run (or an empty one) instead of an error, and the resulting
 * archive silently poisoned `pnpm bench:compare`.
 */
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBenchEnv, readHostLoad } from '../scripts/bench-browser.mjs';

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


describe('bench-browser host load recording', () => {
  it('records a finite 1-minute load with the core count, or null when the platform has none', () => {
    // The archive recorded no host state at all, so a poisoned sample was
    // indistinguishable from a good one and `bench:compare` could only judge a
    // report against the previous five. `loadVerdict()` reads this field; this
    // pins that the producer actually produces it, which is the half a
    // benchmark-runner test cannot reach.
    // Read the platform's own figure and require the report to carry *that*
    // number, rather than accepting the null fallback unconditionally: an
    // earlier version did, and `readHostLoad` could return null always and the
    // whole file stayed green — the case measured the fallback, not the
    // recording. The null branch is still covered, on the only platform where it
    // is reachable.
    const platformLoad = os.loadavg?.()[0];
    const host = readHostLoad();
    if (host === null) {
      // Reachable only where the platform publishes no finite reading, so the
      // assertion is that there genuinely was none.
      expect(
        typeof platformLoad === 'number' && Number.isFinite(platformLoad),
        'the null fallback must mean the platform had no reading'
      ).toBe(false);
      return;
    }
    // The platform's own figure, not merely *a* finite number: an earlier version
    // accepted the null fallback unconditionally, and `readHostLoad` could return
    // null always and the file stayed green — the case measured the fallback
    // rather than the recording.
    expect(host.loadavg1m, 'the recorded value must be the platform figure itself').toBe(platformLoad);
    expect(host.loadavg1m).toBeGreaterThanOrEqual(0);
    // A raw load average means nothing without the core count, and the archive
    // spans machines — so the count is recorded beside it rather than assumed.
    expect(typeof host.cpus === 'number' || host.cpus === null).toBe(true);
    expect(typeof host.platform).toBe('string');
    expect(typeof host.release).toBe('string');
  });

  it('reads the host before the run does any of its own work', () => {
    // *When* `readHostLoad` is called is the whole correctness of the reading,
    // and it is not reachable from a unit test — the call is inside `main()`,
    // behind a server spawn and a browser launch. So it is pinned as a text gate
    // over the script, which is decidable rather than vacuous precisely because
    // it cannot pass by finding nothing: a missing or moved line changes the
    // index arithmetic and fails.
    //
    // The measurement that forced the placement: an 8-core host idle long enough
    // to read 7.23 was at 11.95 by the time a sample completed, and a second run
    // traced 11.6 rising to 13.0 mid-run and decaying to 8.96 afterwards. Read
    // after the work, the guard measures the benchmark and refuses a genuinely
    // idle machine every time.
    const source = readFileSync(new URL('../scripts/bench-browser.mjs', import.meta.url), 'utf8');
    // The negative lookahead is what makes this count *calls*: the export's own
    // `function readHostLoad() {` also ends in `()`, and counting it made this
    // case fail against correct code — the first version's mistake, caught by the
    // gate rather than by a later reader.
    const calls = [...source.matchAll(/readHostLoad\(\)(?!\s*\{)/g)];
    // Exactly one call site. More than one means a second, later reading exists
    // somewhere, and the archive would carry whichever won.
    expect(calls, 'exactly one readHostLoad() call site').toHaveLength(1);
    // `calls[0]!` and not `calls[0].index!`: with `noUncheckedIndexedAccess`
    // the error is on the element, and vitest does not type check this file, so
    // `pnpm check` is the only thing that can see it.
    const read = calls[0]!.index!;
    for (const [what, marker] of [
      ['the demo server spawn', "spawn(process.execPath, ['scripts/serve-examples.mjs']"],
      ['the browser launch', 'chromium.launch(']
    ] as const) {
      const at = source.indexOf(marker);
      expect(at, `${what} must still be in the script`).toBeGreaterThan(-1);
      expect(read, `the host must be read before ${what}`).toBeLessThan(at);
    }
  });
});
