// Settings for running many headless trials as fast as possible.
//
// The hit count does not depend on the timestep or on the domain size, so
// both are chosen for speed: no clearance beyond what one step of motion
// needs, and the timestep that minimises drops × steps. Rain is thinned only
// if the work still exceeds a budget.

import { derive, type Params } from '../physics/physics';
import type { SimOptions } from './simulation';

/** Drop-steps (one drop advanced one step) allowed for a whole batch. */
export const BATCH_WORK_BUDGET = 3e8;

const CANDIDATE_DTS = [1 / 240, 1 / 120, 1 / 60, 1 / 40, 1 / 30, 1 / 20, 1 / 15, 1 / 10, 1 / 6];

/** Volume of the domain the simulation would use with no minimum margin. */
function domainVolume(p: Params, dt: number): number {
  const { vRel } = derive(p);
  const mx = 2 * Math.abs(vRel[0]) * dt;
  const my = 2 * Math.abs(vRel[1]) * dt;
  const mz = 2 * Math.abs(vRel[2]) * dt;
  return (p.P + 2 * mx) * (p.W + 2 * my) * (p.H + mz);
}

export interface BatchPlan {
  options: Required<Pick<SimOptions, 'dt' | 'margin' | 'maxDrops'>>;
  /** Real drops per simulated drop this plan will use; 1 means no thinning. */
  weight: number;
}

export function planBatch(p: Params, trials: number, budget = BATCH_WORK_BUDGET): BatchPlan {
  const { n, T } = derive(p);

  let best = { dt: CANDIDATE_DTS[0]!, volume: 0, work: Infinity };
  for (const dt of CANDIDATE_DTS) {
    const volume = domainVolume(p, dt);
    const work = n * volume * Math.ceil(T / dt) * trials;
    if (work < best.work) best = { dt, volume, work };
  }

  const weight = Math.max(1, best.work / budget);
  return {
    options: { dt: best.dt, margin: 0, maxDrops: weight > 1 ? (n * best.volume) / weight : Infinity },
    weight,
  };
}
