// Readout tiles: the headline numbers for the current parameters.

import { WALKING_SPEED, derive, msToKmh, optimumSpeed, totalHits, vsWalking } from '../physics/physics';
import { fmt, fmtCount, fmtDuration, fmtTrim } from '../format';
import type { SimStore } from '../simState';
import type { Store } from '../state';

interface Tile {
  value: HTMLElement;
  note: HTMLElement;
}

function addTile(host: HTMLElement, label: string, className = ''): Tile {
  const tile = document.createElement('div');
  tile.className = `tile ${className}`.trim();
  const head = document.createElement('div');
  head.className = 'tile-label';
  head.textContent = label;
  const value = document.createElement('div');
  value.className = 'tile-value';
  const note = document.createElement('div');
  note.className = 'tile-note';
  tile.append(head, value, note);
  host.append(tile);
  return { value, note };
}

export function mountTiles(host: HTMLElement, store: Store, simStore: SimStore): void {
  const predicted = addTile(host, 'Predicted hits', 'tile-hero');
  const simulated = addTile(host, 'Simulated hits');
  const walking = addTile(host, 'Versus walking');
  const optimum = addTile(host, 'Optimum speed');
  const time = addTile(host, 'Trip time');
  const water = addTile(host, 'Water collected');
  const distance = addTile(host, 'Distance');

  // The live count from the visualizer, and the latest batch if there is one.
  simStore.onChange(() => {
    const { live, batch } = simStore;
    simulated.value.textContent = live ? fmtCount(live.hits) : '—';
    if (batch) {
      simulated.note.textContent = `${batch.trials} trials: ${fmtCount(batch.mean)} ± ${fmtCount(batch.sd)}`;
    } else if (!live) {
      simulated.note.textContent = 'No simulation run yet';
    } else if (live.status === 'done') {
      const predicted = totalHits(store.params).total;
      const z = (live.hits - predicted) / Math.sqrt(predicted * live.weight);
      simulated.note.textContent = `Finished: ${z >= 0 ? '+' : '−'}${fmt(Math.abs(z), 1)}σ from the prediction`;
    } else if (live.status === 'ready') {
      simulated.note.textContent = 'Ready to run';
    } else {
      const state = live.status === 'paused' ? 'Paused at' : 'Running:';
      simulated.note.textContent = `${state} ${fmt(live.time, 1)} of ${fmt(live.duration, 1)} s`;
    }
  });

  store.subscribe((p) => {
    const hits = totalHits(p);
    const d = derive(p);

    predicted.value.textContent = fmtCount(hits.total);
    predicted.note.textContent = `± ${fmtCount(hits.sigma)} drops (1σ of Poisson scatter)`;

    const ratio = vsWalking(p);
    const change = Math.abs(ratio - 1) * 100;
    walking.value.textContent = `${fmt(ratio, 2)}×`;
    walking.note.textContent =
      change < 0.5
        ? `Same as walking at ${WALKING_SPEED} m/s`
        : `${fmt(change)}% ${ratio < 1 ? 'fewer' : 'more'} hits than at ${WALKING_SPEED} m/s`;

    const opt = optimumSpeed(p);
    if (opt.kind === 'match-drift') {
      optimum.value.textContent = `${fmt(opt.speed, 2)} m/s`;
      optimum.note.textContent = `${fmt(msToKmh(opt.speed), 1)} km/h, matching the rain's drift: ${fmtCount(opt.hits)} hits`;
    } else {
      optimum.value.textContent = 'Faster is better';
      optimum.note.textContent = `Never below ${fmtCount(opt.floor)} hits`;
    }

    time.value.textContent = fmtDuration(hits.tripTime);
    time.note.textContent = `${fmtTrim(p.D, 0)} m at ${fmtTrim(p.s, 2)} m/s`;

    water.value.textContent = `${fmtTrim(hits.waterMl, hits.waterMl < 10 ? 2 : 1)} mL`;
    water.note.textContent = `${fmtTrim(d.dropVolume * 1e9, 2)} mm³ per drop`;

    distance.value.textContent = `${fmtTrim(p.D, 0)} m`;
    distance.note.textContent = 'Hits scale in proportion to distance';
  });
}
