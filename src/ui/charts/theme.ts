import type { FaceKey } from '../../physics/curves';

/** Colours for canvas drawing, read from the CSS custom properties in style.css. */
export interface ChartTheme {
  dark: boolean;
  surface: string;
  text: string;
  textSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  faces: Record<FaceKey, string>;
  /** Sequential ramp for the heatmap, from fewest hits to most. */
  ramp: string[];
}

// One-hue blue ramp, lightest to darkest.
const BLUE_RAMP = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
];

export const FACE_LABELS: Record<FaceKey, string> = {
  top: 'Top',
  front: 'Front',
  back: 'Back',
  side: 'Side',
};

export function readTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = v('--is-dark') === '1';
  return {
    dark,
    surface: v('--surface-1'),
    text: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    muted: v('--text-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    faces: { top: v('--face-top'), front: v('--face-front'), back: v('--face-back'), side: v('--face-side') },
    // Low values recede toward the surface in either theme.
    ramp: dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour at t in [0, 1] along a ramp, as RGB components. */
export function rampColor(ramp: string[], t: number): [number, number, number] {
  const pos = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(ramp[i]!);
  const b = hexToRgb(ramp[i + 1]!);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
