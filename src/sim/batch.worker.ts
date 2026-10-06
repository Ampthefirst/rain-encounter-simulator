// Runs a batch of headless trials off the main thread so the page stays responsive.

import type { Params } from '../physics/physics';
import { runTrials, type SimOptions, type TrialSummary } from './simulation';

export interface BatchRequest {
  params: Params;
  trials: number;
  options: SimOptions;
}

export type BatchMessage = { type: 'progress'; done: number } | { type: 'done'; summary: TrialSummary };

self.addEventListener('message', (event: MessageEvent<BatchRequest>) => {
  const { params, trials, options } = event.data;
  let lastPost = 0;
  const summary = runTrials(params, trials, options, (done) => {
    const now = performance.now();
    if (now - lastPost > 80) {
      lastPost = now;
      postMessage({ type: 'progress', done } satisfies BatchMessage);
    }
  });
  postMessage({ type: 'done', summary } satisfies BatchMessage);
});
