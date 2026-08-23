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
  // across all 128 bits rather than only exercising the low bits.
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  let h3 = 0xc0decafe ^ value.length;
  let h4 = 0x9e3779b9 ^ value.length;

  // Feed every code unit into all four lanes with distinct large primes.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
    h3 = Math.imul(h3 ^ code, 2_246_822_519);
    h4 = Math.imul(h4 ^ code, 3_266_489_917);
  }

  // Final avalanche: cross-mix the lanes so nearby inputs produce distant keys,
  // avoiding the clustering a naive sum would exhibit in storage prefixes.
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h3 ^ (h3 >>> 13), 3_266_489_909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2_246_822_507) ^ Math.imul(h4 ^ (h4 >>> 13), 3_266_489_909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);

  return [h1, h2, h3, h4].map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}
