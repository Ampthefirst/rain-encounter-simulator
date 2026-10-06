// Heatmap of total hits over speed × rain angle, with the optimum-speed ridge
// and a crosshair at the current state.

import type { HitsGrid, RidgePoint } from '../../physics/curves';
import { fmt, fmtAngle, fmtCount } from '../../format';
import { drawAxes, drawDot, drawLabel, fillTooltip, FONT_SMALL, linearScale, PlotCanvas, type Frame } from './plot';
import { rampColor, type ChartTheme } from './theme';

export interface HeatmapData {
  grid: HitsGrid;
  ridge: RidgePoint[];
  current: { speed: number; thetaDeg: number };
  /** Exact total hits at a speed and angle, for the hover readout. */
  valueAt: (speed: number, thetaDeg: number) => number;
}

export interface HeatmapOptions {
  speedMin: number;
  speedMax: number;
  angleMin: number;
  angleMax: number;
  speedTicks: number[];
  angleTicks: number[];
}

export class Heatmap {
  private readonly canvas: PlotCanvas;
  private readonly image = document.createElement('canvas');
  private readonly legendBar = document.createElement('span');
  private readonly legendMin = document.createElement('span');
  private readonly legendMax = document.createElement('span');
  private data: HeatmapData | null = null;
  private painted: { grid: HitsGrid; dark: boolean } | null = null;

  constructor(
    host: HTMLElement,
    legend: HTMLElement,
    private readonly options: HeatmapOptions,
  ) {
    this.canvas = new PlotCanvas(host, { top: 14, right: 16, bottom: 40, left: 58 }, (f) => this.draw(f));
    this.legendBar.className = 'ramp-bar';
    legend.append(this.legendMin, this.legendBar, this.legendMax);
  }

  setData(data: HeatmapData): void {
    this.data = data;
    this.canvas.redraw();
  }

  /** Colour position of a value: logarithmic, because hits span more than a decade. */
  private static position(grid: HitsGrid, value: number): number {
    const lo = Math.log(grid.min);
    const hi = Math.log(grid.max);
    return hi > lo ? (Math.log(value) - lo) / (hi - lo) : 0.5;
  }

  /** Render the grid into the offscreen image, one pixel per cell. */
  private paint(grid: HitsGrid, theme: ChartTheme): void {
    const nx = grid.speeds.length;
    const ny = grid.angles.length;
    this.image.width = nx;
    this.image.height = ny;
    const ictx = this.image.getContext('2d')!;
    const pixels = ictx.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) {
      // Image rows run top to bottom; angles run bottom to top.
      const row = ny - 1 - j;
      for (let i = 0; i < nx; i++) {
        const [r, g, b] = rampColor(theme.ramp, Heatmap.position(grid, grid.values[j * nx + i]!));
        const o = 4 * (row * nx + i);
        pixels.data[o] = r;
        pixels.data[o + 1] = g;
        pixels.data[o + 2] = b;
        pixels.data[o + 3] = 255;
      }
    }
    ictx.putImageData(pixels, 0, 0);
    this.painted = { grid, dark: theme.dark };

    this.legendBar.style.background = `linear-gradient(to right, ${theme.ramp.join(', ')})`;
    this.legendMin.textContent = fmtCount(grid.min);
    this.legendMax.textContent = fmtCount(grid.max);
  }

  private draw(f: Frame): void {
    const data = this.data;
    if (!data) return;
    const { ctx, plot, theme } = f;
    const o = this.options;
    const { grid } = data;
    if (this.painted?.grid !== grid || this.painted.dark !== theme.dark) this.paint(grid, theme);

    const sx = linearScale(o.speedMin, o.speedMax, plot.x, plot.x + plot.w);
    const sy = linearScale(o.angleMin, o.angleMax, plot.y + plot.h, plot.y);

    drawAxes(
      f,
      sx,
      sy,
      { ticks: o.speedTicks, format: (v) => fmt(v), label: 'speed (m/s)' },
      { ticks: [], format: fmtAngle },
    );
    ctx.font = FONT_SMALL;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of o.angleTicks) ctx.fillText(fmtAngle(t), plot.x - 8, sy(t));

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();

    // Grid values sit on the range ends, so the image overhangs the plot by
    // half a cell on each side.
    const cellW = plot.w / (grid.speeds.length - 1);
    const cellH = plot.h / (grid.angles.length - 1);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, plot.x - cellW / 2, plot.y - cellH / 2, plot.w + cellW, plot.h + cellH);

    if (data.ridge.length > 1) {
      const trace = () => {
        ctx.beginPath();
        for (const r of data.ridge) ctx.lineTo(sx(r.speed), sy(r.thetaDeg));
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      trace();
      ctx.lineWidth = 5;
      ctx.strokeStyle = theme.surface;
      ctx.stroke();
      trace();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.text;
      ctx.stroke();
    }

    const cx = sx(data.current.speed);
    const cy = sy(data.current.thetaDeg);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.text;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(cy) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(cy) + 0.5);
    ctx.moveTo(Math.round(cx) + 0.5, plot.y);
    ctx.lineTo(Math.round(cx) + 0.5, plot.y + plot.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    const inRange = data.ridge.filter((r) => r.speed <= o.speedMax);
    const anchor = inRange[Math.floor(inRange.length * 0.6)];
    if (anchor) drawLabel(f, 'optimum speed', sx(anchor.speed) - 10, sy(anchor.thetaDeg) - 4, 'right', 'bottom', theme.text);

    drawDot(f, cx, cy, theme.text);

    if (f.pointer) {
      const speed = sx.invert(f.pointer.x);
      const thetaDeg = sy.invert(f.pointer.y);
      ctx.beginPath();
      ctx.arc(f.pointer.x, f.pointer.y, 6, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.surface;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.text;
      ctx.stroke();
      this.canvas.showTooltip(f.pointer.x, f.pointer.y, (el) =>
        fillTooltip(el, `${fmt(speed, 1)} m/s · ${fmtAngle(thetaDeg)}`, [
          { label: 'total hits', value: fmtCount(data.valueAt(speed, thetaDeg)), strong: true },
        ]),
      );
    }
  }
}
