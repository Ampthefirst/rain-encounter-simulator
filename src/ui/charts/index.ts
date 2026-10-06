// Builds the four analytic charts and keeps them in step with the parameters.

import {
  FACE_KEYS,
  angleSamples,
  hitsGrid,
  hitsVsAngle,
  hitsVsSpeed,
  linspace,
  optimumRidge,
  rateVsSpeed,
  speedSamples,
  type HitsGrid,
  type RidgePoint,
} from '../../physics/curves';
import { RANGES, hitRates, optimumSpeed, totalHits, type Params } from '../../physics/physics';
import { fmt, fmtAngle, fmtCount, fmtTrim } from '../../format';
import type { SimStore } from '../../simState';
import type { Store } from '../../state';
import { Heatmap } from './heatmap';
import { StackedChart, type StackedChartData } from './stackedChart';
import { FACE_LABELS } from './theme';

const SPEED = RANGES.s;
const ANGLE = RANGES.thetaDeg;
const SPEED_TICKS = [2, 4, 6, 8, 10, 12];
const ANGLE_TICKS = [-60, -40, -20, 0, 20, 40, 60];

const byId = (id: string) => document.getElementById(id)!;

export function mountCharts(store: Store, simStore: SimStore): void {
  const legend = byId('face-legend');
  for (const key of FACE_KEYS) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = `var(--face-${key})`;
    item.append(swatch, FACE_LABELS[key]);
    legend.append(item);
  }

  const speedAxis = {
    xMin: SPEED.min,
    xMax: SPEED.max,
    xTicks: SPEED_TICKS,
    xTickFormat: (x: number) => fmt(x),
    xLabel: 'speed (m/s)',
    xTooltip: (x: number) => `${fmt(x, 1)} m/s`,
  };

  const hitsSpeed = new StackedChart(byId('chart-hits-speed'), {
    ...speedAxis,
    valueFormat: fmtCount,
    totalLabel: 'total hits',
    scaleFromX: 1,
  });
  const rateSpeed = new StackedChart(byId('chart-rate-speed'), {
    ...speedAxis,
    valueFormat: (y) => fmtTrim(y, y >= 100 ? 0 : 1),
    totalLabel: 'drops per second',
  });
  const hitsAngle = new StackedChart(byId('chart-hits-angle'), {
    xMin: ANGLE.min,
    xMax: ANGLE.max,
    xTicks: ANGLE_TICKS,
    xTickFormat: fmtAngle,
    xLabel: ['← into the rain · rain angle · rain at your back →', '← headwind · rain angle · tailwind →', 'rain angle'],
    xTooltip: (x) => `${fmtAngle(x)} from vertical`,
    valueFormat: fmtCount,
    totalLabel: 'total hits',
  });
  const heatmap = new Heatmap(byId('chart-heatmap'), byId('heatmap-legend'), {
    speedMin: SPEED.min,
    speedMax: SPEED.max,
    angleMin: ANGLE.min,
    angleMax: ANGLE.max,
    speedTicks: SPEED_TICKS,
    angleTicks: [-60, -30, 0, 30, 60],
  });

  // The heatmap grid does not depend on the current speed or angle, so it is
  // only recomputed when one of the other parameters changes.
  let cache: { key: string; grid: HitsGrid; ridge: RidgePoint[] } | null = null;
  const surface = (p: Params) => {
    const key = JSON.stringify({ ...p, s: 0, thetaDeg: 0 });
    if (cache?.key !== key) {
      cache = {
        key,
        grid: hitsGrid(p, linspace(SPEED.min, SPEED.max, 96), linspace(ANGLE.min, ANGLE.max, 81)),
        ridge: optimumRidge(p, linspace(ANGLE.min, ANGLE.max, 241)),
      };
    }
    return cache;
  };

  // Finished simulations are drawn over the hits-vs-speed curve.
  let hitsSpeedData: StackedChartData | null = null;
  const drawHitsSpeed = () => {
    if (!hitsSpeedData) return;
    hitsSpeed.setData({
      ...hitsSpeedData,
      points: simStore.points.map((r) => ({ x: r.speed, y: r.hits, error: r.error, trials: r.trials })),
    });
  };
  simStore.onPoints(drawHitsSpeed);

  store.subscribe((p) => {
    const speeds = speedSamples(p, SPEED.min, SPEED.max, 160);
    const optimum = optimumSpeed(p);

    hitsSpeedData = {
      sweep: hitsVsSpeed(p, speeds),
      valueAt: (s) => totalHits({ ...p, s }),
      current: p.s,
      optimum: optimum.kind === 'match-drift' && optimum.speed <= SPEED.max ? optimum.speed : undefined,
      floor: optimum.floor,
      floorLabel: optimum.kind === 'match-drift' ? 'high-speed limit' : 'floor',
    };
    drawHitsSpeed();
    rateSpeed.setData({
      sweep: rateVsSpeed(p, speeds),
      valueAt: (s) => hitRates({ ...p, s }),
      current: p.s,
    });
    hitsAngle.setData({
      sweep: hitsVsAngle(p, angleSamples(p, ANGLE.min, ANGLE.max, 121)),
      valueAt: (thetaDeg) => totalHits({ ...p, thetaDeg }),
      current: p.thetaDeg,
    });

    const { grid, ridge } = surface(p);
    heatmap.setData({
      grid,
      ridge,
      current: { speed: p.s, thetaDeg: p.thetaDeg },
      valueAt: (s, thetaDeg) => totalHits({ ...p, s, thetaDeg }).total,
    });
  });
}
