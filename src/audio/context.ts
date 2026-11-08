// AudioContext + mix bus graph.
//
//  sfx bus ──┐
//  ambDuck ──┤ (wind)        ┌─> compressor ─> destination
//  voice bus ┼──> master ────┘
//  music bus ┘  ^
//   ^ musicDuck  └── reverb return (convolver fed by reverbIn sends)

import { Scope, makeImpulse, makeNoise } from './synth';
import type { Volumes } from './types';

export interface Engine {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  voice: GainNode;
  /** Music tracks connect here (ducked). */
  musicDuck: GainNode;
  /** Ambience (wind) connects here (ducked, into sfx bus). */
  ambDuck: GainNode;
  /** Reverb send input. */
  reverbIn: GainNode;
  noise: AudioBuffer;
}

const BASE = { master: 0.9, music: 0.55, sfx: 0.9, voice: 0.8 } as const;
const vols: Volumes = { master: 1, music: 1, sfx: 1, voice: 1 };

let eng: Engine | null = null;

export function engine(): Engine | null {
  return eng;
}

export function ensureEngine(): Engine | null {
  if (eng) return eng;
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC({ latencyHint: 'interactive' });

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.connect(comp);
  const mk = (): GainNode => {
    const g = ctx.createGain();
    g.connect(master);
    return g;
  };
  const music = mk();
  const sfx = mk();
  const voice = mk();

  const musicDuck = ctx.createGain();
  musicDuck.connect(music);
  const ambDuck = ctx.createGain();
  ambDuck.connect(sfx);

  const reverbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 2.6, 3.2);
  const revOut = ctx.createGain();
  revOut.gain.value = 0.35;
  reverbIn.connect(conv);
  conv.connect(revOut);
  revOut.connect(master);

  eng = { ctx, master, music, sfx, voice, musicDuck, ambDuck, reverbIn, noise: makeNoise(ctx, 2) };
  applyVolumes();
  return eng;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);

export function setVolumes(v: Volumes): void {
  vols.master = clamp01(v.master);
  vols.music = clamp01(v.music);
  vols.sfx = clamp01(v.sfx);
  vols.voice = clamp01(v.voice);
  applyVolumes();
}

function applyVolumes(): void {
  if (!eng) return;
  const t = eng.ctx.currentTime;
  // squared curve feels more even on a linear slider
  const set = (g: GainNode, v: number, base: number): void => {
    g.gain.setTargetAtTime(v * v * base, t, 0.03);
  };
  set(eng.master, vols.master, BASE.master);
  set(eng.music, vols.music, BASE.music);
  set(eng.sfx, vols.sfx, BASE.sfx);
  set(eng.voice, vols.voice, BASE.voice);
}

let duckRelease = 0;

export function duck(amount: number, ms: number): void {
  if (!eng) return;
  const a = clamp01(amount);
  const level = Math.max(0.0001, 1 - a);
  const t = eng.ctx.currentTime;
  const hold = Math.max(0, ms) / 1000;
  const end = Math.max(duckRelease, t + hold);
  duckRelease = end;
  for (const g of [eng.musicDuck, eng.ambDuck]) {
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(level, t, 0.04);
    g.gain.setTargetAtTime(1, end, 0.35);
  }
}

/** New scope starting slightly in the future (avoids clicks from past-time automation). */
export function scope(e: Engine, delay = 0): Scope {
  return new Scope(e.ctx, e.noise, e.ctx.currentTime + 0.01 + Math.max(0, delay));
}

/** Per-sound output stage: gain -> pan -> bus, plus an optional reverb send. Returns the input node. */
export function makeOut(e: Engine, s: Scope, bus: AudioNode, pan = 0, gain = 1, rev = 0): GainNode {
  const g = s.gain(Math.max(0, gain));
  const p = s.panner(Number.isFinite(pan) ? pan : 0, bus);
  g.connect(p);
  if (rev > 0) {
    const send = s.gain(rev, e.reverbIn);
    p.connect(send);
  }
  return g;
}
