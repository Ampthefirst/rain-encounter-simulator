/** Uniform random numbers in [0, 1). */
export type Rng = () => number;

/**
 * Seedable generator (sfc32). Same seed, same sequence.
 *
 * The simpler mulberry32 is not good enough here: fed through poisson() it
 * gives means about 0.03% low, which shows up as a simulation that
 * consistently undercounts.
 */
export function createRng(seed: number): Rng {
  // Spread the seed over the state with splitmix32.
  let s = seed >>> 0;
  const mix = () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) | 0;
  };
  let a = mix();
  let b = mix();
  let c = mix();
  let d = 1;

  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

/** A fresh 32-bit seed drawn from rng, for giving each trial its own stream. */
export function nextSeed(rng: Rng): number {
  return Math.floor(rng() * 4294967296);
}

// Knuth's method is exact but needs exp(-mean), which underflows for large
// means, so a large mean is split into chunks: a sum of independent Poisson
// variables is Poisson with the summed mean.
const POISSON_CHUNK = 30;

/** Exact Poisson sample with the given mean. */
export function poisson(rng: Rng, mean: number): number {
  let k = 0;
  let remaining = mean;
  while (remaining > 0) {
    const lambda = Math.min(remaining, POISSON_CHUNK);
    remaining -= lambda;
    const limit = Math.exp(-lambda);
    let p = rng();
    while (p > limit) {
      k++;
      p *= rng();
    }
  }
  return k;
}
