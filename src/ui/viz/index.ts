// The visualizer panel: runs the simulation in real time, draws it, shows the
// live count beside the prediction, and launches headless batches of trials.

import { FACE_KEYS, type FaceKey } from '../../physics/curves';
import { derive, hitRates, totalHits } from '../../physics/physics';
import { fmt, fmtCount, fmtTrim } from '../../format';
import { planBatch } from '../../sim/batch';
import type { BatchMessage, BatchRequest } from '../../sim/batch.worker';
import { Simulation } from '../../sim/simulation';
import type { SimStore } from '../../simState';
import type { Store } from '../../state';
import { FACE_LABELS } from '../charts/theme';
import { RainScene } from './scene';

const BATCH_TRIALS = 100;
/** Clearance drawn around the person; wider than the simulation needs so the simulated rain is visible. */
const VIZ_MARGIN = 0.6;
const VIZ_MAX_DROPS = 30_000;
/** Longest frame gap that is simulated; a stalled tab resumes instead of catching up. */
const MAX_FRAME_SECONDS = 0.1;

const randomSeed = () => Math.floor(Math.random() * 4294967296);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function mountVisualizer(host: HTMLElement, store: Store, simStore: SimStore): void {
  host.querySelector('.viz-loading')?.remove();

  // --- DOM ---------------------------------------------------------------
  const stage = el('div', 'viz-stage');

  const hud = el('div', 'viz-hud');
  const hudHead = el('div', 'hud-head');
  const hudCount = el('span', 'hud-count');
  hudHead.append(hudCount, el('span', 'hud-unit', 'simulated hits'));
  const hudPredicted = el('div', 'hud-predicted');
  const hudFaces = el('div', 'hud-faces');
  const faceCounts = {} as Record<FaceKey, HTMLElement>;
  for (const key of FACE_KEYS) {
    const item = el('span', 'hud-face');
    const swatch = el('span', 'legend-swatch');
    swatch.style.background = `var(--face-${key})`;
    faceCounts[key] = el('span', 'hud-face-count');
    item.append(swatch, `${FACE_LABELS[key]} `, faceCounts[key]);
    hudFaces.append(item);
  }
  const hudNote = el('div', 'hud-note');
  hud.append(hudHead, hudPredicted, hudFaces, hudNote);

  const bar = el('div', 'viz-bar');
  const progress = el('div', 'viz-progress');
  const progressFill = el('div', 'viz-progress-fill');
  progress.append(progressFill);
  const playButton = el('button', 'button');
  playButton.type = 'button';
  const resetButton = el('button', 'button', 'Reset');
  resetButton.type = 'button';
  const scaleLabel = el('label', 'viz-scale');
  const scaleInput = el('input');
  scaleInput.type = 'range';
  scaleInput.min = '-1';
  scaleInput.max = '1';
  scaleInput.step = '0.01';
  scaleInput.value = '0';
  const scaleValue = el('span', 'viz-scale-value');
  scaleLabel.append('Time scale', scaleInput, scaleValue);
  const tripText = el('span', 'viz-trip');
  const batchText = el('span', 'viz-batch');
  batchText.setAttribute('aria-live', 'polite');
  const batchButton = el('button', 'button button-primary');
  batchButton.type = 'button';
  bar.append(progress, playButton, resetButton, scaleLabel, tripText, batchText, batchButton);

  const caption = el('div', 'viz-caption', 'Rain inside the outlined box is simulated and counted. Rain beyond it is decoration.');
  stage.append(caption);
  host.append(stage, hud, bar);

  let scene: RainScene | null = null;
  try {
    scene = new RainScene(stage);
  } catch {
    stage.append(el('div', 'viz-fallback', '3D view unavailable: this browser could not start WebGL. The simulation still runs and counts.'));
  }

  // --- Simulation --------------------------------------------------------
  let params = store.params;
  let sim!: Simulation;
  // The first run starts by itself unless the visitor has asked for less motion.
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let recorded = false;
  let timeScale = 1;
  let lastFrame = performance.now();

  const publish = () => {
    simStore.setLive({
      status: sim.done ? 'done' : playing ? 'running' : sim.time > 0 ? 'paused' : 'ready',
      time: sim.time,
      duration: sim.duration,
      hits: sim.hits.total,
      weight: sim.weight,
    });
  };

  const rebuild = () => {
    sim = new Simulation(params, { seed: randomSeed(), margin: VIZ_MARGIN, maxDrops: VIZ_MAX_DROPS });
    recorded = false;
    sim.onHit = scene ? (face, x, y, z) => scene.flash(face, x, y, z) : null;
    scene?.configure(sim, params, derive(params).n);
    publish();
    updateHud();
  };

  function updateHud(): void {
    const hits = sim.hits;
    const rates = hitRates(params);
    const expected = rates.total * sim.time;
    hudCount.textContent = fmtCount(hits.total);
    hudPredicted.textContent = sim.done
      ? `Predicted ${fmtCount(expected)} ± ${fmtCount(Math.sqrt(expected * sim.weight))}`
      : `Predicted by now ${fmtCount(expected)} ± ${fmtCount(Math.sqrt(expected * sim.weight))}`;
    for (const key of FACE_KEYS) faceCounts[key].textContent = fmtCount(hits[key]);

    const notes: string[] = [];
    if (sim.weight > 1.001) notes.push(`Rain thinned: each simulated drop counts as ${fmtTrim(sim.weight, 1)}.`);
    if (scene && scene.shownOneIn > sim.weight * 1.05) notes.push('Too many drops to draw them all; every one is still counted.');
    hudNote.textContent = notes.join(' ');

    playButton.textContent = sim.done ? 'Run again' : playing ? 'Pause' : 'Play';
    progressFill.style.width = `${(100 * sim.time) / sim.duration}%`;
    tripText.textContent = `${fmtTrim(params.s * sim.time, 0)} of ${fmtTrim(params.D, 0)} m · ${fmt(sim.time, 1)} s`;
  }

  const frame = (now: number) => {
    const realDt = Math.min(MAX_FRAME_SECONDS, (now - lastFrame) / 1000);
    lastFrame = now;

    if (playing && !sim.done) {
      sim.advance(realDt * timeScale);
      if (sim.done && !recorded) {
        recorded = true;
        playing = false;
        const hits = sim.hits.total;
        // √N for one run; thinning inflates the scatter by √weight.
        simStore.addPoint({ speed: params.s, hits, error: Math.sqrt(hits * sim.weight), trials: 1 });
      }
      publish();
      updateHud();
    }
    scene?.render(sim, realDt);
    requestAnimationFrame(frame);
  };

  playButton.addEventListener('click', () => {
    if (sim.done) {
      rebuild();
      playing = true;
    } else {
      playing = !playing;
    }
    publish();
    updateHud();
  });
  resetButton.addEventListener('click', () => {
    playing = false;
    rebuild();
  });
  const setScale = () => {
    timeScale = 10 ** Number(scaleInput.value);
    scaleValue.textContent = `${fmtTrim(timeScale, timeScale < 1 ? 2 : 1)}×`;
  };
  scaleInput.addEventListener('input', setScale);
  setScale();

  // --- Batch of headless trials -----------------------------------------
  let worker: Worker | null = null;

  const idleBatchButton = () => {
    batchButton.textContent = `Run ${BATCH_TRIALS} trials`;
  };

  const cancelBatch = () => {
    worker?.terminate();
    worker = null;
    idleBatchButton();
  };

  const showBatch = () => {
    const { batch, batchProgress } = simStore;
    if (batchProgress) {
      batchText.textContent = `Running trial ${batchProgress.done} of ${batchProgress.total}…`;
    } else if (batch) {
      const predicted = totalHits(params);
      const off = (batch.mean / predicted.total - 1) * 100;
      const thinned =
        batch.weight > 1.001 ? ` Rain thinned ×${fmtTrim(batch.weight, 1)}, which widens the scatter.` : '';
      batchText.textContent =
        `${batch.trials} trials: ${fmtCount(batch.mean)} ± ${fmtCount(batch.sd)} simulated, ` +
        `${fmtCount(predicted.total)} ± ${fmtCount(predicted.sigma)} predicted ` +
        `(mean ${off >= 0 ? '+' : '−'}${fmt(Math.abs(off), 2)}%).${thinned}`;
    } else {
      batchText.textContent = '';
    }
  };
  simStore.onChange(showBatch);

  batchButton.addEventListener('click', () => {
    if (worker) {
      cancelBatch();
      simStore.setBatchProgress(null);
      return;
    }
    const runParams = params;
    const plan = planBatch(runParams, BATCH_TRIALS);
    worker = new Worker(new URL('../../sim/batch.worker.ts', import.meta.url), { type: 'module' });
    batchButton.textContent = 'Cancel';
    simStore.setBatchProgress({ done: 0, total: BATCH_TRIALS });
    worker.addEventListener('message', (event: MessageEvent<BatchMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        simStore.setBatchProgress({ done: message.done, total: BATCH_TRIALS });
        return;
      }
      const { mean, sd, weight, trials } = message.summary;
      cancelBatch();
      simStore.setBatch({ trials, mean: mean.total, sd: sd.total, weight });
      simStore.addPoint({ speed: runParams.s, hits: mean.total, error: sd.total, trials });
    });
    worker.postMessage({
      params: runParams,
      trials: BATCH_TRIALS,
      options: { ...plan.options, seed: randomSeed() },
    } satisfies BatchRequest);
  });
  idleBatchButton();

  // --- Parameters --------------------------------------------------------
  let first = true;
  store.subscribe((p) => {
    params = p;
    if (!first) {
      // Any change invalidates a batch in flight and its result.
      cancelBatch();
      simStore.setBatch(null);
      if (sim.done) playing = false;
    }
    first = false;
    rebuild();
  });

  requestAnimationFrame((now) => {
    lastFrame = now;
    frame(now);
  });
}
