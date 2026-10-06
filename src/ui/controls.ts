// Sidebar controls, grouped as Trip / Rain / Wind / Person.

import {
  RAIN_PRESETS,
  RANGES,
  SPEED_PRESETS,
  autoFallSpeed,
  derive,
  msToKmh,
  msToMph,
  speedFromTime,
  type Params,
} from '../physics/physics';
import { fmt, fmtCount, fmtTrim } from '../format';
import type { Store } from '../state';

type NumericKey = 'D' | 's' | 'R' | 'd' | 'thetaDeg' | 'phiDeg' | 'H' | 'W' | 'P';

interface SliderSpec {
  key: NumericKey;
  label: string;
  unit: string;
  decimals: number;
  /** Space the slider logarithmically; for ranges that span decades. */
  log?: boolean;
  /** Captions for the two ends of the slider. */
  ends?: [string, string];
}

type Sync = (p: Params) => void;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, decimals: number) => Number(v.toFixed(decimals));

let nextId = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

interface Row {
  root: HTMLDivElement;
  number: HTMLInputElement;
  range: HTMLInputElement;
  note: HTMLDivElement;
}

/** Label, editable number with unit, and a slider beneath. */
function buildRow(label: string, unit: string, ends?: [string, string]): Row {
  const id = `control-${nextId++}`;
  const root = el('div', 'control');
  const head = el('div', 'control-head');
  const name = el('label', '', label);
  name.htmlFor = id;
  const field = el('span', 'control-field');
  const number = el('input');
  number.type = 'number';
  number.id = id;
  field.append(number, el('span', 'control-unit', unit));
  head.append(name, field);

  const range = el('input');
  range.type = 'range';
  range.setAttribute('aria-label', label);
  root.append(head, range);

  if (ends) {
    const captions = el('div', 'control-ends');
    captions.append(el('span', '', ends[0]), el('span', '', ends[1]));
    root.append(captions);
  }
  const note = el('div', 'control-note');
  root.append(note);
  return { root, number, range, note };
}

/** Writes a value into an input unless the user is in the middle of editing it. */
function show(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

function slider(store: Store, spec: SliderSpec): { row: Row; sync: Sync } {
  const { min, max } = RANGES[spec.key];
  const step = 10 ** -spec.decimals;
  const row = buildRow(spec.label, spec.unit, spec.ends);
  const { number, range } = row;

  number.min = String(min);
  number.max = String(max);
  number.step = String(step);

  // A log slider runs 0..1000 and maps exponentially onto min..max.
  const STEPS = 1000;
  const toPosition = (v: number) => (spec.log ? (STEPS * Math.log(v / min)) / Math.log(max / min) : v);
  const fromPosition = (pos: number) => (spec.log ? min * (max / min) ** (pos / STEPS) : pos);
  range.min = String(spec.log ? 0 : min);
  range.max = String(spec.log ? STEPS : max);
  range.step = String(spec.log ? 1 : step);

  const commit = (value: number) => {
    if (Number.isFinite(value)) store.set({ [spec.key]: clamp(round(value, spec.decimals), min, max) });
  };
  range.addEventListener('input', () => commit(fromPosition(Number(range.value))));
  number.addEventListener('change', () => {
    commit(Number(number.value));
    number.blur();
  });

  const sync: Sync = (p) => {
    const value = p[spec.key];
    show(number, String(round(value, spec.decimals)));
    show(range, String(toPosition(value)));
  };
  return { row, sync };
}

/** A row of one-tap preset values for a parameter; the matching one is marked as pressed. */
function presets(store: Store, key: 's' | 'R', values: Record<string, number>): { root: HTMLElement; sync: Sync } {
  const root = el('div', 'chips');
  const chips = Object.entries(values).map(([name, value]) => {
    const chip = el('button', 'chip', name);
    chip.type = 'button';
    chip.title = `${value} ${key === 's' ? 'm/s' : 'mm/h'}`;
    chip.addEventListener('click', () => store.set({ [key]: value }));
    root.append(chip);
    return { chip, value };
  });
  const sync: Sync = (p) => {
    for (const { chip, value } of chips) chip.setAttribute('aria-pressed', String(Math.abs(p[key] - value) < 1e-6));
  };
  return { root, sync };
}

function group(host: HTMLElement, title: string): HTMLElement {
  const section = el('section', 'control-group');
  section.append(el('h2', '', title));
  host.append(section);
  return section;
}

export function mountControls(host: HTMLElement, store: Store): void {
  const syncs: Sync[] = [];
  const add = (parent: HTMLElement, spec: SliderSpec) => {
    const s = slider(store, spec);
    parent.append(s.row.root);
    syncs.push(s.sync);
    return s.row;
  };

  // Trip
  const trip = group(host, 'Trip');
  add(trip, { key: 'D', label: 'Distance', unit: 'm', decimals: 0, log: true });
  const speed = add(trip, { key: 's', label: 'Speed', unit: 'm/s', decimals: 1 });
  const speedPresets = presets(store, 's', SPEED_PRESETS);
  speed.root.insertBefore(speedPresets.root, speed.note);
  syncs.push(speedPresets.sync, (p) => {
    speed.note.textContent = `${fmt(msToKmh(p.s), 1)} km/h · ${fmt(msToMph(p.s), 1)} mph`;
  });

  // Time to destination is derived, but editing it sets the speed.
  const timeRow = el('div', 'control');
  const timeHead = el('div', 'control-head');
  const timeLabel = el('label', '', 'Time to destination');
  const timeInput = el('input');
  timeInput.type = 'number';
  timeInput.id = `control-${nextId++}`;
  timeInput.step = '0.1';
  timeInput.min = '0';
  timeLabel.htmlFor = timeInput.id;
  const timeField = el('span', 'control-field');
  timeField.append(timeInput, el('span', 'control-unit', 's'));
  timeHead.append(timeLabel, timeField);
  timeRow.append(timeHead, el('div', 'control-note', 'Editing this sets the speed'));
  trip.append(timeRow);
  timeInput.addEventListener('change', () => {
    const T = Number(timeInput.value);
    if (T > 0) {
      const s = speedFromTime(store.params.D, T);
      store.set({ s: clamp(round(s, 2), RANGES.s.min, RANGES.s.max) });
    }
    timeInput.blur();
  });
  syncs.push((p) => show(timeInput, String(round(p.D / p.s, 1))));

  // Rain
  const rain = group(host, 'Rain');
  const rate = add(rain, { key: 'R', label: 'Rainfall rate', unit: 'mm/h', decimals: 1, log: true });
  const ratePresets = presets(store, 'R', RAIN_PRESETS);
  rate.root.insertBefore(ratePresets.root, rate.note);
  syncs.push(ratePresets.sync);
  add(rain, { key: 'd', label: 'Drop diameter', unit: 'mm', decimals: 1 });

  const fall = buildRow('Fall speed', 'm/s');
  const { min: vtMin, max: vtMax } = RANGES.vtOverride;
  for (const input of [fall.number, fall.range]) {
    input.min = String(vtMin);
    input.max = String(vtMax);
    input.step = '0.1';
  }
  const auto = el('label', 'control-check');
  const autoBox = el('input');
  autoBox.type = 'checkbox';
  auto.append(autoBox, 'Auto from drop diameter');
  fall.root.insertBefore(auto, fall.note);
  rain.append(fall.root);

  const setFall = (value: number) => {
    if (Number.isFinite(value)) store.set({ vtOverride: clamp(round(value, 1), vtMin, vtMax) });
  };
  fall.range.addEventListener('input', () => setFall(Number(fall.range.value)));
  fall.number.addEventListener('change', () => {
    setFall(Number(fall.number.value));
    fall.number.blur();
  });
  autoBox.addEventListener('change', () => {
    if (autoBox.checked) store.set({ vtOverride: null });
    else setFall(autoFallSpeed(store.params.d));
  });
  syncs.push((p) => {
    const isAuto = p.vtOverride === null;
    const d = derive(p);
    autoBox.checked = isAuto;
    fall.number.disabled = isAuto;
    fall.range.disabled = isAuto;
    show(fall.number, String(round(d.vt, isAuto ? 2 : 1)));
    show(fall.range, String(clamp(d.vt, vtMin, vtMax)));
    fall.note.textContent = `${fmtCount(d.n)} drops per m³, about ${fmtTrim(d.spacing * 100, 1)} cm apart`;
  });

  // Wind
  const wind = group(host, 'Wind');
  const angle = add(wind, {
    key: 'thetaDeg',
    label: 'Rain angle from vertical',
    unit: '°',
    decimals: 0,
    ends: ['into the rain', 'rain at your back'],
  });
  syncs.push((p) => {
    const { wx } = derive(p);
    angle.note.textContent =
      p.thetaDeg === 0
        ? 'Rain falls straight down'
        : `${wx > 0 ? 'Tailwind' : 'Headwind'}: rain drifts at ${fmt(Math.abs(derive(p).w), 1)} m/s`;
  });
  const advanced = el('details', 'control-advanced');
  advanced.append(el('summary', '', 'Crosswind (advanced)'));
  wind.append(advanced);
  add(advanced, {
    key: 'phiDeg',
    label: 'Crosswind heading',
    unit: '°',
    decimals: 0,
    ends: ['along your path', 'fully sideways'],
  });

  // Person
  const person = group(host, 'Person');
  add(person, { key: 'H', label: 'Height', unit: 'm', decimals: 2 });
  add(person, { key: 'W', label: 'Width', unit: 'm', decimals: 2 });
  add(person, { key: 'P', label: 'Depth', unit: 'm', decimals: 2 });

  store.subscribe((p) => {
    for (const sync of syncs) sync(p);
  });
}
