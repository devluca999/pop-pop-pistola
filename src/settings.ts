import type { FilterMode } from './types';

export interface KeyBindings {
  prompt: string[]; // 6 KeyboardEvent.code values
  heal: string;
  feint: string;
}
export interface PadBindings {
  prompt: number[]; // 6 standard-mapping button indices
  heal: number;
  feint: number;
}

export interface Settings {
  keys: [KeyBindings, KeyBindings];
  pads: [PadBindings, PadBindings];
  filter: FilterMode;
  crt: boolean;
  dither: number;
  reduceFlashing: boolean;
  reducedMotion: boolean;
  shake: boolean;
  volume: { master: number; music: number; sfx: number; voice: number };
}

export const DEFAULT_KEYS: [KeyBindings, KeyBindings] = [
  { prompt: ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD'], heal: 'KeyZ', feint: 'KeyX' },
  { prompt: ['KeyU', 'KeyI', 'KeyO', 'KeyJ', 'KeyK', 'KeyL'], heal: 'KeyM', feint: 'Comma' },
];
export const DEFAULT_PADS: [PadBindings, PadBindings] = [
  { prompt: [0, 1, 2, 3, 4, 5], heal: 6, feint: 7 },
  { prompt: [0, 1, 2, 3, 4, 5], heal: 6, feint: 7 },
];

export function defaultSettings(): Settings {
  return {
    keys: structuredClone(DEFAULT_KEYS),
    pads: structuredClone(DEFAULT_PADS),
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
  return k as [KeyBindings, KeyBindings];
}
function validPads(k: unknown): [PadBindings, PadBindings] | null {
  if (!Array.isArray(k) || k.length !== 2) return null;
  for (const b of k) if (!b || !Array.isArray(b.prompt) || b.prompt.length !== 6) return null;
  return k as [PadBindings, PadBindings];
}
