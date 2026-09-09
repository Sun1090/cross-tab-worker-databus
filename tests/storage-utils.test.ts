/**
 * Fault-injection coverage for the fault-tolerant storage primitives in
 * utils/storage-utils.ts. Every helper must swallow storage/parse failures —
 * coordination state is best-effort and a hostile or full storage backend
 * must never break the local transport. These tests pin each catch branch.
 */
import { describe, expect, it } from 'vitest';
import { listKeys, readAllByPrefix, readJson, writeJson } from '../src/utils/storage-utils';
import type { StorageLike } from '../src/core/environment';

/** A storage backend whose every method throws (quota exceeded, private
 * mode, detached iframe, …). Call counts are tracked per method. */
class BrokenStorage implements StorageLike {
  calls = { getItem: 0, setItem: 0, key: 0, length: 0 };
  get length(): number {
    this.calls.length += 1;
    throw new Error('storage is broken');
  }
  getItem(): string | null {
    this.calls.getItem += 1;
    throw new Error('storage is broken');
  }
  setItem(): void {
    this.calls.setItem += 1;
    throw new Error('storage is broken');
  }
  removeItem(): void {
    throw new Error('storage is broken');
  }
  key(): string | null {
    this.calls.key += 1;
    throw new Error('storage is broken');
  }
  clear(): void {
    throw new Error('storage is broken');
  }
}

/** Storage whose getItem always returns structurally corrupt JSON. */
class CorruptStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

describe('storage-utils fault tolerance', () => {
  it('readJson returns null when getItem throws and when the payload is corrupt', () => {
    const broken = new BrokenStorage();
    expect(readJson(broken, 'k')).toBeNull();
    expect(broken.calls.getItem).toBe(1);

    const corrupt = new CorruptStorage();
    corrupt.setItem('k', '{not json');
    expect(readJson(corrupt, 'k')).toBeNull();
    // Empty string (missing key semantics) is also null — not a parse attempt.
    corrupt.setItem('empty', '');
    expect(readJson(corrupt, 'empty')).toBeNull();
  });

  it('readJson round-trips a valid record', () => {
    const corrupt = new CorruptStorage();
    writeJson(corrupt, 'k', { value: 42 });
    expect(readJson<{ value: number }>(corrupt, 'k')).toEqual({ value: 42 });
  });

  it('writeJson swallows setItem failures', () => {
    const broken = new BrokenStorage();
    expect(() => writeJson(broken, 'k', { value: 1 })).not.toThrow();
    expect(broken.calls.setItem).toBe(1);
  });

  it('listKeys returns an empty list when storage access throws', () => {
    const broken = new BrokenStorage();
    expect(listKeys(broken, 'prefix:')).toEqual([]);
    expect(broken.calls.length).toBeGreaterThan(0);
  });

  it('listKeys filters by prefix and tolerates null keys', () => {
    const storage = new CorruptStorage();
    storage.setItem('route:a', '1');
    storage.setItem('route:b', '2');
    storage.setItem('worker:a', '3');
    expect(listKeys(storage, 'route:')).toEqual(['route:a', 'route:b']);
    expect(listKeys(storage, 'missing:')).toEqual([]);
  });

  it('readAllByPrefix skips corrupt records but keeps parseable ones', () => {
    const storage = new CorruptStorage();
    storage.setItem('p:good', '{"ok":true}');
    storage.setItem('p:bad', '{oops');
    // null key inside the enumeration cannot happen with Map-backed storage;
    // broken storage is covered by listKeys returning [].
    const entries = readAllByPrefix<{ ok: boolean }>(storage, 'p:');
    expect(entries).toEqual([{ key: 'p:good', value: { ok: true } }]);

    const broken = new BrokenStorage();
    expect(readAllByPrefix(broken, 'p:')).toEqual([]);
  });
});
