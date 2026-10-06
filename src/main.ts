import './style.css';
import { SimStore } from './simState';
import { Store } from './state';
import { mountCharts } from './ui/charts';
import { mountControls } from './ui/controls';
import { mountLayout } from './ui/layout';
import { mountTiles } from './ui/tiles';
import { mountToolbar } from './ui/toolbar';
import { decodeParams, encodeParams } from './urlState';

// A shared link carries its scenario in the URL fragment.
const store = new Store(decodeParams(location.hash));
const simStore = new SimStore();

// Simulated points sit on the hits-vs-speed curve, so they stay valid while
// only the speed changes and are dropped when anything else does.
let curveKey = '';
store.subscribe((p) => {
  const key = JSON.stringify({ ...p, s: 0 });
  if (key !== curveKey) simStore.clearPoints();
  curveKey = key;

  // Keep the address bar in step so it can be copied at any time.
  const fragment = encodeParams(p);
  if (fragment !== location.hash.replace(/^#/, '')) {
    history.replaceState(null, '', fragment ? `#${fragment}` : location.pathname + location.search);
  }
});
window.addEventListener('hashchange', () => store.set(decodeParams(location.hash)));

mountToolbar(document.getElementById('toolbar')!, store);
mountControls(document.getElementById('controls')!, store);
mountTiles(document.getElementById('tiles')!, store, simStore);
mountCharts(store, simStore);

// Three.js is most of the download; load the 3D view after the page is usable.
const viz = document.getElementById('viz')!;
mountLayout(document.querySelector<HTMLElement>('.main')!, document.getElementById('splitter')!, viz);
import('./ui/viz')
  .then(({ mountVisualizer }) => mountVisualizer(viz, store, simStore))
  .catch(() => {
    const loading = viz.querySelector('.viz-loading');
    if (loading) loading.textContent = 'The 3D view failed to load. Reload the page to try again.';
  });
