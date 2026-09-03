import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectWorkerBackend } from '../src/worker-mode';

describe('selectWorkerBackend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers dedicated unless shared or auto is requested', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('dedicated')).toBe('dedicated');
    expect(selectWorkerBackend('shared')).toBe('shared');
    expect(selectWorkerBackend('auto')).toBe('shared');
  });

  it('falls back to shared when Dedicated Worker is unavailable', () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('dedicated')).toBe('shared');
    expect(selectWorkerBackend('shared')).toBe('shared');
    expect(selectWorkerBackend('auto')).toBe('shared');
  });

  it('falls back to dedicated when SharedWorker is unavailable', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', undefined);
    expect(selectWorkerBackend('dedicated')).toBe('dedicated');
    expect(selectWorkerBackend('shared')).toBe('dedicated');
    expect(selectWorkerBackend('auto')).toBe('dedicated');
  });

  it('returns local mode when no worker API exists', () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('SharedWorker', undefined);
    expect(selectWorkerBackend('dedicated')).toBe('local');
    expect(selectWorkerBackend('shared')).toBe('local');
    expect(selectWorkerBackend('auto')).toBe('local');
  });

  it('honors explicit factories even when globals are missing', () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('SharedWorker', undefined);
    expect(selectWorkerBackend('dedicated', { worker: true })).toBe('dedicated');
    expect(selectWorkerBackend('shared', { sharedWorker: true })).toBe('shared');
    expect(selectWorkerBackend('auto', { sharedWorker: true })).toBe('shared');
  });
});

describe('selectWorkerBackend availability overrides', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('degrades dedicated to shared when worker=false, sharedWorker=true', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('dedicated', { worker: false, sharedWorker: true })).toBe('shared');
    expect(selectWorkerBackend('shared', { worker: false, sharedWorker: true })).toBe('shared');
  });

  it('degrades shared to dedicated when worker=true, sharedWorker=false', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('shared', { worker: true, sharedWorker: false })).toBe('dedicated');
    expect(selectWorkerBackend('dedicated', { worker: true, sharedWorker: false })).toBe('dedicated');
  });

  it('returns local for any mode when both worker and sharedWorker are false', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('dedicated', { worker: false, sharedWorker: false })).toBe('local');
    expect(selectWorkerBackend('shared', { worker: false, sharedWorker: false })).toBe('local');
    expect(selectWorkerBackend('auto', { worker: false, sharedWorker: false })).toBe('local');
  });

  it('resolves normally when both worker and sharedWorker are true', () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('SharedWorker', undefined);
    expect(selectWorkerBackend('auto', { worker: true, sharedWorker: true })).toBe('shared');
    expect(selectWorkerBackend('shared', { worker: true, sharedWorker: true })).toBe('shared');
    expect(selectWorkerBackend('dedicated', { worker: true, sharedWorker: true })).toBe('dedicated');
  });

  it('treats an empty availability object as default feature detection', () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('SharedWorker', class {});
    expect(selectWorkerBackend('auto', {})).toBe('shared');
    expect(selectWorkerBackend('auto')).toBe('shared');
  });

  it('keeps the fallback matrix deterministic for every preference and capability pair', () => {
    const cases = [
      ['dedicated', true, true, 'dedicated'], ['dedicated', true, false, 'dedicated'],
      ['dedicated', false, true, 'shared'], ['dedicated', false, false, 'local'],
      ['shared', true, true, 'shared'], ['shared', true, false, 'dedicated'],
      ['shared', false, true, 'shared'], ['shared', false, false, 'local'],
      ['auto', true, true, 'shared'], ['auto', true, false, 'dedicated'],
      ['auto', false, true, 'shared'], ['auto', false, false, 'local']
    ] as const;
    for (const [mode, worker, sharedWorker, expected] of cases) {
      expect(selectWorkerBackend(mode, { worker, sharedWorker })).toBe(expected);
    }
  });
});
