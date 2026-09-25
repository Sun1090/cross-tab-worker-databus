/**
 * Derives a stable 128-bit hex key from a string.
 *
 * This is a non-cryptographic four-way hash (inspired by MurmurHash-style
 * mixing). It exists so no *derived identifier* — a localStorage key, a route
 * record key, a BroadcastChannel or cluster name — is built from a connection
 * URL or a topic plaintext. That is all it bounds, and it is not
 * confidentiality: a `CONTROL` frame carries the plaintext `topic` beside its
 * `topicKey` (see `types.ts`), and under `channelFallback: 'storage-event'`
 * whole frames, plaintext included, are written into localStorage. What the
 * receiver acts on is the pair, guarded by the key/plaintext check documented in
 * `AGENTS.md`'s BroadcastChannel protocol section. It trades collision
 * resistance for speed and zero dependencies: use `crypto.subtle.digest` if you
 * need a cryptographic hash.
 */
export function createOpaqueKey(value: string): string {
  // Four independent lanes mix the input so a short value still diffuses
  // across all 128 bits rather than only exercising the low bits. Each lane
  // starts from a distinct 32-bit seed XORed with the length so that strings
  // of different lengths diverge from the first mix step.
  let h1 = SEED_H1 ^ value.length;
  let h2 = SEED_H2 ^ value.length;
  let h3 = SEED_H3 ^ value.length;
  let h4 = SEED_H4 ^ value.length;

  // Feed every UTF-16 code unit into all four lanes with the four distinct odd
  // multipliers below. Oddness is the property the mixing needs — see the note
  // on `PRIME_H1`, which also records that the name is not a claim: one of the
  // four is composite.
  // Note: this operates on UTF-16 code units, so astral-plane characters (emoji,
  // rare CJK) are hashed as surrogate pairs — consistent within a process, but
  // not Unicode-normalized. Callers should normalize the topic string beforehand
  // if cross-normalization-form stability is required.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, PRIME_H1);
    h2 = Math.imul(h2 ^ code, PRIME_H2);
    h3 = Math.imul(h3 ^ code, PRIME_H3);
    h4 = Math.imul(h4 ^ code, PRIME_H4);
  }

  // Final avalanche: cross-mix the lanes so nearby inputs produce distant keys,
  // avoiding the clustering a naive sum would exhibit in storage prefixes.
  h1 = avalancheMix(h1, h2);
  h2 = avalancheMix(h2, h3);
  h3 = avalancheMix(h3, h4);
  h4 = avalancheMix(h4, h1);

  return [h1, h2, h3, h4].map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Distinct 32-bit seeds for the four hash lanes. */
const SEED_H1 = 0xdeadbeef;
const SEED_H2 = 0x41c6ce57;
const SEED_H3 = 0xc0decafe;
const SEED_H4 = 0x9e3779b9;

/** Distinct odd 32-bit multipliers for the four per-character mix steps.
 * Oddness — coprimality with 2^32 — is what makes a `Math.imul` multiply a
 * bijection, so it is the property that matters here; primality is not required
 * and only H1, H3 and H4 happen to be prime (H2 = 929 × 1_719_413). Do not
 * "correct" a value to a prime: the digest keys records already in localStorage. */
const PRIME_H1 = 2_654_435_761;
const PRIME_H2 = 1_597_334_677;
const PRIME_H3 = 2_246_822_519;
const PRIME_H4 = 3_266_489_917;

/** Final avalanche constant pair. Each lane is mixed with itself (shifted)
 * and XORed with a neighbor lane (shifted) to cross-diffuse the lanes.
 * Neither value is prime, whatever the first name says: 2_246_822_507 =
 * 15809 × 142123 and 3_266_489_909 = 1223 × 2670883. Both are odd, and that is
 * the property `Math.imul` needs for the multiply to be a bijection on 32 bits.
 * Do not "correct" either number towards a prime: the digest keys route and
 * worker records already in localStorage. */
const AVALANCHE_PRIME = 2_246_822_507;
const AVALANCHE_CROSS = 3_266_489_909;

/** One step of the final avalanche: mix `self` with a shift and an odd
 * multiplier, then XOR with a cross-mix of `neighbor` (also shifted and
 * multiplied by its own odd constant) so a change in any lane propagates to the
 * others. The 16/13 shifts spread bits across the 32-bit word before the odd
 * multiplier mixes them across it. Neither multiplier is prime — see
 * `AVALANCHE_PRIME` for the factorizations and for why the values stay as they
 * are. */
function avalancheMix(self: number, neighbor: number): number {
  return (
    Math.imul(self ^ (self >>> 16), AVALANCHE_PRIME) ^
    Math.imul(neighbor ^ (neighbor >>> 13), AVALANCHE_CROSS)
  );
}
