// Stacked-area chart of the per-face breakdown against one swept parameter.
// Used for hits vs speed, hit rate vs speed and hits vs rain angle.

import { FACE_KEYS, type Sweep } from '../../physics/curves';
import type { FaceBreakdown } from '../../physics/physics';
import { fmt, niceTicks } from '../../format';
import { drawAxes, drawDiamond, drawDot, drawLabel, fillTooltip, linearScale, PlotCanvas, type Frame } from './plot';
import { FACE_LABELS } from './theme';

export interface StackedChartOptions {
  xMin: number;
  xMax: number;
  xTicks: number[];
  xTickFormat: (x: number) => string;
  xLabel: string | string[];
  /** The x value as shown in the tooltip title, with its unit. */
  xTooltip: (x: number) => string;
  /** Formats a y value for the tooltip and labels. */
  valueFormat: (y: number) => string;
  totalLabel: string;
  /**
   * Ignore samples left of this x when choosing the y range. Totals blow up
   * as speed goes to zero, and scaling to that spike flattens everything else;
   * the curve is left to run off the top instead.
   */
  scaleFromX?: number;
}

export interface StackedChartData {
  sweep: Sweep;
  /** Exact breakdown at any x, for the hover readout and markers. */
  valueAt: (x: number) => FaceBreakdown;
  /** The current state's x. */
  current: number;
  /** x of the optimum, if there is one inside the range. */
  optimum?: number;
  /** y of the high-speed limit, drawn as a dashed line, and what to call it. */
  floor?: number;
  floorLabel?: string;
  /** Finished simulations to plot over the curve, with error bars. */
  points?: ChartPoint[];
}

export interface ChartPoint {
  x: number;
  y: number;
  /** Half-height of the error bar. */
  error: number;
  /** Trials behind the point; 1 is a single run. */
  trials: number;
}

const AREA_ALPHA = 0.28;

export class StackedChart {
  private readonly canvas: PlotCanvas;
  private data: StackedChartData | null = null;

  constructor(
    host: HTMLElement,
    private readonly options: StackedChartOptions,
  ) {
    this.canvas = new PlotCanvas(host, { top: 14, right: 16, bottom: 40, left: 58 }, (f) => this.draw(f));
  }

  setData(data: StackedChartData): void {
    this.data = data;
    this.canvas.redraw();
  }

  private draw(f: Frame): void {
    const data = this.data;
    if (!data) return;
    const { ctx, plot, theme } = f;
    const o = this.options;
    const { sweep } = data;

    const from = o.scaleFromX ?? -Infinity;
    const peak = Math.max(
      ...sweep.total.filter((_, i) => sweep.x[i]! >= from),
      data.valueAt(data.current).total,
      data.floor ?? 0,
    );
    const yTicks = niceTicks(0, peak, 4);
    const yTop = Math.max(peak * 1.04, yTicks.values.at(-1) ?? 0);
    const sx = linearScale(o.xMin, o.xMax, plot.x, plot.x + plot.w);
    const sy = linearScale(0, yTop, plot.y + plot.h, plot.y);

    drawAxes(
      f,
      sx,
      sy,
      { ticks: o.xTicks, format: o.xTickFormat, label: o.xLabel },
      { ticks: yTicks.values, format: (v) => fmt(v, yTicks.decimals) },
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y - 2, plot.w, plot.h + 2);
    ctx.clip();

    const n = sweep.x.length;
    const px = sweep.x.map(sx);
    let lower = new Array<number>(n).fill(0);
    for (const key of FACE_KEYS) {
      const values = sweep[key];
      const upper = lower.map((base, i) => base + values[i]!);
      if (values.some((v) => v > 0)) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(px[i]!, sy(upper[i]!));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(px[i]!, sy(lower[i]!));
        ctx.closePath();
        ctx.globalAlpha = AREA_ALPHA;
        ctx.fillStyle = theme.faces[key];
        ctx.fill();
        ctx.globalAlpha = 1;

        // The band's top edge, skipped where the band is empty so it does not
        // paint over the edge of the band beneath.
        ctx.beginPath();
        let open = false;
        for (let i = 0; i < n - 1; i++) {
          if (values[i]! > 0 || values[i + 1]! > 0) {
            if (!open) ctx.moveTo(px[i]!, sy(upper[i]!));
            ctx.lineTo(px[i + 1]!, sy(upper[i + 1]!));
            open = true;
          } else {
            open = false;
          }
        }
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = theme.faces[key];
        ctx.stroke();
      }
      lower = upper;
    }
    ctx.restore();

    if (data.floor !== undefined) {
      const y = Math.round(sy(data.floor)) + 0.5;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.textSecondary;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.restore();
      drawLabel(f, `${data.floorLabel ?? 'floor'} ${o.valueFormat(data.floor)}`, plot.x + plot.w - 4, y + 5, 'right', 'top');
    }

    // Current state: a hairline through the plot and a dot on the total.
    const cx = sx(data.current);
    const cy = sy(data.valueAt(data.current).total);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.muted;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, plot.y);
    ctx.lineTo(Math.round(cx) + 0.5, plot.y + plot.h);
    ctx.stroke();

    if (data.optimum !== undefined) {
      const ox = sx(data.optimum);
      const oy = sy(data.valueAt(data.optimum).total);
      drawDiamond(f, ox, oy, theme.text);
      // Below the marker if there is room above the axis, otherwise beside it.
      if (oy + 26 < plot.y + plot.h) drawLabel(f, 'optimum', ox, oy + 11, 'center', 'top');
      else drawLabel(f, 'optimum', ox + 12, oy - 6, 'left', 'bottom');
    }

    drawDot(f, cx, cy, theme.text);
    drawLabel(f, 'now', cx, cy - 10, 'center', 'bottom');

    for (const point of data.points ?? []) this.drawPoint(f, point, sx(point.x), sy);

    if (f.pointer) this.drawHover(f, data, sx.invert(f.pointer.x), sx, sy);
  }

  /** A simulated result: error bar, then an open circle (one run) or a filled square (a batch mean). */
  private drawPoint(f: Frame, point: ChartPoint, x: number, sy: (v: number) => number): void {
    const { ctx, theme } = f;
    const y = sy(point.y);
    const top = sy(point.y + point.error);
    const bottom = sy(point.y - point.error);
    const stroke = (width: number, color: string) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.moveTo(x - 4, top);
      ctx.lineTo(x + 4, top);
      ctx.moveTo(x - 4, bottom);
      ctx.lineTo(x + 4, bottom);
      ctx.stroke();
    };
    ctx.lineCap = 'butt';
    stroke(4, theme.surface);
    stroke(1.5, theme.text);

    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.text;
    if (point.trials > 1) {
      ctx.fillStyle = theme.surface;
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.fillStyle = theme.text;
      ctx.fillRect(x - 4, y - 4, 8, 8);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawHover(
    f: Frame,
    data: StackedChartData,
    x: number,
    sx: (v: number) => number,
    sy: (v: number) => number,
  ): void {
    const { ctx, plot, theme } = f;
    const o = this.options;
    const at = data.valueAt(x);
    const hx = sx(x);

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.textSecondary;
    ctx.beginPath();
    ctx.moveTo(Math.round(hx) + 0.5, plot.y);
    ctx.lineTo(Math.round(hx) + 0.5, plot.y + plot.h);
    ctx.stroke();
    drawDot(f, hx, sy(at.total), theme.textSecondary, 4);

    // Simulated results close to the pointer join the readout.
    const near = (data.points ?? []).filter((point) => Math.abs(sx(point.x) - hx) <= 8).slice(-3);

    this.canvas.showTooltip(hx, f.pointer!.y, (el) =>
      fillTooltip(el, o.xTooltip(x), [
        { label: o.totalLabel, value: o.valueFormat(at.total), strong: true },
        ...FACE_KEYS.map((key) => ({
          color: theme.faces[key],
          label: FACE_LABELS[key],
          value: o.valueFormat(at[key]),
        })),
        ...near.map((point) => ({
          label: point.trials > 1 ? `simulated, mean of ${point.trials} trials` : 'simulated, one run',
          value: `${o.valueFormat(point.y)} ± ${o.valueFormat(point.error)}`,
          strong: true,
        })),
      ]),
    );
  }
}
