/**
 * localStorage 读写工具 —— 容错的 JSON 读、静默写、按前缀枚举。
 *
 * 从 WorkerClusterRuntime 拆出：cluster.ts 顶部原有的 readJson/writeJson/
 * listKeys/readAllByPrefix 四处搬到此文件，协调层与快照逻辑共用同一套
 * 容错语义（损坏 JSON 视为不存在、写失败不抛出）。
 */
import type { StorageLike } from '../core/environment';

/** Parse a JSON value from storage, returning null on malformed or missing data.
 * Never throws — a corrupt record is treated as absent so the reconcile cycle
 * can recreate it. */
export function readJson<T>(storage: StorageLike, key: string): T | null {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

/** Write a JSON value to storage, swallowing storage errors (coordination is
 * best-effort; a failed write does not break the local transport). The actual
 * write may be coalesced by BatchingStorageWriter — this just calls setItem. */
export function writeJson(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Coordination is best-effort. The local transport remains usable.
  }
}

/** List all storage keys that start with `prefix`. */
export function listKeys(storage: StorageLike, prefix: string): string[] {
  try {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => Boolean(key?.startsWith(prefix))
    );
  } catch {
    return [];
  }
}

/** Read and parse every JSON record whose key starts with `prefix`. */
export function readAllByPrefix<T>(storage: StorageLike, prefix: string): Array<{ key: string; value: T }> {
  return listKeys(storage, prefix)
    .map(key => ({ key, value: readJson<T>(storage, key) }))
    .filter((entry): entry is { key: string; value: T } => entry.value !== null);
}
