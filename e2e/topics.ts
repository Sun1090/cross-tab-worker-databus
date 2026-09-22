/**
 * Collision-free topic names for the browser suites.
 *
 * Every topic here doubles as a Centrifugo channel, and `serverSubscribers()`
 * counts connections to that channel *across the whole server*. The suites also
 * assert that count equals one — "exactly one tab holds this topic" — so two
 * tests that pick the same name make that assertion measure two clusters at
 * once, and it can never settle: the correct behaviour of both is reported as a
 * failure.
 *
 * `Date.now()` alone does not cover this. `playwright.config.ts` sets
 * `fullyParallel: true` with the platform default worker count off CI, and
 * `--repeat-each` runs the same case several times, so two tests can start in
 * the same millisecond and derive identical names — which is how a local
 * `--repeat-each=3` produced a two-subscriber channel and a 30s poll failure on
 * code that had no defect. Worker index, retry count and a per-process sequence
 * counter make the name unique in every axis along which the suite can run
 * concurrently; the timestamp still separates runs on a shared server.
 */
import { test } from '@playwright/test';

let sequence = 0;

export function uniqueTopic(prefix: string): string {
  const info = test.info();
  return `${prefix}.w${info.workerIndex}.r${info.retry}.s${(sequence += 1)}.${Date.now()}`;
}
