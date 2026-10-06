import { describe, expect, it } from 'vitest';
import { createRng, poisson } from './rng';

describe('createRng (sfc32)', () => {
  it('is reproducible for a seed and differs between seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
  });

  it('is uniform on [0, 1)', () => {
    const rng = createRng(1);
    const N = 200_000;
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i++) {
      const u = rng();
      min = Math.min(min, u);
      max = Math.max(max, u);
      sum += u;
      sumSq += u * u;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    const mean = sum / N;
    expect(mean).toBeCloseTo(0.5, 2);
    expect(sumSq / N - mean ** 2).toBeCloseTo(1 / 12, 2);
  });
});

describe('poisson', () => {
  // Means either side of the chunk size, including a non-integer one.
  it.each([0.3, 4, 30, 47.5, 1000])('has mean and variance %d', (lambda) => {
    const rng = createRng(7);
    const N = 40_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const k = poisson(rng, lambda);
      sum += k;
      sumSq += k * k;
    }
    const mean = sum / N;
    const variance = sumSq / N - mean ** 2;
    // Standard error of the mean is sqrt(lambda / N); allow 5 of them.
    expect(Math.abs(mean - lambda)).toBeLessThan(5 * Math.sqrt(lambda / N));
    expect(variance / lambda).toBeGreaterThan(0.95);
    expect(variance / lambda).toBeLessThan(1.05);
  });

  it('returns 0 for a zero mean', () => {
    expect(poisson(createRng(1), 0)).toBe(0);
  });
});
