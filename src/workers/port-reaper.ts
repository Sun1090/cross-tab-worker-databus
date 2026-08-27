/**
 * Reaper for SharedWorker ports.
 *
 * A `MessagePort` has no `close` event, so the SharedWorker cannot tell whether
 * a tab died without sending STOP. The main thread therefore sends periodic
 * PING messages, and this reaper closes any session whose port has been silent
 * longer than its timeout.
 *
 * The cadence is adaptive: the reaper runs at the smallest configured heartbeat
 * interval across active ports, and stops entirely when the last port is
 * removed, so a long-lived SharedWorker does not run a perpetual no-op interval
 * between connect bursts.
 *
 * The timers and clock are injected so the reaper can be unit-tested without a
 * real worker or DOM.
 */

import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MULTIPLIER
} from '../centrifuge-protocol';

/** A reaped port: close it (stop message delivery) and stop its session. */
export interface ReapTarget {
  close(): void;
  stop(): void;
}

type SetTimer = (callback: () => void, ms: number) => number;
type ClearTimer = (handle: number) => void;

export class PortReaper {
  private readonly targets = new Map<MessagePort, ReapTarget>();
  private readonly lastSeenAt = new Map<MessagePort, number>();
  private readonly sessionTimeoutMs = new Map<MessagePort, number>();
  private handle: number | null = null;
  private intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

  constructor(
    private readonly now: () => number = Date.now,
    setTimer: SetTimer = (callback, ms) => setInterval(callback, ms) as unknown as number,
    clearTimer: ClearTimer = handle => clearInterval(handle)
  ) {
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;

  /** Track a newly connected port and its session. The default timeout applies
   * until the port sends an INIT with its own heartbeat config, at which point
   * setTimeout() overrides it. register() always calls schedule() so the
   * reaper interval starts as soon as the first port connects. */
  register(port: MessagePort, target: ReapTarget): void {
    this.targets.set(port, target);
    this.lastSeenAt.set(port, this.now());
    this.sessionTimeoutMs.set(port, DEFAULT_SESSION_TIMEOUT_MS);
    this.schedule();
  }

  /** Record activity on a port (any incoming message). No-op for untracked
   * ports — a late PING from a port that was already removed/STOP'd must not
   * resurrect it in the reaper's tracking maps. */
  touch(port: MessagePort): void {
    if (!this.targets.has(port)) return;
    this.lastSeenAt.set(port, this.now());
  }

  /** Override a port's session timeout from its INIT heartbeat config.
   * A non-finite or non-positive value falls back to the default so a bad
   * payload cannot degenerate the reaper into a busy loop or silence it.
   * No-op for untracked ports (e.g. setTimeout arrives after remove/STOP). */
  setTimeout(port: MessagePort, heartbeatIntervalMs: number): void {
    if (!this.targets.has(port)) return;
    const safe = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
      ? heartbeatIntervalMs
      : DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.sessionTimeoutMs.set(port, safe * DEFAULT_SESSION_TIMEOUT_MULTIPLIER);
    this.schedule();
  }

  /** Remove a port (STOP message). The caller is responsible for closing the
   * port and stopping the session. No-op for untracked ports so a duplicate
   * STOP or a STOP-after-reap cannot corrupt the reaper's bookkeeping. */
  remove(port: MessagePort): void {
    if (!this.targets.has(port)) return;
    this.targets.delete(port);
    this.lastSeenAt.delete(port);
    this.sessionTimeoutMs.delete(port);
    this.schedule();
  }

  /** Clear all state and stop the reaper. Closes and stops every tracked
   * session so the SharedWorker does not leak WebSockets on shutdown. */
  dispose(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
    for (const target of this.targets.values()) {
      try {
        target.close();
        target.stop();
      } catch {
        // A failing target must not prevent the rest from being cleaned up.
      }
    }
    this.targets.clear();
    this.lastSeenAt.clear();
    this.sessionTimeoutMs.clear();
  }

  /** Recompute the reaper cadence, or stop it entirely when no ports remain.
   * Idempotent: if the interval is already running at the correct cadence,
   * no new timer is created. This guards against register/remove/setTimeout
   * each spawning redundant timers when the cadence hasn't changed. */
  private schedule(): void {
    if (this.sessionTimeoutMs.size === 0) {
      if (this.handle !== null) this.clearTimer(this.handle);
      this.handle = null;
      return;
    }
    const minHeartbeat = this.computeMinHeartbeat();
    if (this.handle !== null && this.intervalMs === minHeartbeat) return;
    if (this.handle !== null) this.clearTimer(this.handle);
    this.intervalMs = minHeartbeat;
    this.handle = this.setTimer(() => this.reap(), minHeartbeat);
  }

  /** Smallest heartbeat interval among active ports, derived from each port's
   * configured session timeout. Exposed as a method so the cadence logic can
   * be unit-tested in isolation from the timer plumbing. */
  private computeMinHeartbeat(): number {
    let minHeartbeat = DEFAULT_HEARTBEAT_INTERVAL_MS;
    for (const timeout of this.sessionTimeoutMs.values()) {
      minHeartbeat = Math.min(minHeartbeat, timeout / DEFAULT_SESSION_TIMEOUT_MULTIPLIER);
    }
    return minHeartbeat;
  }

  /** Close sessions whose port has been silent longer than its timeout.
   * Iterates a snapshot so closing a target (which mutates `targets`) during
   * the loop cannot skip a subsequent entry or visit one twice. */
  private reap(): void {
    const now = this.now();
    let reapedAny = false;
    for (const [port, target] of Array.from(this.targets)) {
      const lastSeen = this.lastSeenAt.get(port) ?? 0;
      const timeout = this.sessionTimeoutMs.get(port) ?? DEFAULT_SESSION_TIMEOUT_MS;
      if (now - lastSeen <= timeout) continue;
      this.targets.delete(port);
      this.lastSeenAt.delete(port);
      this.sessionTimeoutMs.delete(port);
      // Close the port before stopping the session: the STOP handler posts a
      // `disconnected` status back to the port, which must not reach a live
      // but slow main thread, and a closed port can never deliver a later
      // message that would resurrect the session outside the reaper's tracking.
      try {
        target.close();
        target.stop();
      } catch {
        // A failing target must not prevent the rest from being reaped or
        // leave the reaper in a broken state for subsequent ticks.
      }
      reapedAny = true;
    }
    // Recompute the cadence (and clear the interval if the last port was reaped).
    if (reapedAny) this.schedule();
  }
}