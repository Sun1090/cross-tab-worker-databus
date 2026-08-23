import { describe, expect, it, vi } from 'vitest';
import { PortReaper, type ReapTarget } from '../src/workers/port-reaper';

/** Minimal MessagePort stand-in: only the fields PortReaper touches. */
class PortDouble {
  closed = false;
  close(): void {
    this.closed = true;
  }
}

/** Minimal session stand-in recording STOP deliveries. */
class SessionDouble implements ReapTarget {
  closed = false;
  stopped = 0;
  close(): void {
    this.closed = true;
  }
  stop(): void {
    this.stopped++;
  }
}

function makeReaper() {
  const ports = new Map<string, PortDouble>();
  const sessions = new Map<string, SessionDouble>();
  const reaper = new PortReaper();
  const register = (id: string, heartbeatMs?: number) => {
    const port = new PortDouble();
    const session = new SessionDouble();
    ports.set(id, port);
    sessions.set(id, session);
    reaper.register(port as unknown as MessagePort, {
      close: () => port.close(),
      stop: () => session.stop()
    });
    if (heartbeatMs !== undefined) reaper.setTimeout(port as unknown as MessagePort, heartbeatMs);
    return { port, session };
  };
  return { reaper, ports, sessions, register };
}

describe('PortReaper', () => {
  it('reaps a silent port after its timeout, closing it before stopping the session', () => {
    vi.useFakeTimers();
    const { reaper, register } = makeReaper();
    const { port, session } = register('tab-a');

    // 10s probe: 10 s elapsed but timeout is 30 s — not reaped yet.
    vi.advanceTimersByTime(10_000);
    expect(port.closed).toBe(false);
    expect(session.stopped).toBe(0);

    // 40s probe: 40 s > 30 s timeout — reaped.
    vi.advanceTimersByTime(31_000);
    expect(port.closed).toBe(true);
    expect(session.stopped).toBe(1);

    // Already reaped — a later probe must not stop it again.
    vi.advanceTimersByTime(10_000);
    expect(session.stopped).toBe(1);
    vi.useRealTimers();
  });

  it('keeps a port alive while it sends messages within the timeout', () => {
    vi.useFakeTimers();
    const { reaper, register } = makeReaper();
    const { port, session } = register('tab-a');

    // Touch shortly before the timeout, then again, never exceeding it.
    for (let t = 10_000; t < 100_000; t += 20_000) {
      vi.advanceTimersByTime(10_000);
      reaper.touch(port as unknown as MessagePort);
    }

    expect(port.closed).toBe(false);
    expect(session.stopped).toBe(0);
    vi.useRealTimers();
  });

  it('uses the per-port heartbeat config for its timeout and cadence', () => {
    vi.useFakeTimers();
    const { register } = makeReaper();
    const { port, session } = register('tab-a', 5_000); // timeout 15s, cadence 5s

    // 10s probe: 10 s elapsed but timeout is 15 s — still alive.
    vi.advanceTimersByTime(10_000);
    expect(port.closed).toBe(false);

    // 15s probe: 15 s == timeout — not reaped yet (need > 15s).
    vi.advanceTimersByTime(5_000);
    expect(port.closed).toBe(false);

    // 20s probe: 20 s > 15 s — reaped.
    vi.advanceTimersByTime(5_001);
    expect(port.closed).toBe(true);
    expect(session.stopped).toBe(1);
    vi.useRealTimers();
  });

  it('clears the interval when the last port is reaped and restarts it on the next connect', () => {
    vi.useFakeTimers();
    const clears: number[] = [];
    const sets: number[] = [];
    const reaper = new PortReaper(
      Date.now,
      (callback, ms) => {
        sets.push(ms);
        return setInterval(callback, ms) as unknown as number;
      },
      handle => {
        clears.push(handle);
        clearInterval(handle);
      }
    );
    const reapTarget = (port: PortDouble, session: SessionDouble): ReapTarget => ({
      close: () => port.close(),
      stop: () => session.stop()
    });

    const portA = new PortDouble();
    const sessionA = new SessionDouble();
    reaper.register(portA as unknown as MessagePort, reapTarget(portA, sessionA));
    expect(sets).toEqual([10_000]);

    // 40s probe: 40 s > 30 s timeout — reaped.
    vi.advanceTimersByTime(41_000);
    expect(portA.closed).toBe(true);
    // Reaping the last port clears the interval (one clear for the 40s probe).
    expect(clears.length).toBe(1);

    // A new connect restarts a fresh interval instead of reusing the stale one.
    const portB = new PortDouble();
    const sessionB = new SessionDouble();
    reaper.register(portB as unknown as MessagePort, reapTarget(portB, sessionB));
    expect(sets).toEqual([10_000, 10_000]);

    // 40s probe: 40 s > 30 s timeout — reaped.
    vi.advanceTimersByTime(41_000);
    expect(portB.closed).toBe(true);
    expect(sessionB.stopped).toBe(1);
    vi.useRealTimers();
  });

  it('removes a port without reaping other ports', () => {
    vi.useFakeTimers();
    const { reaper, register } = makeReaper();
    const { port: portA, session: sessionA } = register('tab-a');
    const { port: portB, session: sessionB } = register('tab-b');

    reaper.remove(portA as unknown as MessagePort);
    // Removed port is no longer tracked; touching it is a no-op.
    reaper.touch(portA as unknown as MessagePort);

    // 40s probe: 40 s > 30 s timeout — portB (still tracked) is reaped.
    vi.advanceTimersByTime(41_000);
    expect(portA.closed).toBe(false);
    expect(sessionA.stopped).toBe(0);
    expect(portB.closed).toBe(true);
    expect(sessionB.stopped).toBe(1);
    vi.useRealTimers();
  });

  it('dispose stops the reaper and releases all targets', () => {
    vi.useFakeTimers();
    const { reaper, register } = makeReaper();
    register('tab-a');
    register('tab-b');

    reaper.dispose();

    // Draining time must not reap anything after dispose.
    vi.advanceTimersByTime(100_000);
    expect(reaper['targets'].size).toBe(0);
    expect(reaper['handle']).toBeNull();
    vi.useRealTimers();
  });
});