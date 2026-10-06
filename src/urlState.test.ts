import { describe, expect, it } from 'vitest';
import { DEFAULTS, type Params } from './physics/physics';
import { decodeParams, encodeParams } from './urlState';

describe('link encoding', () => {
  it('writes nothing for the defaults', () => {
    expect(encodeParams(DEFAULTS)).toBe('');
    expect(decodeParams('')).toEqual(DEFAULTS);
    expect(decodeParams('#')).toEqual(DEFAULTS);
  });

  it('writes only what differs from the defaults', () => {
    expect(encodeParams({ ...DEFAULTS, s: 6, thetaDeg: 20 })).toBe('s=6&theta=20');
  });

  it('round-trips every parameter', () => {
    const p: Params = {
      D: 250,
      s: 1.4,
      R: 50,
      d: 0.5,
      vtOverride: 4.2,
      thetaDeg: -35,
      phiDeg: 60,
      H: 1.9,
      W: 0.45,
      P: 0.3,
    };
    expect(decodeParams(encodeParams(p))).toEqual(p);
    expect(decodeParams(`#${encodeParams(p)}`)).toEqual(p);
  });

  it('keeps an automatic fall speed automatic', () => {
    const fragment = encodeParams({ ...DEFAULTS, d: 3 });
    expect(fragment).toBe('d=3');
    expect(decodeParams(fragment).vtOverride).toBeNull();
  });

  it('trims float noise', () => {
    expect(encodeParams({ ...DEFAULTS, s: 0.1 + 0.2 })).toBe('s=0.3');
  });

  it('clamps out-of-range values and ignores junk', () => {
    const p = decodeParams('s=99&theta=-500&D=abc&R=&nonsense=1&H=1.8');
    expect(p.s).toBe(12);
    expect(p.thetaDeg).toBe(-60);
    expect(p.D).toBe(DEFAULTS.D);
    expect(p.R).toBe(DEFAULTS.R);
    expect(p.H).toBe(1.8);
  });
});
