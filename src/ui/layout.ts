// Lets the visitor give the 3D view more room: a draggable divider between
// the top row and the charts, and a button that expands the view to fill the
// whole main column.

const SPLIT_KEY = 'rain-sim-split';
/** Share of the main column's height given to the visualizer row, in percent. */
const DEFAULT_SHARE = 40;
const MIN_SHARE = 25;
const MAX_SHARE = 75;

const clamp = (v: number) => Math.min(MAX_SHARE, Math.max(MIN_SHARE, v));

function savedShare(): number {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY));
    return value > 0 ? clamp(value) : DEFAULT_SHARE;
  } catch {
    return DEFAULT_SHARE;
  }
}

export function mountLayout(main: HTMLElement, splitter: HTMLElement, viz: HTMLElement): void {
  let share = savedShare();

  const apply = (next: number, save = true) => {
    share = clamp(next);
    main.style.gridTemplateRows = `minmax(0, ${share}fr) auto auto minmax(0, ${100 - share}fr)`;
    splitter.setAttribute('aria-valuenow', String(Math.round(share)));
    if (!save) return;
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(share)));
    } catch {
      // Without storage the split simply lasts for this visit.
    }
  };
  apply(share, false);

  // --- Divider -----------------------------------------------------------
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'horizontal');
  splitter.setAttribute('aria-label', 'Resize the 3D view');
  splitter.setAttribute('aria-valuemin', String(MIN_SHARE));
  splitter.setAttribute('aria-valuemax', String(MAX_SHARE));
  splitter.tabIndex = 0;
  splitter.title = 'Drag to resize the 3D view. Double-click to reset.';

  let dragging = false;
  splitter.addEventListener('pointerdown', (event) => {
    dragging = true;
    // Capture keeps the drag alive while the pointer is over the 3D canvas.
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add('dragging');
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const box = main.getBoundingClientRect();
    apply(((event.clientY - box.top) / box.height) * 100);
  });
  const release = () => {
    dragging = false;
    splitter.classList.remove('dragging');
  };
  splitter.addEventListener('pointerup', release);
  splitter.addEventListener('pointercancel', release);
  splitter.addEventListener('dblclick', () => apply(DEFAULT_SHARE));
  splitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') apply(share - 3);
    else if (event.key === 'ArrowDown') apply(share + 3);
    else if (event.key === 'Home') apply(DEFAULT_SHARE);
    else return;
    event.preventDefault();
  });

  // --- Expand ------------------------------------------------------------
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'button button-small viz-expand';
  viz.append(expand);

  const setExpanded = (expanded: boolean) => {
    main.classList.toggle('viz-expanded', expanded);
    expand.textContent = expanded ? 'Shrink' : 'Enlarge';
    expand.title = expanded ? 'Bring back the tiles and charts (Esc)' : 'Let the 3D view fill the page';
    expand.setAttribute('aria-pressed', String(expanded));
  };
  setExpanded(false);
  expand.addEventListener('click', () => setExpanded(!main.classList.contains('viz-expanded')));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && main.classList.contains('viz-expanded')) setExpanded(false);
  });
}
