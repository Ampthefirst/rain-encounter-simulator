import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, derive, faceRate, type Params } from '../physics/physics';
import { FACE_IDS, Simulation, runTrial, runTrials, segmentBoxEntry, type Box, type SimOptions } from './simulation';

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULTS, ...over });

/** Analytic expected hits per face over the trip, straight from the flux formula. */
function expected(p: Params) {
  const { n, vRel, T, body } = derive(p);
  const out = { top: 0, front: 0, back: 0, left: 0, right: 0, total: 0 };
  for (const face of body.faces) {
    const hits = faceRate(n, vRel, face) * T;
    out[face.id] = hits;
    out.total += hits;
  }
  return out;
}

const TOLERANCE = 0.02;

/** Mean of seeded trials must be within 2% of the analytic value, per face and in total. */
function expectAgreement(p: Params, trials: number, options: SimOptions = {}) {
  const want = expected(p);
  const got = runTrials(p, trials, { seed: 12345, ...options }).mean;
  for (const key of [...FACE_IDS, 'total'] as const) {
    if (want[key] === 0) {
      expect(got[key], `${key} should be dry`).toBe(0);
    } else {
      const error = got[key] / want[key] - 1;
      expect(Math.abs(error), `${key}: simulated ${got[key].toFixed(1)}, analytic ${want[key].toFixed(1)}`).toBeLessThan(
        TOLERANCE,
      );
    }
  }
  return { want, got };
}

// Trips of about 10 s keep each trial cheap while every wet face still
// collects several hundred hits per trial.
const TRIALS = 300;
const driftSpeed = derive(with_({ thetaDeg: 20 })).wx;

describe('simulation agrees with the analytic model', () => {
  it('vertical rain', () => {
    const { want } = expectAgreement(with_({ s: 3, D: 30 }), TRIALS);
    expect(want.back).toBe(0);
    expect(want.left + want.right).toBe(0);
  });

  it('headwind', () => {
    expectAgreement(with_({ thetaDeg: -20, s: 3, D: 30 }), TRIALS);
  });

  it('tailwind, person slower than the drift (rain hits the back)', () => {
    const { want } = expectAgreement(with_({ thetaDeg: 20, s: 1.4, D: 14 }), TRIALS);
    expect(want.back).toBeGreaterThan(0);
    expect(want.front).toBe(0);
  });

  it('tailwind, person at the drift speed (top only)', () => {
    const { want, got } = expectAgreement(with_({ thetaDeg: 20, s: driftSpeed, D: driftSpeed * 10 }), TRIALS);
    expect(want.front).toBe(0);
    expect(want.back).toBe(0);
    expect(got.total).toBe(got.top);
  });

  it('tailwind, person faster than the drift (rain hits the front)', () => {
    const { want } = expectAgreement(with_({ thetaDeg: 20, s: 6, D: 60 }), TRIALS);
    expect(want.front).toBeGreaterThan(0);
    expect(want.back).toBe(0);
  });

  it('crosswind with a tailwind component (right side wet)', () => {
    const { want } = expectAgreement(with_({ thetaDeg: 20, phiDeg: 60, s: 3, D: 30 }), TRIALS);
    expect(want.right).toBeGreaterThan(0);
    expect(want.left).toBe(0);
  });

  it('crosswind from the other side with a headwind component (left side wet)', () => {
    const { want } = expectAgreement(with_({ thetaDeg: -30, phiDeg: 60, s: 3, D: 30 }), TRIALS);
    expect(want.left).toBeGreaterThan(0);
    expect(want.right).toBe(0);
  });

  it('sprinting into heavy slanted rain', () => {
    expectAgreement(with_({ thetaDeg: -45, s: 9, D: 45, R: 20 }), TRIALS);
  });

  it('a trip time that is not a whole number of steps', () => {
    const p = with_({ s: 3, D: 30.1 });
    const sim = new Simulation(p, { seed: 1 });
    sim.runToEnd();
    expect(sim.time).toBeCloseTo(derive(p).T, 12);
    expectAgreement(p, TRIALS);
  });
});

describe('timestep independence', () => {
  const p = with_({ thetaDeg: -20, s: 3, D: 30 });

  it('halving dt does not change the mean', () => {
    const coarse = runTrials(p, 400, { seed: 1, dt: 1 / 60 }).mean;
    const fine = runTrials(p, 400, { seed: 2, dt: 1 / 120 }).mean;
    for (const key of ['top', 'front', 'total'] as const) {
      expect(Math.abs(fine[key] / coarse[key] - 1), key).toBeLessThan(0.01);
    }
  });

  it('still agrees when drops move further per step than the person is deep', () => {
    // At dt = 0.1 s a drop falls 0.65 m and moves 0.54 m horizontally per
    // step, so testing end points alone would tunnel through the 0.25 m box.
    expectAgreement(p, TRIALS, { dt: 0.1 });
  });

  it('gives the same count however the elapsed time is chopped up', () => {
    const steady = runTrial(p, { seed: 99 });

    const sim = new Simulation(p, { seed: 99 });
    const frames = [0.004, 0.031, 0.0166, 0.25, 0.0001, 0.0166, 1.7];
    for (let i = 0; !sim.done; i++) sim.advance(frames[i % frames.length]!);
    expect(sim.hits).toEqual(steady);
  });
});

describe('statistics and reproducibility', () => {
  const p = with_({ s: 3, D: 30 });

  it('is reproducible for a seed and varies between seeds', () => {
    expect(runTrial(p, { seed: 5 })).toEqual(runTrial(p, { seed: 5 }));
    expect(runTrial(p, { seed: 5 }).total).not.toBe(runTrial(p, { seed: 6 }).total);
  });

  it('produces Poisson scatter: variance of the total ≈ its mean', () => {
    const { mean, sd } = runTrials(p, 500, { seed: 3 });
    const ratio = sd.total ** 2 / mean.total;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('starts with a Poisson-distributed number of drops at the right density', () => {
    let sum = 0;
    let sumSq = 0;
    const N = 2000;
    let volume = 0;
    for (let seed = 0; seed < N; seed++) {
      const sim = new Simulation(p, { seed });
      const d = sim.domain;
      const b = sim.box;
      volume =
        (d.maxX - d.minX) * (d.maxY - d.minY) * (d.maxZ - d.minZ) -
        (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ);
      sum += sim.count;
      sumSq += sim.count ** 2;
    }
    const mean = sum / N;
    const want = derive(p).n * volume;
    expect(Math.abs(mean / want - 1)).toBeLessThan(0.02);
    expect((sumSq / N - mean ** 2) / mean).toBeGreaterThan(0.85);
    expect((sumSq / N - mean ** 2) / mean).toBeLessThan(1.15);
  });

  it('keeps the density uniform through a run', () => {
    // Count drops in the upstream half of the domain above the person, a
    // region no shadow can reach, at the end of many runs.
    let inRegion = 0;
    let regionVolume = 0;
    const runs = 300;
    for (let seed = 0; seed < runs; seed++) {
      const sim = new Simulation(p, { seed });
      sim.runToEnd();
      const d = sim.domain;
      const z0 = sim.box.maxZ;
      regionVolume = (d.maxX - d.minX) * (d.maxY - d.minY) * (d.maxZ - z0);
      for (let i = 0; i < sim.count; i++) {
        if (sim.positions[3 * i + 2]! > z0) inRegion++;
      }
    }
    expect(Math.abs(inRegion / runs / (derive(p).n * regionVolume) - 1)).toBeLessThan(0.02);
  });
});

describe('extreme densities', () => {
  // Fine drizzle-sized drops at a downpour rate: about 210,000 drops per m³.
  const p = with_({ d: 0.5, R: 100, s: 3, D: 15 });

  it('thins the rain to the drop budget and still agrees', () => {
    const sim = new Simulation(p, { maxDrops: 2000 });
    expect(derive(p).n).toBeGreaterThan(200_000);
    expect(sim.weight).toBeGreaterThan(50);
    expect(sim.count).toBeLessThan(2400);
    expectAgreement(p, TRIALS, { maxDrops: 2000 });
  });

  it('does not thin when the rain fits the budget', () => {
    expect(new Simulation(DEFAULTS).weight).toBe(1);
  });
});

describe('swept collision', () => {
  const box: Box = { minX: -0.125, maxX: 0.125, minY: -0.25, maxY: 0.25, minZ: 0, maxZ: 1.75 };
  const face = (i: number) => (i < 0 ? null : FACE_IDS[i]);

  it('reports the face entered', () => {
    expect(face(segmentBoxEntry(0, 0, 2, 0, 0, -0.5, box))).toBe('top');
    expect(face(segmentBoxEntry(0.3, 0, 1, -0.3, 0, -0.1, box))).toBe('front');
    expect(face(segmentBoxEntry(-0.3, 0, 1, 0.3, 0, -0.1, box))).toBe('back');
    expect(face(segmentBoxEntry(0, 0.4, 1, 0, -0.3, -0.1, box))).toBe('left');
    expect(face(segmentBoxEntry(0, -0.4, 1, 0, 0.3, -0.1, box))).toBe('right');
  });

  it('catches a drop that passes clean through within one step', () => {
    // Starts in front of the box and ends behind it; neither end is inside.
    expect(face(segmentBoxEntry(0.4, 0, 1, -0.8, 0, -0.1, box))).toBe('front');
    // Clips the top front edge: in through the top, out through the front... reversed in time.
    expect(face(segmentBoxEntry(0.2, 0, 1.8, -0.2, 0, -0.2, box))).toBe('front');
    expect(face(segmentBoxEntry(0.1, 0, 1.85, -0.2, 0, -0.2, box))).toBe('top');
  });

  it('misses when the segment stops short, passes beside, or starts inside', () => {
    expect(face(segmentBoxEntry(0, 0, 2.5, 0, 0, -0.5, box))).toBeNull();
    expect(face(segmentBoxEntry(0.5, 0, 1, 0, 0, -0.5, box))).toBeNull();
    expect(face(segmentBoxEntry(0.3, 0.3, 1, -0.6, 0, -0.1, box))).toBeNull();
    expect(face(segmentBoxEntry(0, 0, 1, -0.1, 0, -0.1, box))).toBeNull();
  });
});

describe('hit events', () => {
  it('reports each hit once, at a point on the face it names', () => {
    const p = with_({ thetaDeg: -30, phiDeg: 60, s: 3, D: 15 });
    const sim = new Simulation(p, { seed: 11 });
    const { box } = sim;
    const seen = [0, 0, 0, 0, 0];
    sim.onHit = (face, x, y, z) => {
      seen[face]!++;
      const eps = 1e-9;
      expect(x).toBeGreaterThanOrEqual(box.minX - eps);
      expect(x).toBeLessThanOrEqual(box.maxX + eps);
      expect(y).toBeGreaterThanOrEqual(box.minY - eps);
      expect(y).toBeLessThanOrEqual(box.maxY + eps);
      expect(z).toBeGreaterThanOrEqual(box.minZ - eps);
      expect(z).toBeLessThanOrEqual(box.maxZ + eps);
      const onFace = [z - box.maxZ, x - box.maxX, x - box.minX, y - box.maxY, y - box.minY][face]!;
      expect(Math.abs(onFace)).toBeLessThan(eps);
    };
    const hits = sim.runToEnd();
    expect(seen).toEqual([hits.top, hits.front, hits.back, hits.left, hits.right]);
    expect(hits.total).toBeGreaterThan(1000);
  });
});

describe('independence from the analytic answer', () => {
  it('imports only derive() and types from the physics module', () => {
    const source = readFileSync(new URL('./simulation.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/import \{ derive, type FaceId, type Params, type Vec3 \} from '\.\.\/physics\/physics'/);
    expect(source).not.toMatch(/\b(hitRates|totalHits|optimumSpeed|faceRate|vsWalking)\b/);
  });
});
