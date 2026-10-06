import { describe, expect, it } from 'vitest';
import { DEFAULTS, derive, faceRate, type Params } from '../physics/physics';
import { planBatch } from './batch';
import { Simulation, runTrials } from './simulation';

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULTS, ...over });

function expectedTotal(p: Params): number {
  const { n, vRel, T, body } = derive(p);
  return body.faces.reduce((sum, face) => sum + faceRate(n, vRel, face) * T, 0);
}

describe('batch plan', () => {
  it('does not thin an ordinary trip', () => {
    const plan = planBatch(DEFAULTS, 100);
    expect(plan.weight).toBe(1);
    expect(plan.options.margin).toBe(0);
    expect(new Simulation(DEFAULTS, plan.options).weight).toBe(1);
  });

  it('thins a very long trip in dense rain, and the simulation uses that weight', () => {
    const p = with_({ D: 1000, s: 0.3, R: 100, d: 0.5 });
    const plan = planBatch(p, 100);
    expect(plan.weight).toBeGreaterThan(100);
    expect(new Simulation(p, plan.options).weight).toBeCloseTo(plan.weight, 6);
  });

  // The fast settings (no spare margin, coarse step) must count the same as the defaults.
  it.each([
    ['vertical rain', with_({ s: 3, D: 30 })],
    ['headwind with crosswind', with_({ thetaDeg: -30, phiDeg: 60, s: 3, D: 30 })],
    ['tailwind faster than the person', with_({ thetaDeg: 20, s: 1.4, D: 14 })],
  ])('fast settings still agree with the analytic total: %s', (_name, p) => {
    const plan = planBatch(p, 300);
    const want = expectedTotal(p);
    const got = runTrials(p, 300, { seed: 2468, ...plan.options }).mean.total;
    expect(Math.abs(got / want - 1)).toBeLessThan(0.02);
  });

  it('thinned batch still agrees', () => {
    const p = with_({ D: 60, s: 3, R: 100, d: 0.5 });
    const plan = planBatch(p, 200, 2e7);
    expect(plan.weight).toBeGreaterThan(5);
    const want = expectedTotal(p);
    const got = runTrials(p, 200, { seed: 1357, ...plan.options }).mean.total;
    expect(Math.abs(got / want - 1)).toBeLessThan(0.02);
  });
});
