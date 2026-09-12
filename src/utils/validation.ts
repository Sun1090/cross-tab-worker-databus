/**
 * 参数校验工具 —— CrossTabDataBus 构造选项与持久化配置的入口校验。
 *
 * 所有 `throw new TypeError(...)` 校验集中在此，DataBus 构造器与
 * IndexedDbReplayPersistence 共用同一组断言，错误消息与原有语义保持一致。
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
import { PRUNE_STRATEGY } from './constants';

/** Assert `value` is a positive safe integer. Throws a TypeError otherwise. */
export function assertPositiveSafeInteger(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer, got ${String(value)}.`);
  }
}

/** Assert `value` is a positive finite number. Throws a TypeError otherwise. */
export function assertPositiveFiniteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
}

/** Assert `value` is a non-negative finite number. Throws a TypeError otherwise. */
export function assertNonNegativeFiniteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number.`);
  }
}

/** Assert `value` is a valid replay prune strategy ('count' | 'age' | 'both'). */
export function assertPruneStrategy(value: unknown): asserts value is 'count' | 'age' | 'both' {
  const allowed: readonly string[] = [PRUNE_STRATEGY.COUNT, PRUNE_STRATEGY.AGE, PRUNE_STRATEGY.BOTH];
  if (!allowed.includes(String(value))) {
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
 * toward the *busiest* Worker instead of the quietest — and a non-finite one
 * would poison the score, so both are rejected here rather than silently
 * steering traffic. */
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
    `Centrifuge heartbeatIntervalMs must be a positive number or Infinity, got ${String(value)}.`
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
