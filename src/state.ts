import { DEFAULTS, type Params } from './physics/physics';

type Listener = (params: Params) => void;

/** The single source of truth for the parameters; every panel renders from it. */
export class Store {
  private current: Params;
  private listeners: Listener[] = [];
  private scheduled = false;

  constructor(initial: Params = DEFAULTS) {
    this.current = { ...initial };
  }

  get params(): Params {
    return this.current;
  }

  set(patch: Partial<Params>): void {
    this.current = { ...this.current, ...patch };
    // Sliders fire faster than the screen refreshes; notify once per frame.
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      for (const listener of this.listeners) listener(this.current);
    });
  }

  /** Calls the listener now and after every change. */
  subscribe(listener: Listener): void {
    this.listeners.push(listener);
    listener(this.current);
  }
}
