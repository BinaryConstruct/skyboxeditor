/**
 * MSVC CRT `rand()`/`srand()` (LCG), as used by the original Spacescape.exe.
 *
 * All layer determinism in Spacescape (Perlin permutation tables, star
 * placement, star colors) flows from this exact sequence, so reproducing it
 * bit-for-bit is what lets legacy .xml save files regenerate the same skies.
 *
 * state' = state * 214013 + 2531011 (mod 2^32); rand() = (state' >> 16) & 0x7fff
 */
export const RAND_MAX = 32767;

export class MsvcRng {
  private state: number;

  constructor(seed = 0) {
    this.state = seed >>> 0;
  }

  srand(seed: number): void {
    this.state = seed >>> 0;
  }

  /** C `rand()`: integer in [0, RAND_MAX]. */
  rand(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** The common C idiom `rand() / (double)RAND_MAX`: [0, 1] inclusive. */
  unit(): number {
    return this.rand() / RAND_MAX;
  }
}
