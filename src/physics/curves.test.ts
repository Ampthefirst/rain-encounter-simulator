import { describe, expect, it } from 'vitest';
import {
  angleSamples,
  hitsGrid,
  hitsVsAngle,
  hitsVsSpeed,
  linspace,
  optimumRidge,
  rateVsSpeed,
  speedSamples,
} from './curves';
import { DEFAULTS, derive, hitRates, totalHits, type Params } from './physics';

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULTS, ...over });

describe('sampling', () => {
  it('linspace includes both ends', () => {
    expect(linspace(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('includes the drift speed exactly when it is in range', () => {
    const p = with_({ thetaDeg: 20 });
    const wx = derive(p).wx;
    const xs = speedSamples(p, 0.3, 12, 50);
    expect(xs).toContain(wx);
    expect(xs).toHaveLength(51);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // No drift in vertical rain or a headwind, so nothing extra.
    expect(speedSamples(DEFAULTS, 0.3, 12, 50)).toHaveLength(50);
    expect(speedSamples(with_({ thetaDeg: -20 }), 0.3, 12, 50)).toHaveLength(50);
  });

  it('includes the angle at which the drift matches the current speed', () => {
    const xs = angleSamples(DEFAULTS, -60, 60, 61);
    const kink = xs.find((a) => !Number.isInteger(a / 2))!;
    expect(derive(with_({ thetaDeg: kink })).wx).toBeCloseTo(DEFAULTS.s, 10);
  });
});

describe('sweeps', () => {
  it('hitsVsSpeed matches totalHits point by point and stacks to the total', () => {
    const p = with_({ thetaDeg: 20, phiDeg: 30 });
    const speeds = [1.4, 3, 6, 10];
    const sw = hitsVsSpeed(p, speeds);
    speeds.forEach((s, i) => {
      const t = totalHits({ ...p, s });
      expect(sw.total[i]).toBeCloseTo(t.total, 8);
      expect(sw.top[i]! + sw.front[i]! + sw.back[i]! + sw.side[i]!).toBeCloseTo(t.total, 8);
    });
  });

  it('reproduces the spec reference values', () => {
    const sw = hitsVsSpeed(DEFAULTS, [1.4, 3, 6, 10]);
    [14783, 11625, 10243, 9691].forEach((N, i) => expect(Math.abs(sw.total[i]! - N)).toBeLessThan(1));
  });

  it('rateVsSpeed rises with speed while hitsVsSpeed falls (vertical rain)', () => {
    const speeds = linspace(0.3, 12, 20);
    const rate = rateVsSpeed(DEFAULTS, speeds).total;
    const hits = hitsVsSpeed(DEFAULTS, speeds).total;
    for (let i = 1; i < speeds.length; i++) {
      expect(rate[i]!).toBeGreaterThan(rate[i - 1]!);
      expect(hits[i]!).toBeLessThan(hits[i - 1]!);
    }
    expect(rate[0]).toBeCloseTo(hitRates(with_({ s: 0.3 })).total, 10);
  });

  it('hitsVsAngle matches the reference values at ±20°', () => {
    const sw = hitsVsAngle(DEFAULTS, [-20, 0, 20]);
    expect(Math.abs(sw.total[0]! - 18665)).toBeLessThan(1);
    expect(Math.abs(sw.total[1]! - 11625)).toBeLessThan(1);
    expect(Math.abs(sw.total[2]! - 4585)).toBeLessThan(1);
  });
});

describe('heatmap grid', () => {
  const speeds = [1.4, 3, 6, 10];
  const angles = [-20, 0, 20];
  const grid = hitsGrid(DEFAULTS, speeds, angles);

  it('is laid out angle by speed', () => {
    expect(grid.values).toHaveLength(12);
    expect(Math.abs(grid.values[0 * 4 + 0]! - 29868)).toBeLessThan(1);
    expect(Math.abs(grid.values[1 * 4 + 1]! - 11625)).toBeLessThan(1);
    expect(Math.abs(grid.values[2 * 4 + 3]! - 7579)).toBeLessThan(1);
  });

  it('reports its range', () => {
    expect(grid.min).toBe(Math.min(...grid.values));
    expect(grid.max).toBe(Math.max(...grid.values));
  });
});

describe('optimum ridge', () => {
  it('exists only for tailwinds strong enough, and sits at the drift speed', () => {
    const ridge = optimumRidge(DEFAULTS, linspace(-60, 60, 121));
    expect(ridge.length).toBeGreaterThan(0);
    // Threshold is tan θ > A_top / A_front, i.e. θ > 8.13°.
    expect(Math.min(...ridge.map((r) => r.thetaDeg))).toBe(9);
    for (const r of ridge) {
      expect(r.speed).toBeCloseTo(derive(with_({ thetaDeg: r.thetaDeg })).wx, 10);
    }
  });
});
