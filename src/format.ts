const LOCALE = 'en-US';

/** Fixed number of decimals with thousands separators. */
export function fmt(value: number, decimals = 0): string {
  return value.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Up to `maxDecimals`, trailing zeros dropped. */
export function fmtTrim(value: number, maxDecimals: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: maxDecimals });
}

/** A count of drops: whole numbers once it is large enough not to need a decimal. */
export function fmtCount(value: number): string {
  return value >= 100 ? fmt(value) : fmtTrim(value, 1);
}

/** Seconds as "33.3 s" or "2 min 05 s". */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${fmt(seconds, 1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
}

/** Degrees with a true minus sign. */
export function fmtAngle(deg: number): string {
  const rounded = Math.round(deg);
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`;
}

export interface Ticks {
  values: number[];
  /** Decimals needed to show the step exactly. */
  decimals: number;
}

/** Round tick values (1, 2 or 5 × a power of ten apart) covering min..max. */
export function niceTicks(min: number, max: number, target = 5): Ticks {
  const span = max - min || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const values: number[] = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) values.push(i * step + 0); // + 0 turns -0 into 0
  return { values, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}
