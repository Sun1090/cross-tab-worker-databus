import type { DataBusMessage } from './types';
import { PRUNE_STRATEGY } from '../utils/constants';

/** Inputs shared by the in-memory ring and durable replay adapters. */
export interface ReplayPruningOptions {
  maxPerTopic: number;
  pruneStrategy: (typeof PRUNE_STRATEGY)[keyof typeof PRUNE_STRATEGY];
  retentionMs: number | undefined;
  now: number;
}

/**
 * Apply the public replay pruning policy to an insertion-ordered history.
 *
 * `count` keeps the newest `maxPerTopic` entries. `both` applies the retention
 * cutoff first and then the count cap. `age` intentionally leaves timestamped
 * entries uncapped so the retention window is the only bound for them, while
 * timestamp-less legacy entries are still capped by `maxPerTopic` because they
 * have no timestamp by which they can ever expire. The returned array is the
 * same instance when no entries need to be removed.
 */
export function pruneReplayHistory<TData>(
  messages: DataBusMessage<TData>[],
  options: ReplayPruningOptions
): DataBusMessage<TData>[] {
  const { maxPerTopic, pruneStrategy, retentionMs, now } = options;
  const ageEnabled = pruneStrategy !== PRUNE_STRATEGY.COUNT && retentionMs !== undefined;
  if (!ageEnabled) {
    return messages.length > maxPerTopic ? messages.slice(-maxPerTopic) : messages;
  }

  const cutoff = now - retentionMs;
  let hasExpired = false;
  let timestamplessCount = 0;
  for (const message of messages) {
    if (message.timestamp === undefined) timestamplessCount += 1;
    else if (message.timestamp < cutoff) hasExpired = true;
  }

  let pruned = hasExpired
    ? messages.filter(message => message.timestamp === undefined || message.timestamp >= cutoff)
    : messages;

  if (pruneStrategy === PRUNE_STRATEGY.BOTH) {
    return pruned.length > maxPerTopic ? pruned.slice(-maxPerTopic) : pruned;
  }

  if (timestamplessCount <= maxPerTopic) return pruned;
  let timestamplessToDrop = timestamplessCount - maxPerTopic;
  pruned = pruned.filter(message => {
    if (message.timestamp === undefined && timestamplessToDrop > 0) {
      timestamplessToDrop -= 1;
      return false;
    }
    return true;
  });
  return pruned;
}
