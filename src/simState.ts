// What the simulation has produced so far, shared between the visualizer,
// the readout tile and the hits-vs-speed chart.

export interface LiveRun {
  status: 'ready' | 'running' | 'paused' | 'done';
  /** Simulated time elapsed and the trip time, s. */
  time: number;
  duration: number;
  /** Hits so far, in real drops. */
  hits: number;
  /** Real drops per simulated drop; above 1 the rain is thinned. */
  weight: number;
}

export interface BatchResult {
  trials: number;
  mean: number;
  /** Standard deviation across trials. */
  sd: number;
  weight: number;
}

/** A finished simulation plotted on the hits-vs-speed chart. */
export interface RunPoint {
  speed: number;
  hits: number;
  /** Half-height of the error bar: √N for one run, the sd across trials for a batch. */
  error: number;
  /** 1 for a single visualized run. */
  trials: number;
}

const MAX_POINTS = 200;

export class SimStore {
  live: LiveRun | null = null;
  batch: BatchResult | null = null;
  batchProgress: { done: number; total: number } | null = null;
  points: RunPoint[] = [];

  private liveListeners: (() => void)[] = [];
  private pointListeners: (() => void)[] = [];

  /** Fires for anything shown as text: the live count, batch progress and results. */
  onChange(listener: () => void): void {
    this.liveListeners.push(listener);
    listener();
  }

  /** Fires only when the plotted points change, so the chart is not redrawn every frame. */
  onPoints(listener: () => void): void {
    this.pointListeners.push(listener);
    listener();
  }

  setLive(live: LiveRun | null): void {
    this.live = live;
    this.emit(this.liveListeners);
  }

  setBatchProgress(progress: { done: number; total: number } | null): void {
    this.batchProgress = progress;
    this.emit(this.liveListeners);
  }

  setBatch(batch: BatchResult | null): void {
    this.batch = batch;
    this.batchProgress = null;
    this.emit(this.liveListeners);
  }

  addPoint(point: RunPoint): void {
    this.points = [...this.points, point].slice(-MAX_POINTS);
    this.emit(this.pointListeners);
  }

  clearPoints(): void {
    if (this.points.length === 0) return;
    this.points = [];
    this.emit(this.pointListeners);
  }

  private emit(listeners: (() => void)[]): void {
    for (const listener of listeners) listener();
  }
}
