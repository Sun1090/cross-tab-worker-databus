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

import { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SESSION_TIMEOUT_MULTIPLIER } from '../centrifuge-protocol';

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
   * until the port sends an INIT with its own heartbeat config. */
  register(port: MessagePort, target: ReapTarget): void {
    this.targets.set(port, target);
    this.lastSeenAt.set(port, this.now());
    this.sessionTimeoutMs.set(port, DEFAULT_HEARTBEAT_INTERVAL_MS * DEFAULT_SESSION_TIMEOUT_MULTIPLIER);
    this.schedule();
  }

  /** Record activity on a port (any incoming message). No-op for untracked ports. */
  touch(port: MessagePort): void {
    if (!this.targets.has(port)) return;
    this.lastSeenAt.set(port, this.now());
  }

  /** Override a port's session timeout from its INIT heartbeat config.
   * A non-finite or non-positive value falls back to the default so a bad
   * payload cannot degenerate the reaper into a busy loop or silence it. */
  setTimeout(port: MessagePort, heartbeatIntervalMs: number): void {
    if (!this.targets.has(port)) return;
    const safe = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
      ? heartbeatIntervalMs
      : DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.sessionTimeoutMs.set(port, safe * DEFAULT_SESSION_TIMEOUT_MULTIPLIER);
    this.schedule();
  }

  /** Remove a port (STOP message). The caller is responsible for closing the
   * port and stopping the session. */
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

  /** Recompute the reaper cadence, or stop it entirely when no ports remain. */
  private schedule(): void {
    if (this.sessionTimeoutMs.size === 0) {
      if (this.handle !== null) this.clearTimer(this.handle);
      this.handle = null;
      return;
    }
    // Recompute the smallest heartbeat interval among active ports.
    let minHeartbeat = DEFAULT_HEARTBEAT_INTERVAL_MS;
    for (const timeout of this.sessionTimeoutMs.values()) {
      minHeartbeat = Math.min(minHeartbeat, timeout / DEFAULT_SESSION_TIMEOUT_MULTIPLIER);
    }
    if (this.handle !== null && this.intervalMs === minHeartbeat) return;
    if (this.handle !== null) this.clearTimer(this.handle);
    this.intervalMs = minHeartbeat;
    this.handle = this.setTimer(() => this.reap(), minHeartbeat);
  }

  /** Close sessions whose port has been silent longer than its timeout. */
  private reap(): void {
    const now = this.now();
    let reapedAny = false;
    for (const [port, target] of [...this.targets]) {
      const lastSeen = this.lastSeenAt.get(port) ?? 0;
      const timeout =
        this.sessionTimeoutMs.get(port) ??
        DEFAULT_HEARTBEAT_INTERVAL_MS * DEFAULT_SESSION_TIMEOUT_MULTIPLIER;
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