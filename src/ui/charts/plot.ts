// Shared canvas plumbing for the charts: sizing, axes, pointer tracking and
// the tooltip element.

import { readTheme, type ChartTheme } from './theme';

export const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_SMALL = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** The data area inside the margins, in CSS pixels. */
  plot: Rect;
  theme: ChartTheme;
  /** Pointer position in CSS pixels when it is over the data area. */
  pointer: { x: number; y: number } | null;
}

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
}

export function linearScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const scale = ((value: number) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)) as Scale;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0)) * (d1 - d0);
  return scale;
}

export class PlotCanvas {
  readonly tooltip: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pointer: { x: number; y: number } | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly margin: Margin,
    private readonly draw: (frame: Frame) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    host.append(this.canvas, this.tooltip);

    new ResizeObserver(() => this.resize()).observe(host);

    // Canvas colours are read from CSS at draw time, so a theme change (from
    // the OS or a data-theme attribute) needs a repaint.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.redraw());
    new MutationObserver(() => this.redraw()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const box = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      this.redraw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.redraw();
    });
  }

  redraw(): void {
    if (this.width === 0 || this.height === 0) return;
    const { ctx, margin: m } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const plot: Rect = {
      x: m.left,
      y: m.top,
      w: Math.max(1, this.width - m.left - m.right),
      h: Math.max(1, this.height - m.top - m.bottom),
    };
    const p = this.pointer;
    const inside = p && p.x >= plot.x && p.x <= plot.x + plot.w && p.y >= plot.y && p.y <= plot.y + plot.h;
    if (!inside) this.tooltip.hidden = true;

    this.draw({ ctx, width: this.width, height: this.height, plot, theme: readTheme(), pointer: inside ? p : null });
  }

  /** Show the tooltip beside a point (CSS pixels), keeping it inside the chart. */
  showTooltip(x: number, y: number, fill: (el: HTMLDivElement) => void): void {
    const tip = this.tooltip;
    tip.replaceChildren();
    fill(tip);
    tip.hidden = false;
    const gap = 12;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = x + gap + w > this.width ? x - gap - w : x + gap;
    const top = Math.min(Math.max(0, y - h / 2), Math.max(0, this.height - h));
    tip.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.redraw();
  }
}

export interface AxisSpec {
  ticks: number[];
  format: (value: number) => string;
  /** Axis title. Given several, the first that fits the plot width is used. */
  label?: string | string[];
}

/** Horizontal gridlines, the baseline, and tick labels on both axes. */
export function drawAxes(f: Frame, sx: Scale, sy: Scale, x: AxisSpec, y: AxisSpec): void {
  const { ctx, plot, theme } = f;
  const bottom = plot.y + plot.h;
  ctx.lineWidth = 1;
  ctx.font = FONT_SMALL;

  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of y.ticks) {
    const py = Math.round(sy(t)) + 0.5;
    if (py < plot.y - 1 || py > bottom + 1) continue;
    ctx.beginPath();
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.w, py);
    ctx.stroke();
    ctx.fillText(y.format(t), plot.x - 8, py);
  }

  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(plot.x, bottom + 0.5);
  ctx.lineTo(plot.x + plot.w, bottom + 0.5);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of x.ticks) {
    const px = sx(t);
    if (px < plot.x - 1 || px > plot.x + plot.w + 1) continue;
    ctx.fillText(x.format(t), px, bottom + 6);
  }
  if (x.label) {
    const options = typeof x.label === 'string' ? [x.label] : x.label;
    const label = options.find((text) => ctx.measureText(text).width <= plot.w) ?? options.at(-1)!;
    ctx.fillText(label, plot.x + plot.w / 2, bottom + 22);
  }
}

/** A filled dot with a ring in the surface colour so it stays legible over lines. */
export function drawDot(f: Frame, x: number, y: number, color: string, radius = 4.5): void {
  const { ctx, theme } = f;
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = theme.surface;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** An outlined diamond, ringed like drawDot. Used for the optimum so it differs in shape from the current state. */
export function drawDiamond(f: Frame, x: number, y: number, color: string, radius = 6): void {
  const { ctx, theme } = f;
  const path = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  };
  path(radius + 2);
  ctx.fillStyle = theme.surface;
  ctx.fill();
  path(radius);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Text with a halo in the surface colour so it reads over fills and lines. */
export function drawLabel(
  f: Frame,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
  color = f.theme.textSecondary,
): void {
  const { ctx, theme, plot } = f;
  ctx.font = FONT_SMALL;
  ctx.textBaseline = baseline;
  // Keep the label inside the plot horizontally.
  const w = ctx.measureText(text).width;
  let left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  left = Math.min(Math.max(left, plot.x + 2), plot.x + plot.w - w - 2);
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.surface;
  ctx.strokeText(text, left, y);
  ctx.fillStyle = color;
  ctx.fillText(text, left, y);
}

export interface TooltipRow {
  /** Series colour for the line key; omit for a row with no key. */
  color?: string;
  label: string;
  value: string;
  strong?: boolean;
}

/** Standard tooltip body: a title, then rows with the value leading. */
export function fillTooltip(el: HTMLElement, title: string, rows: TooltipRow[]): void {
  const head = document.createElement('div');
  head.className = 'tt-title';
  head.textContent = title;
  el.append(head);
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = row.strong ? 'tt-row tt-strong' : 'tt-row';
    const key = document.createElement('span');
    key.className = 'tt-key';
    if (row.color) key.style.background = row.color;
    const value = document.createElement('span');
    value.className = 'tt-value';
    value.textContent = row.value;
    const label = document.createElement('span');
    label.className = 'tt-label';
    label.textContent = row.label;
    line.append(key, value, label);
    el.append(line);
  }
}
