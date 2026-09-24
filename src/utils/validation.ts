/**
 * 参数校验工具 —— CrossTabDataBus 构造选项与持久化配置的入口校验。
 *
 * 绝大多数 `throw new TypeError(...)` 校验集中在此，DataBus 构造器与
 * IndexedDbReplayPersistence 共用同一组断言，错误消息与原有语义保持一致。
 * 唯一的例外是 `replay-manager.ts` 里 `clearBefore(timestamp)` 的
 * `Number.isFinite` 检查：它贴在自己的公共方法上，不在这里。新增校验时若
 * 想继续集中，请把这类只服务单个公共方法入口的检查也搬进来，否则请像它
 * 一样在这里留一句指向。
 *
 * 语义约定：可选字段只在**显式提供**时校验（undefined 由调用方落到默认值，
 * 默认值始终合法）；必填字段总是校验。
 */
import type {
  DataBusDedupOptions,
  DataBusPersistenceRetryOptions,
  DataBusReplayOptions
} from '../core/data-bus';
import type { LoadWeightingOptions } from '../core/types';
import { describeFailure } from './error-utils';
import { PRUNE_STRATEGY } from './constants';

// The three numeric predicates below share one guard shape — a `typeof` test first,
// then a type-checking `Number.is*` predicate, then the sign — and each operand was
// deleted on its own and measured against the whole suite. The sign test and the
// `Number.is*` test are both pinned: six of those nine deletions die to named
// option-rejection cases in `cluster.test.ts`, `data-bus.test.ts` and
// `replay-persistence.test.ts`. Those six are not equally pinned, and the weakest one
// is worth naming so nobody assumes a net here: `assertNonNegativeFiniteNumber`'s
// predicate leg dies to exactly one test, while each of the other five legs dies to
// several. That single case still feeds the right value —
// `rejects a negative or non-finite loadWeighting weight` passes `NaN` and `Infinity`,
// which only the predicate rejects once the sign test is left behind, and `-1`, which
// only the sign rejects — so it is thin, not wrong.
//
// The `typeof value !== 'number'` operand cannot decide in any of the three. Both
// `Number.isSafeInteger` and `Number.isFinite` answer false for a non-number without
// coercing, so every value that trips this test trips the next one too, with the same
// message. Measured rather than argued: a 23-value vector (numeric strings, `''`,
// booleans, `null`, `undefined`, a prototype-less object, an array, a symbol, a
// `BigInt`, a function, a boxed `Number`, `NaN`, `±Infinity`, `0`, `-0`, `1.5`, a value
// past `MAX_SAFE_INTEGER`, `MAX_VALUE`) produced a byte-identical
// accept/reject-and-message vector for all three guards as written and for each of the
// three `typeof` tests deleted — so no test can pin this operand, and it is not a gap.
//
// It stays, because of one specific and very easy edit: writing the familiar global
// `isFinite(value)` instead of `Number.isFinite(value)`, which coerces - so
// `heartbeatIntervalMs: '3000'` would pass. Measured in both halves: with this operand
// in place, swapping the predicate kills nothing; with both gone,
// `rejects a non-positive or non-finite heartbeatIntervalMs` reddens, because that
// string has become an accepted option.
//
// `eslint.config.js` now also configures `no-restricted-globals` for `isFinite` and
// `isNaN`, added after the measurement above was taken and verified by introducing the
// swap (eslint reports it at the call). So this leg is defended twice, and the two
// defences cover different removals: deleting the operand alone changes nothing today,
// and deleting the rule re-opens the swap without touching this file. The measured
// counterfactual stays recorded here because it is what justifies not deleting the
// operand as redundant - a comment that only said "defensive" would not survive the
// next cleanup pass.
/** Assert `value` is a positive safe integer. Throws a TypeError otherwise.
 * The offending value is rendered through `describeFailure` because it is
 * arbitrary caller input: `String(Object.create(null))` throws, which would
 * replace "your option is wrong" with a complaint about this message. */
export function assertPositiveSafeInteger(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer, got ${describeFailure(value)}.`);
  }
}

/** Assert `value` is a positive finite number. Throws a TypeError otherwise. The
 * per-operand verdicts for this guard shape, including why its `typeof` test cannot
 * decide anything, are recorded above `assertPositiveSafeInteger`. */
export function assertPositiveFiniteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
}

/** Assert `value` is a non-negative finite number. Throws a TypeError otherwise. Same
 * guard shape, and the same verdict on its `typeof` operand, as noted above
 * `assertPositiveSafeInteger`. */
export function assertNonNegativeFiniteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number.`);
  }
}

/** Assert `value` is a valid replay prune strategy ('count' | 'age' | 'both'). */
export function assertPruneStrategy(value: unknown): asserts value is 'count' | 'age' | 'both' {
  const allowed: readonly string[] = [PRUNE_STRATEGY.COUNT, PRUNE_STRATEGY.AGE, PRUNE_STRATEGY.BOTH];
  if (!allowed.includes(describeFailure(value))) {
    throw new TypeError('pruneStrategy must be count, age, or both.');
  }
}

/** Validate the replay options block. Optional fields are validated only when
 * provided; omitted fields fall through to their defaults. */
export function assertReplayOptions(replay: DataBusReplayOptions | undefined): void {
  if (!replay) return;
  if (replay.maxPerTopic !== undefined) assertPositiveSafeInteger(replay.maxPerTopic, 'replay.maxPerTopic');
  if (replay.pruneStrategy !== undefined) assertPruneStrategy(replay.pruneStrategy);
  if (replay.retentionMs !== undefined) assertPositiveFiniteNumber(replay.retentionMs, 'replay.retentionMs');
  if (replay.retentionSweepMs !== undefined) {
    assertPositiveFiniteNumber(replay.retentionSweepMs, 'replay.retentionSweepMs');
  }
  if (replay.persistenceRetry) assertPersistenceRetryOptions(replay.persistenceRetry);
}

/** Validate the replay persistence retry policy. */
export function assertPersistenceRetryOptions(retry: DataBusPersistenceRetryOptions): void {
  if (retry.maxAttempts !== undefined) {
    assertPositiveSafeInteger(retry.maxAttempts, 'replay.persistenceRetry.maxAttempts');
  }
  if (retry.backoffMs !== undefined) {
    assertNonNegativeFiniteNumber(retry.backoffMs, 'replay.persistenceRetry.backoffMs');
  }
}

/** Validate the dedup options block. Optional fields are validated only when
 * provided; omitted fields fall through to their defaults. */
export function assertDedupOptions(dedup: DataBusDedupOptions | undefined): void {
  if (!dedup) return;
  if (dedup.maxEntries !== undefined) assertPositiveSafeInteger(dedup.maxEntries, 'dedup.maxEntries');
  if (dedup.ttlMs !== undefined) assertPositiveFiniteNumber(dedup.ttlMs, 'dedup.ttlMs');
  if (dedup.sweepMs !== undefined) assertPositiveFiniteNumber(dedup.sweepMs, 'dedup.sweepMs');
  const bounds = dedup.adaptiveTtl;
  if (bounds !== undefined) {
    // Both bounds must be finite positive numbers with `minMs <= maxMs`.
    // A `NaN`/non-number slips past a plain `<=` comparison (`NaN <= 0` and
    // `maxMs < NaN` are both false), which would leave `currentTtl()` returning
    // `NaN` and silently disable expiry instead of failing loudly.
    const finite = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value);
    if (!finite(bounds.minMs) || !finite(bounds.maxMs) || bounds.minMs <= 0 || bounds.maxMs < bounds.minMs) {
      throw new TypeError('dedup.adaptiveTtl bounds are invalid.');
    }
  }
}

/** Validate the transport recovery pacing options. Optional fields are validated
 * only when provided; omitted fields fall through to their defaults. */
export function assertRecoveryOptions(recovery: {
  cooldownMs?: number;
  maxAttempts?: number;
} | undefined): void {
  if (!recovery) return;
  if (recovery.cooldownMs !== undefined) {
    assertPositiveFiniteNumber(recovery.cooldownMs, 'recovery.cooldownMs');
  }
  const maxAttempts = recovery.maxAttempts;
  if (
    maxAttempts !== undefined &&
    !(maxAttempts === Number.POSITIVE_INFINITY ||
      (typeof maxAttempts === 'number' && Number.isSafeInteger(maxAttempts) && maxAttempts > 0))
  ) {
    throw new TypeError('recovery.maxAttempts must be a positive safe integer.');
  }
}

/** Validate the adaptive owner-weighting weights.
 *
 * Each weight is a non-negative finite number of "topic-equivalents" added per
 * unit of the sampled signal; `0` (the default) disables that signal. A
 * negative weight would invert the documented policy — biasing NEW routes
 * toward the *busiest* Worker instead of the quietest. A non-finite one cannot
 * poison an individual score either: `effectiveWorkerLoad` ends in a
 * `Number.isFinite` fallback (`routing.ts:64-70`), which is what its own
 * comment says a non-finite weight is for. What it does instead is worse to
 * notice — that fallback fires for *every* worker, so all loads collapse to the
 * raw topic count and the adaptive term is switched off silently. Both are
 * rejected here so the misconfiguration fails loudly. */
export function assertLoadWeightingOptions(loadWeighting: LoadWeightingOptions | undefined): void {
  if (!loadWeighting) return;
  const weights: Record<string, number | undefined> = {
    messageRateWeight: loadWeighting.messageRateWeight,
    byteRateWeight: loadWeighting.byteRateWeight,
    scheduleLagWeight: loadWeighting.scheduleLagWeight
  };
  for (const [name, value] of Object.entries(weights)) {
    if (value !== undefined) assertNonNegativeFiniteNumber(value, `loadWeighting.${name}`);
  }
}

/** Validate the cluster coordination options shared by `WorkerClusterRuntime`
 * and `CrossTabDataBus`.
 *
 * These were previously unvalidated, so a `heartbeatIntervalMs` of `0` or `NaN`
 * silently turned the heartbeat `setInterval` into a 0ms busy loop (the same
 * failure the Centrifuge PING guard exists to prevent), a non-positive
 * `workerTtlMs` pruned every peer on the first reconcile, and a non-positive
 * `maxActiveWorkers`/`routeOwnerCacheMax` disabled ownership or caching
 * outright. `Infinity` is rejected for the heartbeat here: unlike the Centrifuge
 * PING it cannot mean "disable", because a Worker that never refreshes its
 * heartbeat is pruned by its own TTL. */
export function assertClusterOptions(options: {
  maxActiveWorkers?: number;
  heartbeatIntervalMs?: number;
  workerTtlMs?: number;
  routeOwnerCacheMax?: number;
  loadWeighting?: LoadWeightingOptions;
}): void {
  if (options.maxActiveWorkers !== undefined) {
    assertPositiveSafeInteger(options.maxActiveWorkers, 'maxActiveWorkers');
  }
  if (options.heartbeatIntervalMs !== undefined) {
    assertPositiveFiniteNumber(options.heartbeatIntervalMs, 'heartbeatIntervalMs');
  }
  if (options.workerTtlMs !== undefined) {
    assertPositiveFiniteNumber(options.workerTtlMs, 'workerTtlMs');
  }
  if (options.routeOwnerCacheMax !== undefined) {
    assertPositiveSafeInteger(options.routeOwnerCacheMax, 'routeOwnerCacheMax');
  }
  assertLoadWeightingOptions(options.loadWeighting);
}

/** Validate the SharedWorker PING heartbeat interval. A value of `0`, a negative
 * number, or `NaN` would otherwise make `setInterval` degenerate into a 0ms busy
 * loop, driving the reaper and the main-thread PING out of control. `Infinity`
 * is allowed and disables heartbeats entirely (for environments where the
 * SharedWorker reaper is not needed, e.g. a single-tab deployment).
 * @throws {TypeError} when `value` is not a positive finite number or Infinity. */
export function assertHeartbeatInterval(value: number): void {
  if (value === Infinity) return;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return;
  throw new TypeError(
    `Centrifuge heartbeatIntervalMs must be a positive number or Infinity, got ${describeFailure(value)}.`
  );
}

/** Public topic boundary. An empty string is not a channel any transport can
 * address: the cluster happily routes it as a literal topic key, but a Centrifuge
 * channel or a WebSocket frame topic of `''` never matches a publication, so a
 * subscription to it can never receive anything and a publication to it is
 * dropped without a trace. Accepted-and-warned from 0.20.96, rejected from
 * 0.21.0 so the mistake surfaces at the call instead of as missing data.
 * @throws {TypeError} when `topic` is the empty string. */
export function assertPublicTopic(operation: string, topic: string): void {
  if (topic !== '') return;
  throw new TypeError(
    `CrossTabDataBus.${operation}("") addresses a channel no transport can route; use a non-empty topic.`
  );
}

/** Validate that `value` is structured-cloneable. Throws early so config errors
 * surface on the main thread rather than silently failing inside the Worker
 * (where a DataCloneError would be reported as a generic Worker error with no
 * actionable message). Skips validation when `structuredClone` is unavailable
 * (older browsers without the API) — the Worker will still throw on its own.
 * @throws {TypeError} when `value` contains non-cloneable members (functions,
 *   Symbols, DOM nodes, etc.). */
export function assertStructuredCloneable(value: unknown): void {
  if (typeof structuredClone !== 'function') return;
  try {
    structuredClone(value);
  } catch (error) {
    throw new TypeError(
      'Centrifuge Worker configuration and published data must be structured-cloneable.',
      { cause: error }
    );
  }
}
