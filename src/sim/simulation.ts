// Particle simulation of the rain encounter, with no rendering and no DOM.
//
// It runs in the person's frame: the person box is fixed and every drop moves
// at the constant relative velocity. From the physics module it takes only
// derive() (density, relative velocity, box size, trip time), never the
// analytic hit rates or totals. Hits are counted from real segment-vs-box
// collisions.
//
// Scheme: an open domain box around the person holds a Poisson field of
// drops. Each step, every drop's movement segment is tested against the person
// box; drops that hit are counted and removed, drops that leave the domain are
// removed, and the volume of fresh rain that the step carried into the domain
// is filled with a new Poisson sample. Because no drop is ever reused, the
// dry "shadow" behind the person cannot refill or wrap around, and the field
// upstream of the person stays an exact uniform Poisson field at every step.

import { derive, type FaceId, type Params, type Vec3 } from '../physics/physics';
import { createRng, nextSeed, poisson, type Rng } from './rng';

export const FACE_IDS = ['top', 'front', 'back', 'left', 'right'] as const satisfies readonly FaceId[];

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Swept collision of a drop against the person box (slab test). The drop moves
 * from p to p + d during the step. Returns the index into FACE_IDS of the face
 * it enters through, or -1 if the segment misses the box or starts inside it.
 */
export function segmentBoxEntry(
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Box,
): number {
  // Cheap reject for the common case: the whole segment lies outside one slab.
  // This also covers a zero displacement on an axis the drop is outside of.
  if (px < box.minX ? px + dx < box.minX : px > box.maxX && px + dx > box.maxX) return -1;
  if (py < box.minY ? py + dy < box.minY : py > box.maxY && py + dy > box.maxY) return -1;
  if (pz < box.minZ ? pz + dz < box.minZ : pz > box.maxZ && pz + dz > box.maxZ) return -1;

  let tEnter = -Infinity;
  let tExit = Infinity;
  let axis = -1;

  if (dx !== 0) {
    const near = dx > 0 ? box.minX : box.maxX;
    const far = dx > 0 ? box.maxX : box.minX;
    tEnter = (near - px) / dx;
    tExit = (far - px) / dx;
    axis = 0;
  }

  if (dy !== 0) {
    const near = dy > 0 ? box.minY : box.maxY;
    const far = dy > 0 ? box.maxY : box.minY;
    const t1 = (near - py) / dy;
    const t2 = (far - py) / dy;
    if (t1 > tEnter) {
      tEnter = t1;
      axis = 1;
    }
    if (t2 < tExit) tExit = t2;
  }

  if (dz !== 0) {
    const near = dz > 0 ? box.minZ : box.maxZ;
    const far = dz > 0 ? box.maxZ : box.minZ;
    const t1 = (near - pz) / dz;
    const t2 = (far - pz) / dz;
    if (t1 > tEnter) {
      tEnter = t1;
      axis = 2;
    }
    if (t2 < tExit) tExit = t2;
  }

  // tEnter < 0 means the drop started inside the box (or the box is behind it).
  if (tEnter > tExit || tEnter < 0 || tEnter > 1) return -1;

  // The face entered is the one whose outward normal opposes the motion.
  if (axis === 0) return dx < 0 ? 1 : 2; // front : back
  if (axis === 1) return dy < 0 ? 3 : 4; // left : right
  return dz < 0 ? 0 : -1; // top; rain never rises into the underside
}

export interface SimOptions {
  /** RNG seed. Same seed and parameters give the same run. */
  seed?: number;
  /** Fixed timestep, s. */
  dt?: number;
  /** Minimum clearance between the person and the domain boundary, m. */
  margin?: number;
  /** Drop budget. Denser rain is thinned so the expected drop count stays under it. */
  maxDrops?: number;
}

export const SIM_DEFAULTS = {
  dt: 1 / 60,
  margin: 0.3,
  maxDrops: 20000,
} as const;

/** Hits in real drops (simulated hits × weight). `side` is left + right. */
export interface HitCounts {
  top: number;
  front: number;
  back: number;
  left: number;
  right: number;
  side: number;
  total: number;
}

export class Simulation {
  /** Rain velocity in the person's frame, m/s. */
  readonly vRel: Vec3;
  /** Trip time, s. */
  readonly duration: number;
  readonly dt: number;
  /** The person. */
  readonly box: Box;
  /** The simulated volume around the person. */
  readonly domain: Box;
  /** Real drops represented by each simulated drop; 1 unless the rain is thinned. */
  readonly weight: number;
  /** Simulated drops per m³ (real density / weight). */
  readonly density: number;

  /** Drop positions as x, y, z triples; only the first `count` drops are live. */
  positions: Float64Array;
  count = 0;

  private readonly rng: Rng;
  private readonly rawHits = new Int32Array(FACE_IDS.length);
  private readonly fullSteps: number;
  private readonly lastStep: number;
  private stepIndex = 0;
  private pending = 0;

  /**
   * Called for each hit with the index into FACE_IDS and the point where the
   * drop met the face. For drawing only; counting does not depend on it.
   */
  onHit: ((face: number, x: number, y: number, z: number) => void) | null = null;

  constructor(params: Params, options: SimOptions = {}) {
    const { n, vRel, T, body } = derive(params);
    const dt = options.dt ?? SIM_DEFAULTS.dt;
    const margin = options.margin ?? SIM_DEFAULTS.margin;
    const maxDrops = options.maxDrops ?? SIM_DEFAULTS.maxDrops;

    this.vRel = vRel;
    this.duration = T;
    this.dt = dt;
    this.rng = createRng(options.seed ?? 0);

    this.box = {
      minX: -body.P / 2,
      maxX: body.P / 2,
      minY: -body.W / 2,
      maxY: body.W / 2,
      minZ: 0,
      maxZ: body.H,
    };

    // Every drop that can reach the person during a step must already be in
    // the domain at the start of it, so the margin on each axis has to exceed
    // the distance moved per step. Nothing below z = 0 can hit: rain only falls.
    const mx = Math.max(margin, 2 * Math.abs(vRel[0]) * dt);
    const my = Math.max(margin, 2 * Math.abs(vRel[1]) * dt);
    const mz = Math.max(margin, 2 * Math.abs(vRel[2]) * dt);
    this.domain = {
      minX: this.box.minX - mx,
      maxX: this.box.maxX + mx,
      minY: this.box.minY - my,
      maxY: this.box.maxY + my,
      minZ: 0,
      maxZ: this.box.maxZ + mz,
    };

    const dom = this.domain;
    const volume = (dom.maxX - dom.minX) * (dom.maxY - dom.minY) * (dom.maxZ - dom.minZ);
    this.weight = Math.max(1, (n * volume) / maxDrops);
    this.density = n / this.weight;

    this.fullSteps = Math.floor(T / dt + 1e-9);
    const remainder = T - this.fullSteps * dt;
    this.lastStep = remainder > 1e-9 * dt ? remainder : 0;

    this.positions = new Float64Array(3 * Math.max(64, Math.ceil(this.density * volume * 1.5)));
    this.fill(dom.minX, dom.maxX, dom.minY, dom.maxY, dom.minZ, dom.maxZ, true);
  }

  /** Simulated time elapsed, s. */
  get time(): number {
    return Math.min(this.duration, this.stepIndex * this.dt);
  }

  get done(): boolean {
    return this.nextStepSize() === 0;
  }

  get hits(): HitCounts {
    const w = this.weight;
    const [top, front, back, left, right] = Array.from(this.rawHits, (c) => c * w) as [
      number,
      number,
      number,
      number,
      number,
    ];
    return { top, front, back, left, right, side: left + right, total: top + front + back + left + right };
  }

  /** Take the next fixed step (the final step is shortened to end exactly at the trip time). */
  step(): void {
    const h = this.nextStepSize();
    if (h === 0) return;
    this.stepBy(h);
    this.stepIndex++;
  }

  /**
   * Feed in elapsed simulated time (frame time × time scale). Whole fixed steps
   * are taken as they become due, so the result does not depend on how the
   * time is chopped up.
   */
  advance(elapsed: number): void {
    this.pending += elapsed;
    for (let h = this.nextStepSize(); h > 0 && this.pending >= h; h = this.nextStepSize()) {
      this.step();
      this.pending -= h;
    }
  }

  runToEnd(): HitCounts {
    while (!this.done) this.step();
    return this.hits;
  }

  private nextStepSize(): number {
    if (this.stepIndex < this.fullSteps) return this.dt;
    if (this.stepIndex === this.fullSteps) return this.lastStep;
    return 0;
  }

  private stepBy(h: number): void {
    const dx = this.vRel[0] * h;
    const dy = this.vRel[1] * h;
    const dz = this.vRel[2] * h;
    const { box, domain: dom, rawHits } = this;
    const pos = this.positions;
    const { minX: bx0, maxX: bx1, minY: by0, maxY: by1, minZ: bz0, maxZ: bz1 } = box;

    let i = 0;
    while (i < this.count) {
      const o = 3 * i;
      const px = pos[o]!;
      const py = pos[o + 1]!;
      const pz = pos[o + 2]!;
      const nx = px + dx;
      const ny = py + dy;
      const nz = pz + dz;

      // Most drops are nowhere near the person: skip the full test when the
      // whole segment is on the outside of one pair of box planes.
      const clear =
        (px < bx0 ? nx < bx0 : px > bx1 && nx > bx1) ||
        (py < by0 ? ny < by0 : py > by1 && ny > by1) ||
        (pz < bz0 ? nz < bz0 : pz > bz1 && nz > bz1);
      const face = clear ? -1 : segmentBoxEntry(px, py, pz, dx, dy, dz, box);
      if (face >= 0) {
        rawHits[face]!++;
        if (this.onHit) {
          const t =
            face === 0
              ? (bz1 - pz) / dz
              : face === 1
                ? (bx1 - px) / dx
                : face === 2
                  ? (bx0 - px) / dx
                  : face === 3
                    ? (by1 - py) / dy
                    : (by0 - py) / dy;
          this.onHit(face, px + t * dx, py + t * dy, pz + t * dz);
        }
        this.remove(i);
        continue;
      }

      if (nx < dom.minX || nx > dom.maxX || ny < dom.minY || ny > dom.maxY || nz < dom.minZ || nz > dom.maxZ) {
        this.remove(i);
        continue;
      }
      pos[o] = nx;
      pos[o + 1] = ny;
      pos[o + 2] = nz;
      i++;
    }

    // The rain that entered the domain during this step now occupies a slab
    // along each inflow face. Split the union of the three slabs into
    // non-overlapping boxes so corners are not filled twice.
    const [sx0, sx1, rx0, rx1] = splitAxis(dom.minX, dom.maxX, dx);
    const [sy0, sy1, ry0, ry1] = splitAxis(dom.minY, dom.maxY, dy);
    const [sz0, sz1] = splitAxis(dom.minZ, dom.maxZ, dz);
    this.fill(sx0, sx1, dom.minY, dom.maxY, dom.minZ, dom.maxZ, false);
    this.fill(rx0, rx1, sy0, sy1, dom.minZ, dom.maxZ, false);
    this.fill(rx0, rx1, ry0, ry1, sz0, sz1, false);
  }

  /** Add a Poisson-distributed number of drops, uniformly placed in the given box. */
  private fill(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    skipPersonBox: boolean,
  ): void {
    const volume = (x1 - x0) * (y1 - y0) * (z1 - z0);
    if (volume <= 0) return;
    const rng = this.rng;
    const added = poisson(rng, this.density * volume);
    this.reserve(this.count + added);
    const pos = this.positions;
    const b = this.box;
    for (let k = 0; k < added; k++) {
      const x = x0 + (x1 - x0) * rng();
      const y = y0 + (y1 - y0) * rng();
      const z = z0 + (z1 - z0) * rng();
      // Drops that start inside the person are discarded, not counted.
      if (skipPersonBox && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ) {
        continue;
      }
      const o = 3 * this.count++;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
    }
  }

  private remove(i: number): void {
    const pos = this.positions;
    const last = 3 * --this.count;
    const o = 3 * i;
    pos[o] = pos[last]!;
    pos[o + 1] = pos[last + 1]!;
    pos[o + 2] = pos[last + 2]!;
  }

  private reserve(drops: number): void {
    if (3 * drops <= this.positions.length) return;
    const grown = new Float64Array(Math.max(3 * drops, 2 * this.positions.length));
    grown.set(this.positions.subarray(0, 3 * this.count));
    this.positions = grown;
  }
}

/**
 * For one axis and the displacement along it this step, returns the inflow
 * slab [s0, s1] that fresh rain now occupies, then the rest of the axis [r0, r1].
 */
function splitAxis(min: number, max: number, d: number): [number, number, number, number] {
  if (d > 0) return [min, min + d, min + d, max];
  if (d < 0) return [max + d, max, min, max + d];
  return [min, min, min, max];
}

export function runTrial(params: Params, options: SimOptions = {}): HitCounts {
  return new Simulation(params, options).runToEnd();
}

export interface TrialSummary {
  trials: number;
  mean: HitCounts;
  /** Sample standard deviation across trials. */
  sd: HitCounts;
  /** Real drops per simulated drop; above 1 the rain was thinned. */
  weight: number;
}

const COUNT_KEYS = ['top', 'front', 'back', 'left', 'right', 'side', 'total'] as const;

function zeroCounts(): HitCounts {
  return { top: 0, front: 0, back: 0, left: 0, right: 0, side: 0, total: 0 };
}

/** Run independent trials, each with its own seed drawn from `options.seed`. */
export function runTrials(
  params: Params,
  trials: number,
  options: SimOptions = {},
  onProgress?: (done: number) => void,
): TrialSummary {
  const seeds = createRng(options.seed ?? 0);
  const sum = zeroCounts();
  const sumSq = zeroCounts();
  let weight = 1;

  for (let t = 0; t < trials; t++) {
    const sim = new Simulation(params, { ...options, seed: nextSeed(seeds) });
    const hits = sim.runToEnd();
    weight = sim.weight;
    for (const key of COUNT_KEYS) {
      sum[key] += hits[key];
      sumSq[key] += hits[key] ** 2;
    }
    onProgress?.(t + 1);
  }

  const mean = zeroCounts();
  const sd = zeroCounts();
  for (const key of COUNT_KEYS) {
    mean[key] = sum[key] / trials;
    const variance = trials > 1 ? (sumSq[key] - trials * mean[key] ** 2) / (trials - 1) : 0;
    sd[key] = Math.sqrt(Math.max(0, variance));
  }
  return { trials, mean, sd, weight };
}
