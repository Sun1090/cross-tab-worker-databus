/**
 * The alias-chain walk shared by both `verify:types` backends.
 *
 * This loop is the one place the two compiler surfaces had to agree and did not:
 * the handle adapter's first `follow` returned the alias itself
 * (`Symbol.getExportSymbol()`), so the walk terminated immediately and the
 * closure check missed a deliberately leaked type on TypeScript 7 while catching
 * it on 6.0.3 (docs/progress.md Phase 330).
 *
 * The bug was in `follow`, not here — which is exactly why the surrounding
 * semantics are pinned: if the two adapters ever grow their own copies of "where
 * to start, when to stop, what to return", a mutation on one backend can stop
 * being caught by the other, and no clean run would show it.
 */
import { describe, expect, it } from 'vitest';
import { followAlias } from '../scripts/alias-chain.mjs';

/** A stand-in for either compiler's symbol: an id plus the target it aliases. */
function chain(...targets: (number | null)[]) {
  const nodes = targets.map((target, index) => ({ id: index, target }));
  return {
    nodes,
    isAlias: (node: (typeof nodes)[number]) => node.target !== null,
    follow: (node: (typeof nodes)[number]) =>
      node.target === null ? null : (nodes[node.target] ?? null)
  };
}

describe('followAlias', () => {
  it('returns the symbol itself when it is not an alias', () => {
    const { nodes, ...options } = chain(1);
    expect(followAlias(nodes[0], options)).toBe(nodes[0]);
  });

  it('crosses a single alias to its target', () => {
    const { nodes, ...options } = chain(1, null);
    expect(followAlias(nodes[0], options)).toBe(nodes[1]);
  });

  it('crosses a chain of aliases', () => {
    const { nodes, ...options } = chain(1, 2, null);
    expect(followAlias(nodes[0], options)).toBe(nodes[2]);
  });

  it('stops when the alias has no target this API can name', () => {
    // The shape that made the port fail: `follow` answering with the alias
    // itself is a self-answer, not a target.
    const { nodes, ...options } = chain(null);
    expect(followAlias(nodes[0], options)).toBe(nodes[0]);
  });

  it('stops on a self-answer instead of looping', () => {
    const node = { id: 0 };
    const result = followAlias(node, { isAlias: () => true, follow: () => node });
    expect(result).toBe(node);
  });

  it('caps the hops, so a cycle returns rather than recursing forever', () => {
    // An endless alias chain: every answer is a fresh alias. The cap is what
    // turns that into a return value; this walk runs inside a recursive descent,
    // so an uncapped cycle would be a stack overflow rather than a wrong answer.
    let hops = 0;
    const result = followAlias(
      { id: 0 },
      {
        isAlias: () => true,
        follow: () => ({ id: (hops += 1) }),
        maxHops: 3
      }
    );
    expect(hops).toBe(3);
    expect(result).toEqual({ id: 3 });
  });

  it('returns null for a symbol it was never given', () => {
    const { ...options } = chain(1, null);
    expect(followAlias(undefined, options)).toBeNull();
    expect(followAlias(null, options)).toBeNull();
  });

  it('treats a follow that returns nothing as the end of the chain', () => {
    const node = { id: 0 };
    expect(followAlias(node, { isAlias: () => true, follow: () => null })).toBe(node);
    expect(followAlias(node, { isAlias: () => true, follow: () => undefined })).toBe(node);
  });
});
