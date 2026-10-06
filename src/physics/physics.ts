// Physics for the rain encounter model. Pure and DOM-free: charts and the
// simulation both import from here.
//
// Coordinates: +x is the person's direction of travel, +y is sideways, +z is up.
// Parameters are held in the units the UI shows (mm/h, mm, degrees); everything
// returned by derive() is SI.
//
// The simulation may use derive() only (n, vRel, body). hitRates(), totalHits()
// and optimumSpeed() are the analytic answer it is checked against.

export type Vec3 = readonly [number, number, number];

export interface Params {
  /** Trip distance, m. */
  D: number;
  /** Person speed, m/s. */
  s: number;
  /** Rainfall rate, mm/h. */
  R: number;
  /** Drop diameter, mm. */
  d: number;
  /** Vertical fall speed in m/s, or null to derive it from the drop diameter. */
  vtOverride: number | null;
  /** Rain angle from vertical, degrees. Positive = tailwind, negative = headwind. */
  thetaDeg: number;
  /** Crosswind heading, degrees. 0 = drift along travel, 90 = drift fully sideways. */
  phiDeg: number;
  /** Person height, width (y) and depth (x), m. */
  H: number;
  W: number;
  P: number;
}

export const DEFAULTS: Params = {
  D: 100,
  s: 3,
  R: 10,
  d: 2,
  vtOverride: null,
  thetaDeg: 0,
  phiDeg: 0,
  H: 1.75,
  W: 0.5,
  P: 0.25,
};

export interface Range {
  min: number;
  max: number;
}

export const RANGES = {
  D: { min: 5, max: 1000 },
  s: { min: 0.3, max: 12 },
  R: { min: 0.5, max: 100 },
  d: { min: 0.5, max: 5 },
  vtOverride: { min: 1, max: 10 },
  thetaDeg: { min: -60, max: 60 },
  phiDeg: { min: 0, max: 90 },
  H: { min: 1.0, max: 2.2 },
  W: { min: 0.3, max: 0.8 },
  P: { min: 0.15, max: 0.5 },
} as const satisfies Record<keyof Params, Range>;

export const SPEED_PRESETS = { walk: 1.4, jog: 3, run: 6, sprint: 9 } as const;
export const RAIN_PRESETS = { drizzle: 1, moderate: 5, heavy: 20, downpour: 50 } as const;

export const WALKING_SPEED = SPEED_PRESETS.walk;

const DEG = Math.PI / 180;

/** Terminal fall speed in m/s for a drop of diameter dMm (Atlas et al. 1973 fit to Gunn–Kinzer). */
export function autoFallSpeed(dMm: number): number {
  return 9.65 - 10.3 * Math.exp(-0.6 * dMm);
}

export type FaceId = 'top' | 'front' | 'back' | 'left' | 'right';

export interface Face {
  id: FaceId;
  /** m². */
  area: number;
  /** Outward unit normal. */
  normal: Vec3;
}

/**
 * The person as a set of flat faces. Hit rates are computed per face from
 * area and normal alone, so another body shape only needs another face list.
 */
export interface Body {
  H: number;
  W: number;
  P: number;
  faces: readonly Face[];
}

/** Upright box. The underside is omitted: rain never moves upward. */
export function boxBody(H: number, W: number, P: number): Body {
  return {
    H,
    W,
    P,
    faces: [
      { id: 'top', area: W * P, normal: [0, 0, 1] },
      { id: 'front', area: W * H, normal: [1, 0, 0] },
      { id: 'back', area: W * H, normal: [-1, 0, 0] },
      { id: 'left', area: P * H, normal: [0, 1, 0] },
      { id: 'right', area: P * H, normal: [0, -1, 0] },
    ],
  };
}

export interface Derived {
  /** Vertical fall speed, m/s. */
  vt: number;
  /** Volume of one drop, m³. */
  dropVolume: number;
  /** Number density, drops/m³. */
  n: number;
  /** Mean drop spacing n^(-1/3), m. */
  spacing: number;
  /** Horizontal drift speed and its components along and across travel, m/s. */
  w: number;
  wx: number;
  wy: number;
  /** Rain velocity in the person's frame, m/s. */
  vRel: Vec3;
  /** Trip time D/s, s. */
  T: number;
  body: Body;
}

export function derive(p: Params): Derived {
  const vt = p.vtOverride ?? autoFallSpeed(p.d);
  const dM = p.d / 1000;
  const dropVolume = (Math.PI * dM ** 3) / 6;
  const rainfallMs = p.R / 1000 / 3600;
  const n = rainfallMs / (dropVolume * vt);
  const w = vt * Math.tan(p.thetaDeg * DEG);
  const wx = w * Math.cos(p.phiDeg * DEG);
  const wy = w * Math.sin(p.phiDeg * DEG);
  return {
    vt,
    dropVolume,
    n,
    spacing: Math.cbrt(1 / n),
    w,
    wx,
    wy,
    vRel: [wx - p.s, wy, -vt],
    T: p.D / p.s,
    body: boxBody(p.H, p.W, p.P),
  };
}

/** Drops per second onto a face: density × area × the relative speed into the face. */
export function faceRate(n: number, vRel: Vec3, face: Face): number {
  const [vx, vy, vz] = vRel;
  const [nx, ny, nz] = face.normal;
  const inward = -(vx * nx + vy * ny + vz * nz);
  return n * face.area * Math.max(0, inward);
}

/** Per-face quantities as the UI reports them; left and right are merged into `side`. */
export interface FaceBreakdown {
  top: number;
  front: number;
  back: number;
  side: number;
  total: number;
}

/** Hit rates in drops per second. */
export function hitRates(p: Params): FaceBreakdown {
  const { n, vRel, body } = derive(p);
  const out: FaceBreakdown = { top: 0, front: 0, back: 0, side: 0, total: 0 };
  for (const face of body.faces) {
    const rate = faceRate(n, vRel, face);
    const key = face.id === 'left' || face.id === 'right' ? 'side' : face.id;
    out[key] += rate;
    out.total += rate;
  }
  return out;
}

export interface TripHits extends FaceBreakdown {
  /** Standard deviation of the total; hits are Poisson. */
  sigma: number;
  /** Water collected, mL. */
  waterMl: number;
  /** s. */
  tripTime: number;
}

/** Expected hits over the whole trip. */
export function totalHits(p: Params): TripHits {
  const { T, dropVolume } = derive(p);
  const rates = hitRates(p);
  const total = rates.total * T;
  return {
    top: rates.top * T,
    front: rates.front * T,
    back: rates.back * T,
    side: rates.side * T,
    total,
    sigma: Math.sqrt(total),
    waterMl: total * dropVolume * 1e6,
    tripTime: T,
  };
}

export type Optimum =
  /** Matching the rain's drift keeps the front and back dry; faster or slower is worse. */
  | { kind: 'match-drift'; speed: number; hits: number; floor: number }
  /** No finite optimum: hits fall toward `floor` as speed goes to infinity. */
  | { kind: 'faster-is-better'; floor: number };

// In both cases `floor` is the limit n·D·A_front as speed goes to infinity,
// where only the front face sweeps up drops.

export function optimumSpeed(p: Params): Optimum {
  const { n, vt, wx, wy } = derive(p);
  const aTop = p.W * p.P;
  const aFront = p.W * p.H;
  const aSide = p.P * p.H;
  const steady = aTop * vt + aSide * Math.abs(wy);
  const floor = n * p.D * aFront;
  if (wx > 0 && aFront * wx > steady) {
    return { kind: 'match-drift', speed: wx, hits: (n * steady * p.D) / wx, floor };
  }
  return { kind: 'faster-is-better', floor };
}

/** Ratio of hits at the current speed to hits at walking pace. */
export function vsWalking(p: Params): number {
  return totalHits(p).total / totalHits({ ...p, s: WALKING_SPEED }).total;
}

/** Speed that covers D in time T; used when the user edits the trip time. */
export function speedFromTime(D: number, T: number): number {
  return D / T;
}

export function msToKmh(v: number): number {
  return v * 3.6;
}

export function msToMph(v: number): number {
  return v / 0.44704;
}
