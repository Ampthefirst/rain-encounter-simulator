// Parameters to and from a URL fragment, so a scenario can be shared as a link.
// Only values that differ from the defaults are written.

import { DEFAULTS, RANGES, type Params } from './physics/physics';

/** Short names used in the link, in the order they are written. */
const KEYS = {
  D: 'D',
  s: 's',
  R: 'R',
  d: 'd',
  vtOverride: 'vt',
  thetaDeg: 'theta',
  phiDeg: 'phi',
  H: 'H',
  W: 'W',
  P: 'P',
} as const satisfies Record<keyof Params, string>;

const PARAM_KEYS = Object.keys(KEYS) as (keyof Params)[];

/** "s=6&theta=20", or an empty string when everything is at its default. */
export function encodeParams(p: Params): string {
  const parts: string[] = [];
  for (const key of PARAM_KEYS) {
    const value = p[key];
    if (value === DEFAULTS[key] || value === null) continue;
    // Trim float noise such as 0.30000000000000004.
    parts.push(`${KEYS[key]}=${Number(value.toFixed(4))}`);
  }
  return parts.join('&');
}

/** Reads a fragment (with or without the leading #). Unknown or invalid entries are ignored; values are clamped to their ranges. */
export function decodeParams(fragment: string): Params {
  const out: Params = { ...DEFAULTS };
  const query = new URLSearchParams(fragment.replace(/^#/, ''));
  for (const key of PARAM_KEYS) {
    const raw = query.get(KEYS[key]);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const { min, max } = RANGES[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  return out;
}
