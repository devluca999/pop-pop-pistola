import type { FilterMode } from './types';

/** What a player holds. Prompts show that device's buttons. */
export type Device = 'keyboard' | 'gamepad' | 'touch';

/** Keyboard: four directions and ACTION (plus an optional second ACTION key). */
export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  action: string;
  action2?: string;
}

export interface Settings {
  keys: [KeyBindings, KeyBindings];
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
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', action: 'Enter', action2: 'ShiftRight' },
];

export function defaultSettings(): Settings {
  return {
    keys: structuredClone(DEFAULT_KEYS),
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
  // older saves used letter keys; they fall back to the new defaults
  for (const b of k) if (!b || ['up', 'down', 'left', 'right', 'action'].some((f) => typeof b[f] !== 'string')) return null;
  return k as [KeyBindings, KeyBindings];
}
function validDevices(v: unknown): [Device, Device] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  return v.every((x) => x === 'keyboard' || x === 'gamepad' || x === 'touch') ? (v as [Device, Device]) : null;
}
