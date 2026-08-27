/**
 * Derives a stable 128-bit hex key from a string.
 *
 * This is a non-cryptographic four-way hash (inspired by MurmurHash-style
 * mixing). It exists so connection URLs and topic plaintext never touch
 * localStorage or BroadcastChannel namespaces — consumers only ever see the
 * opaque key. It trades collision resistance for speed and zero dependencies:
 * use `crypto.subtle.digest` if you need a cryptographic hash.
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

  // Feed every UTF-16 code unit into all four lanes with distinct large primes.
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

/** Distinct large primes for the four per-character mix steps. */
const PRIME_H1 = 2_654_435_761;
const PRIME_H2 = 1_597_334_677;
const PRIME_H3 = 2_246_822_519;
const PRIME_H4 = 3_266_489_917;

/** Final avalanche constant pair. Each lane is mixed with itself (shifted)
 * and XORed with a neighbor lane (shifted) to cross-diffuse the lanes. */
const AVALANCHE_PRIME = 2_246_822_507;
const AVALANCHE_CROSS = 3_266_489_909;

/** One step of the final avalanche: mix `self` with a shift and prime, then
 * XOR with a cross-mix of `neighbor` (also shifted and primed) so a change
 * in any lane propagates to the others. The 16/13 shifts spread bits across
 * the 32-bit word before the prime multiply scrambles them further. */
function avalancheMix(self: number, neighbor: number): number {
  return (
    Math.imul(self ^ (self >>> 16), AVALANCHE_PRIME) ^
    Math.imul(neighbor ^ (neighbor >>> 13), AVALANCHE_CROSS)
  );
}
