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

/** A reaped port: announce the loss, close it (stop message delivery), then stop
 * its session. `notify` runs first and on its own because a port that is about to
 * be closed is the only chance its owner gets to learn why. */
export interface ReapTarget {
  notify(): void;
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
   * `Infinity` is the documented way to disable the PING heartbeat, and it means
   * this port can never be judged silent: `startHeartbeat()` sends nothing at all
   * once configured that way, so a timeout would be a death sentence with no
   * possible appeal. A non-finite-or-non-positive *other* value falls back to the
   * default so a bad payload cannot degenerate the reaper into a busy loop or
   * silence it — those three (NaN, 0, negative) are rejected by
   * `assertHeartbeatInterval` at the transport constructor and so can only arrive
   * from a main thread that is not this library. No-op for untracked ports (e.g.
   * setTimeout arrives after remove/STOP). */
  setTimeout(port: MessagePort, heartbeatIntervalMs: number): void {
    if (!this.targets.has(port)) return;
    const safe = heartbeatIntervalMs === Infinity
      ? Infinity
      : Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0
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
      // Both `??` arms are uncovered and dominated, and the enumeration is the
      // tracking contract above: `targets` gains a port only in `register()`,
      // which writes all three maps, and loses one only in `remove()` and in the
      // loop below, and in the whole-map `clear()`s of dispose(): a port in
      // `targets` is therefore in the other two as well. Measured — replacing the
      // first fallback with a non-null assertion leaves all 37 test files green.
      // It stays because of what a half-registered port would cost: `lastSeen` 0
      // reads as silent-since-epoch, so the next tick closes a session that was
      // never late, which is a worse failure than the undefined it stands in for.
      const lastSeen = this.lastSeenAt.get(port) ?? 0;
      const timeout = this.sessionTimeoutMs.get(port) ?? DEFAULT_SESSION_TIMEOUT_MS;
      if (now - lastSeen <= timeout) continue;
      this.targets.delete(port);
      this.lastSeenAt.delete(port);
      this.sessionTimeoutMs.delete(port);
      // Announce before withdrawing, then close the port and stop the session.
      // The order matters in both directions:
      // - `notify` is the last thing this port ever delivers, and it has to
      //   precede `close()`, because a closed port discards everything posted to
      //   it — including the session's own `disconnected` status post. A tab whose
      //   heartbeat was merely starved (a long task, the throttling a backgrounded
      //   tab gets) rather than gone is alive and can rebuild its backend, but only
      //   if it learns the session left. Measured in a real browser before this
      //   existed: a 34 s stall got a shared-mode tab's port reaped while the bus
      //   kept `state: healthy` / `status: connected` and its routes, and every
      //   publication it posted went into the closed port and vanished.
      // - `close` still precedes `stop`: the STOP handler posts that
      //   `disconnected` status back to the port, which must not reach the main
      //   thread after it has been told outright, and a closed port can never
      //   deliver a later message that would resurrect the session outside the
      //   reaper's tracking.
      // All three share the existing try/catch, which isolates a failing target
      // from the *other* ports in the pass. That is the same guarantee `close`
      // already had: a step that throws also skips the steps after it for this one
      // target, which is accepted here rather than newly introduced.
      try {
        target.notify();
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