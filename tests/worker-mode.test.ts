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
