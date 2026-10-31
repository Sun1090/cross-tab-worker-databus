/**
 * Alias-chain following, shared by both compiler surfaces.
 *
 * The two surfaces disagree about almost nothing else, but they disagree about
 * this: the object API answers "what does this alias stand for" with
 * `getAliasedSymbol`, while the snapshot/handle API has no such call and must go
 * through `getDeclaredTypeOfSymbol(alias).getSymbol()`. That one difference is
 * where `verify:types` broke when it was ported — the first handle adapter used
 * `Symbol.getExportSymbol()`, which returns the alias *itself*, so a leaked type
 * was reported on 6.0.3 and silently passed on 7.0.2 while both trees printed
 * `surface closed` (docs/progress.md Phase 330).
 *
 * What is shared, and therefore what lives here, is everything around that
 * answer: where the loop starts, when it stops, and what it returns when there is
 * nothing to follow. Keeping two copies of *that* is how the two backends would
 * drift apart in a way only a mutation would reveal.
 *
 * @template T
 * @param {T | null | undefined} symbol
 * @param {{
 *   isAlias: (symbol: T) => boolean,
 *   follow: (symbol: T) => T | null | undefined,
 *   maxHops?: number
 * }} options
 * @returns {T | null}
 */
export function followAlias(symbol, { isAlias, follow, maxHops = 16 }) {
  let current = symbol ?? null;
  for (let hops = 0; current && isAlias(current) && hops < maxHops; hops += 1) {
    const following = follow(current);
    // A null answer means this alias has no target this API can name; a
    // self-answer would loop forever. Both end the walk rather than decide it.
    if (!following || following === current) break;
    current = following;
  }
  return current ?? null;
}
