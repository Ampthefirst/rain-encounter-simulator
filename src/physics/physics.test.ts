import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  RANGES,
  autoFallSpeed,
  boxBody,
  derive,
  hitRates,
  msToKmh,
  msToMph,
  optimumSpeed,
  speedFromTime,
  totalHits,
  vsWalking,
  type Params,
} from './physics';

const with_ = (over: Partial<Params>): Params => ({ ...DEFAULTS, ...over });

function expectWithin(actual: number, expected: number, tol: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected} ± ${tol}`).toBeLessThanOrEqual(tol);
}

describe('derived quantities at defaults', () => {
  const d = derive(DEFAULTS);

  it('matches the spec reference values', () => {
    expectWithin(d.vt, 6.55, 0.005);
    expectWithin(d.n, 101.3, 0.05);
    expectWithin(d.spacing, 0.215, 0.0005);
  });

  it('computes drop volume, trip time and relative velocity', () => {
    expect(d.dropVolume).toBeCloseTo((Math.PI * 0.002 ** 3) / 6, 15);
    expect(d.T).toBeCloseTo(100 / 3, 10);
    expect(d.vRel[0]).toBeCloseTo(-3, 12);
    expect(d.vRel[1]).toBeCloseTo(0, 12);
    expect(d.vRel[2]).toBeCloseTo(-d.vt, 12);
  });

  it('recovers the rainfall rate from n, drop volume and fall speed', () => {
    expect(d.n * d.dropVolume * d.vt * 1000 * 3600).toBeCloseTo(DEFAULTS.R, 10);
  });

  it('gives the box its face areas', () => {
    const area = Object.fromEntries(boxBody(1.75, 0.5, 0.25).faces.map((f) => [f.id, f.area]));
    expect(area.top).toBeCloseTo(0.125, 12);
    expect(area.front).toBeCloseTo(0.875, 12);
    expect(area.back).toBeCloseTo(0.875, 12);
    expect(area.left).toBeCloseTo(0.4375, 12);
    expect(area.right).toBeCloseTo(0.4375, 12);
  });
});

describe('fall speed', () => {
  it('follows the Atlas fit', () => {
    expect(autoFallSpeed(2)).toBeCloseTo(9.65 - 10.3 * Math.exp(-1.2), 12);
    expect(autoFallSpeed(5)).toBeGreaterThan(autoFallSpeed(1));
  });

  it('can be overridden, which changes density but not the top-face rate', () => {
    const auto = derive(DEFAULTS);
    const slow = derive(with_({ vtOverride: 4 }));
    expect(slow.vt).toBe(4);
    expect(slow.n).toBeCloseTo((auto.n * auto.vt) / 4, 8);
    // rate_top = n·A_top·v_t = R·A_top/V_d, independent of v_t.
    expect(hitRates(with_({ vtOverride: 4 })).top).toBeCloseTo(hitRates(DEFAULTS).top, 8);
  });
});

describe('total hits: spec reference values', () => {
  const cases: [thetaDeg: number, s: number, expected: number][] = [
    [0, 1.4, 14783],
    [0, 3, 11625],
    [0, 6, 10243],
    [0, 10, 9691],
    [20, 1.4, 12144],
    [20, 3, 4585],
    [20, 6, 6724],
    [20, 10, 7579],
    [-20, 1.4, 29868],
    [-20, 3, 18665],
    [-20, 6, 13763],
    [-20, 10, 11803],
  ];

  it.each(cases)('θ = %d°, s = %d m/s → N ≈ %d', (thetaDeg, s, expected) => {
    expectWithin(totalHits(with_({ thetaDeg, s })).total, expected, 1);
  });
});

describe('optimum speed', () => {
  it('matches the drift speed in a strong enough tailwind', () => {
    const p = with_({ thetaDeg: 20 });
    const opt = optimumSpeed(p);
    expect(opt.kind).toBe('match-drift');
    if (opt.kind !== 'match-drift') return;

    // The exact optimum is s* = v_t·tan 20° = 2.3832 m/s with N = 3,478.
    expectWithin(opt.speed, derive(p).vt * Math.tan((20 * Math.PI) / 180), 1e-12);
    expectWithin(opt.speed, 2.383, 0.001);
    expectWithin(opt.hits, 3478, 1);
    expectWithin(totalHits(with_({ thetaDeg: 20, s: opt.speed })).total, opt.hits, 1e-6);

    // N has a kink at the optimum and climbs steeply on the slow side, so
    // rounding the speed to 2.38 already gives 3,495. An earlier draft of the
    // spec quoted that figure as the optimum.
    expectWithin(totalHits(with_({ thetaDeg: 20, s: 2.38 })).total, 3495, 1);
  });

  it('is a true minimum: slightly slower or faster is worse', () => {
    const opt = optimumSpeed(with_({ thetaDeg: 20 }));
    if (opt.kind !== 'match-drift') throw new Error('expected match-drift');
    for (const ds of [-0.5, -0.05, 0.05, 0.5]) {
      const N = totalHits(with_({ thetaDeg: 20, s: opt.speed + ds })).total;
      expect(N).toBeGreaterThan(opt.hits);
    }
  });

  it.each([0, -20])('has no finite optimum at θ = %d°; N falls toward the floor', (thetaDeg) => {
    const p = with_({ thetaDeg });
    const opt = optimumSpeed(p);
    expect(opt.kind).toBe('faster-is-better');
    if (opt.kind !== 'faster-is-better') return;

    expectWithin(opt.floor, derive(p).n * 100 * 0.875, 1e-9);
    const speeds = [1, 3, 10, 100, 1e4];
    const N = speeds.map((s) => totalHits({ ...p, s }).total);
    for (let i = 1; i < N.length; i++) expect(N[i]!).toBeLessThan(N[i - 1]!);
    expect(N.at(-1)!).toBeGreaterThan(opt.floor);
    expectWithin(N.at(-1)! / opt.floor, 1, 1e-3);
  });

  it('has no finite optimum in a tailwind too weak to beat the top-face rate', () => {
    // A_front·w_x > A_top·v_t needs tan θ > 0.125/0.875, i.e. θ > 8.13°.
    expect(optimumSpeed(with_({ thetaDeg: 8 })).kind).toBe('faster-is-better');
    expect(optimumSpeed(with_({ thetaDeg: 8.3 })).kind).toBe('match-drift');
  });

  it('counts the side face against matching the drift', () => {
    // θ = 20° turned mostly sideways: w_x is small and the side face is wet.
    expect(optimumSpeed(with_({ thetaDeg: 20, phiDeg: 80 })).kind).toBe('faster-is-better');
  });
});

describe('face breakdown', () => {
  it('wets the front below the drift speed, the back above it, never both', () => {
    const wx = derive(with_({ thetaDeg: 20 })).wx;
    const slow = hitRates(with_({ thetaDeg: 20, s: wx - 1 }));
    const fast = hitRates(with_({ thetaDeg: 20, s: wx + 1 }));
    const matched = hitRates(with_({ thetaDeg: 20, s: wx }));
    expect(slow.back).toBeGreaterThan(0);
    expect(slow.front).toBe(0);
    expect(fast.front).toBeGreaterThan(0);
    expect(fast.back).toBe(0);
    expect(matched.front).toBe(0);
    expect(matched.back).toBe(0);
    expect(matched.total).toBeCloseTo(matched.top, 10);
  });

  it('has a dry side with no crosswind and n·A_side·|w_y| with one', () => {
    expect(hitRates(with_({ thetaDeg: 20 })).side).toBeCloseTo(0, 12);

    const p = with_({ thetaDeg: 20, phiDeg: 90 });
    const d = derive(p);
    expect(d.wx).toBeCloseTo(0, 12);
    expect(hitRates(p).side).toBeCloseTo(d.n * 0.4375 * Math.abs(d.wy), 8);
    // Sideways drift direction does not matter.
    expect(hitRates(with_({ thetaDeg: -20, phiDeg: 90 })).side).toBeCloseTo(hitRates(p).side, 8);
  });

  it('agrees with the explicit box formulas across a grid of states', () => {
    for (const s of [0.3, 1.4, 3, 6, 12]) {
      for (const thetaDeg of [-60, -20, 0, 20, 60]) {
        for (const phiDeg of [0, 30, 90]) {
          const p = with_({ s, thetaDeg, phiDeg });
          const { n, vt, wx, wy } = derive(p);
          const top = n * (p.W * p.P) * vt;
          const front = n * (p.W * p.H) * Math.max(0, s - wx);
          const back = n * (p.W * p.H) * Math.max(0, wx - s);
          const side = n * (p.P * p.H) * Math.abs(wy);

          const r = hitRates(p);
          expect(r.top).toBeCloseTo(top, 8);
          expect(r.front).toBeCloseTo(front, 8);
          expect(r.back).toBeCloseTo(back, 8);
          expect(r.side).toBeCloseTo(side, 8);
          expect(r.total).toBeCloseTo(top + front + back + side, 8);
          expect(totalHits(p).total).toBeCloseTo(((top + front + back + side) * p.D) / s, 6);
        }
      }
    }
  });
});

describe('trip totals', () => {
  it('scales linearly with distance', () => {
    expect(totalHits(with_({ D: 250 })).total).toBeCloseTo(2.5 * totalHits(DEFAULTS).total, 6);
  });

  it('reports sigma, water collected and per-face parts that sum to the total', () => {
    const t = totalHits(with_({ thetaDeg: -20, phiDeg: 30 }));
    expect(t.sigma).toBeCloseTo(Math.sqrt(t.total), 10);
    expect(t.top + t.front + t.back + t.side).toBeCloseTo(t.total, 8);

    const base = totalHits(DEFAULTS);
    expect(base.waterMl).toBeCloseTo(base.total * derive(DEFAULTS).dropVolume * 1e6, 10);
    // 11,625 drops of 2 mm ≈ 48.7 mL.
    expectWithin(base.waterMl, 48.7, 0.05);
    expect(base.tripTime).toBeCloseTo(100 / 3, 10);
  });

  it('raises the hit rate with speed while lowering the total', () => {
    const jog = with_({ s: 3 });
    const run = with_({ s: 6 });
    expect(hitRates(run).total).toBeGreaterThan(hitRates(jog).total);
    expect(totalHits(run).total).toBeLessThan(totalHits(jog).total);
  });

  it('compares against walking pace', () => {
    expect(vsWalking(with_({ s: 1.4 }))).toBeCloseTo(1, 12);
    expectWithin(vsWalking(DEFAULTS), 11625 / 14783, 1e-4);
  });
});

describe('helpers', () => {
  it('converts trip time back to speed', () => {
    expect(speedFromTime(100, derive(DEFAULTS).T)).toBeCloseTo(DEFAULTS.s, 12);
    expect(speedFromTime(100, 20)).toBe(5);
  });

  it('converts speed units', () => {
    expect(msToKmh(3)).toBeCloseTo(10.8, 12);
    expect(msToMph(3)).toBeCloseTo(6.7108, 4);
  });

  it('keeps every default inside its range', () => {
    for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
      const value = key === 'vtOverride' ? derive(DEFAULTS).vt : DEFAULTS[key];
      expect(value).toBeGreaterThanOrEqual(RANGES[key].min);
      expect(value).toBeLessThanOrEqual(RANGES[key].max);
    }
  });
});
