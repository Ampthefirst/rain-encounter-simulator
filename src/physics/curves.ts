// Sampled curves and grids for the analytic charts. Pure and DOM-free; every
// value comes from the equations in physics.ts.

import {
  derive,
  hitRates,
  optimumSpeed,
  totalHits,
  type FaceBreakdown,
  type Params,
} from './physics';

export const FACE_KEYS = ['top', 'front', 'back', 'side'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];

/** A sweep of one parameter: x values and the per-face breakdown at each. */
export interface Sweep {
  x: number[];
  top: number[];
  front: number[];
  back: number[];
  side: number[];
  total: number[];
}

/** n evenly spaced values from a to b inclusive. */
export function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/** Evenly spaced samples plus any of `extra` that fall strictly inside the range, sorted. */
function samplesWith(min: number, max: number, n: number, extra: number[]): number[] {
  const xs = linspace(min, max, n);
  for (const e of extra) {
    if (e > min && e < max && !xs.includes(e)) xs.push(e);
  }
  return xs.sort((p, q) => p - q);
}

function sweep(xs: number[], at: (x: number) => FaceBreakdown): Sweep {
  const out: Sweep = { x: xs, top: [], front: [], back: [], side: [], total: [] };
  for (const x of xs) {
    const v = at(x);
    out.top.push(v.top);
    out.front.push(v.front);
    out.back.push(v.back);
    out.side.push(v.side);
    out.total.push(v.total);
  }
  return out;
}

/**
 * Speeds to sample between min and max. The curves have a kink where the
 * person matches the rain's drift, so that speed is included exactly.
 */
export function speedSamples(p: Params, min: number, max: number, n: number): number[] {
  return samplesWith(min, max, n, [derive(p).wx]);
}

/**
 * Angles (degrees) to sample between min and max, including the angle at
 * which the rain's drift along the path equals the person's speed.
 */
export function angleSamples(p: Params, min: number, max: number, n: number): number[] {
  const { vt } = derive(p);
  const along = vt * Math.cos((p.phiDeg * Math.PI) / 180);
  const kink = along > 0 ? (Math.atan(p.s / along) * 180) / Math.PI : NaN;
  return samplesWith(min, max, n, [kink]);
}

/** Total hits over the trip at each speed. */
export function hitsVsSpeed(p: Params, speeds: number[]): Sweep {
  return sweep(speeds, (s) => totalHits({ ...p, s }));
}

/** Hit rate in drops per second at each speed. */
export function rateVsSpeed(p: Params, speeds: number[]): Sweep {
  return sweep(speeds, (s) => hitRates({ ...p, s }));
}

/** Total hits over the trip at each rain angle (degrees), at the current speed. */
export function hitsVsAngle(p: Params, angles: number[]): Sweep {
  return sweep(angles, (thetaDeg) => totalHits({ ...p, thetaDeg }));
}

export interface HitsGrid {
  speeds: number[];
  angles: number[];
  /** Total hits, row-major: values[j * speeds.length + i] is angle j, speed i. */
  values: Float64Array;
  min: number;
  max: number;
}

/** Total hits over a speed × angle grid. */
export function hitsGrid(p: Params, speeds: number[], angles: number[]): HitsGrid {
  const values = new Float64Array(speeds.length * angles.length);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < angles.length; j++) {
    for (let i = 0; i < speeds.length; i++) {
      const N = totalHits({ ...p, s: speeds[i]!, thetaDeg: angles[j]! }).total;
      values[j * speeds.length + i] = N;
      if (N < min) min = N;
      if (N > max) max = N;
    }
  }
  return { speeds, angles, values, min, max };
}

export interface RidgePoint {
  thetaDeg: number;
  speed: number;
}

/**
 * The optimum speed at each angle, for the angles that have one (a tailwind
 * strong enough that matching the drift beats going faster).
 */
export function optimumRidge(p: Params, angles: number[]): RidgePoint[] {
  const ridge: RidgePoint[] = [];
  for (const thetaDeg of angles) {
    const opt = optimumSpeed({ ...p, thetaDeg });
    if (opt.kind === 'match-drift') ridge.push({ thetaDeg, speed: opt.speed });
  }
  return ridge;
}
