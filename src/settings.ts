import type { FilterMode } from './types';

/** What a player holds. Prompts show that device's buttons. */
export type Device = 'keyboard' | 'gamepad';

export interface KeyBindings {
  prompt: string[]; // 6 KeyboardEvent.code values
  heal: string;
  feint: string;
  /** WHEEL draw action key. */
  action: string;
}
export interface PadBindings {
  prompt: number[]; // 6 standard-mapping button indices
  heal: number;
  feint: number;
  action: number;
}

export interface Settings {
  keys: [KeyBindings, KeyBindings];
  pads: [PadBindings, PadBindings];
  /** Last controller choice per player (P1, P2), remembered for the next match. */
  devices: [Device, Device];
  filter: FilterMode;
  crt: boolean;
  dither: number;
  reduceFlashing: boolean;
  reducedMotion: boolean;
  shake: boolean;
  volume: { master: number; music: number; sfx: number; voice: number };
}

export const DEFAULT_KEYS: [KeyBindings, KeyBindings] = [
  { prompt: ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD'], heal: 'KeyZ', feint: 'KeyX', action: 'Space' },
  { prompt: ['KeyU', 'KeyI', 'KeyO', 'KeyJ', 'KeyK', 'KeyL'], heal: 'KeyM', feint: 'Comma', action: 'Enter' },
];
export const DEFAULT_PADS: [PadBindings, PadBindings] = [
  { prompt: [0, 1, 2, 3, 4, 5], heal: 6, feint: 7, action: 0 },
  { prompt: [0, 1, 2, 3, 4, 5], heal: 6, feint: 7, action: 0 },
];

export function defaultSettings(): Settings {
  return {
    keys: structuredClone(DEFAULT_KEYS),
    pads: structuredClone(DEFAULT_PADS),
    devices: ['keyboard', 'keyboard'],
    filter: 'color',
    crt: false,
    dither: 1,
    reduceFlashing: false,
    reducedMotion: false,
    shake: true,
    volume: { master: 0.8, music: 0.6, sfx: 0.9, voice: 0.8 },
  };
}

const KEY = 'pop-pop-pistola.settings.v1';

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...d,
      ...s,
      keys: validKeys(s.keys) ?? d.keys,
      pads: validPads(s.pads) ?? d.pads,
      devices: validDevices(s.devices) ?? d.devices,
      volume: { ...d.volume, ...(s.volume ?? {}) },
      dither: Math.min(1, Math.max(0.35, Number(s.dither ?? d.dither) || d.dither)),
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}

function validKeys(k: unknown): [KeyBindings, KeyBindings] | null {
  if (!Array.isArray(k) || k.length !== 2) return null;
  for (const b of k) if (!b || !Array.isArray(b.prompt) || b.prompt.length !== 6 || !b.heal || !b.feint) return null;
  // older saves have no action key
  k.forEach((b: KeyBindings, i: number) => { if (!b.action) b.action = DEFAULT_KEYS[i].action; });
  return k as [KeyBindings, KeyBindings];
}
function validPads(k: unknown): [PadBindings, PadBindings] | null {
  if (!Array.isArray(k) || k.length !== 2) return null;
  for (const b of k) if (!b || !Array.isArray(b.prompt) || b.prompt.length !== 6) return null;
  k.forEach((b: PadBindings, i: number) => { if (typeof b.action !== 'number') b.action = DEFAULT_PADS[i].action; });
  return k as [PadBindings, PadBindings];
}

function validDevices(v: unknown): [Device, Device] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  return v.every((x) => x === 'keyboard' || x === 'gamepad') ? (v as [Device, Device]) : null;
}
