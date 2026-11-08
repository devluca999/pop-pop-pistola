// Continuous layers: per-map ambience bed and heartbeat.
import type { MapId } from '../types';
import { scope, type Engine } from './context';
import { Scope, burst, perc, pluck, tone } from './synth';

// ---------- Ambience bed (per map) ----------
// The bed plays while wind(true) is on; setAmbience(map) picks which bed.

let windStop: (() => void) | null = null;
let bed: MapId = 'noon';

export function setWind(e: Engine, on: boolean): void {
  if (on) {
    if (windStop) return;
    windStop = startBed(e, bed);
  } else {
    windStop?.();
    windStop = null;
  }
}

/** Choose the map's ambience; crossfades if the bed is already playing. */
export function setAmbienceBed(e: Engine | null, id: MapId): void {
  if (id === bed) return;
  bed = id;
  if (e && windStop) {
    windStop();
    windStop = startBed(e, id);
  }
}

interface WindOpts { body: number; howl: number; howlF: number; low: number }
const WIND: Record<MapId, WindOpts> = {
  noon: { body: 0.09, howl: 0.025, howlF: 850, low: 0.05 },
  midnight: { body: 0.035, howl: 0.008, howlF: 600, low: 0.03 },
  train: { body: 0.05, howl: 0.01, howlF: 900, low: 0.06 },
  mesa: { body: 0.11, howl: 0.045, howlF: 720, low: 0.06 },
  saloon: { body: 0, howl: 0, howlF: 800, low: 0.015 },
};

function startBed(e: Engine, id: MapId): () => void {
  const ctx = e.ctx;
  const s = new Scope(ctx, e.noise, ctx.currentTime + 0.01);
  const t = s.t;
  const FOREVER = t + 60 * 60 * 24;
  const master = s.gain(0, e.ambDuck);
  master.gain.setValueAtTime(0.0001, t);
  master.gain.linearRampToValueAtTime(1, t + 2);
  const w = WIND[id];
  if (w.body > 0) {
    // Body: broad bandpassed noise with a slowly wandering centre and level
    const bodyG = s.gain(w.body, master);
    const bodyF = s.filter('bandpass', 420, 0.9, bodyG);
    s.noise(t, FOREVER, bodyF);
    s.osc('sine', 0.071, t, FOREVER).connect(s.gain(220, bodyF.frequency));
    s.osc('sine', 0.13, t, FOREVER).connect(s.gain(w.body * 0.45, bodyG.gain));
  }
  if (w.howl > 0) {
    // Howl: a narrow resonant whistle that drifts
    const howlG = s.gain(w.howl, master);
    const howlF = s.filter('bandpass', w.howlF, 10, howlG);
    s.noise(t, FOREVER, howlF, 0.97);
    s.osc('sine', 0.047, t, FOREVER).connect(s.gain(260, howlF.frequency));
    s.osc('triangle', 0.09, t, FOREVER).connect(s.gain(w.howl * 0.9, howlG.gain));
  }
  // Low rumble
  s.noise(t, FOREVER, s.filter('lowpass', 160, 0.7, s.gain(w.low, master)));

  const timers: ReturnType<typeof setInterval>[] = [];
  /** Schedule one-shot events a little ahead, like the heartbeat does. */
  const every = (minS: number, maxS: number, fire: (at: number) => void): void => {
    let next = ctx.currentTime + minS * Math.random();
    timers.push(setInterval(() => {
      try {
        const now = ctx.currentTime;
        if (next < now - 1) next = now + 0.1;
        while (next < now + 0.3) {
          fire(next);
          next += minS + Math.random() * (maxS - minS);
        }
      } catch { /* ignore */ }
    }, 100));
  };
  const at = (time: number): Scope => scope(e, Math.max(0, time - ctx.currentTime));

  if (id === 'midnight') {
    // crickets: short high chirps in little trains, two voices panned apart
    for (const pan of [-0.6, 0.5]) {
      const f = pan < 0 ? 4400 : 4900;
      every(0.5, 1.1, (time) => {
        const c = at(time);
        const out = c.panner(pan, c.gain(0.05, master));
        for (let i = 0; i < 3; i++) tone(c, out, { f, t: time + i * 0.055, a: 0.004, d: 0.03, g: 0.6 });
        c.finish();
      });
    }
    // an owl now and then, far off
    every(9, 18, (time) => {
      const c = at(time);
      const out = c.gain(0.04, master);
      tone(c, out, { f: 420, f2: 380, t: time, a: 0.05, d: 0.35, g: 1 });
      tone(c, out, { f: 400, f2: 360, t: time + 0.5, a: 0.05, d: 0.5, g: 0.9 });
      c.finish();
    });
  }
  if (id === 'train') {
    // idling engine off-screen: slow steam breathing
    const hissG = s.gain(0.02, master);
    s.noise(t, FOREVER, s.filter('bandpass', 2600, 0.8, hissG));
    s.osc('sine', 0.25, t, FOREVER).connect(s.gain(0.015, hissG.gain));
    // yard clanks and couplings
    every(3, 8, (time) => {
      const c = at(time);
      const out = c.panner(Math.random() * 1.4 - 0.4, c.gain(0.08, master));
      for (const f of [523, 811, 1290]) tone(c, out, { type: 'triangle', f: f * (0.9 + Math.random() * 0.2), t: time, d: 0.35, g: 0.25 });
      burst(c, out, { t: time, d: 0.04, g: 0.6, type: 'bandpass', f: 1500, q: 1.2 });
      c.finish();
    });
  }
  if (id === 'mesa') {
    // a distant coyote, rarely
    every(14, 26, (time) => {
      const c = at(time);
      const out = c.panner(-0.5, c.gain(0.025, master));
      const o = c.osc('triangle', 600, time, time + 1.4, out);
      o.frequency.setValueAtTime(600, time);
      o.frequency.linearRampToValueAtTime(1100, time + 0.5);
      o.frequency.exponentialRampToValueAtTime(700, time + 1.3);
      c.finish();
    });
  }
  if (id === 'saloon') {
    // crowd murmur: noise through shifting vowel formants, swelling and dipping
    const mur = s.gain(0.05, master);
    for (const [f, q, g] of [[500, 4, 1], [1100, 5, 0.6], [2400, 6, 0.25]] as const) {
      const bp = s.filter('bandpass', f, q, s.gain(g, mur));
      s.noise(t, FOREVER, bp, 0.9 + Math.random() * 0.2);
      s.osc('sine', 0.3 + Math.random() * 0.4, t, FOREVER).connect(s.gain(f * 0.15, bp.frequency));
    }
    s.osc('sine', 0.17, t, FOREVER).connect(s.gain(0.02, mur.gain));
    // honky-tonk piano: a walking left hand and right-hand chord stabs
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const root = 196;
    let step = 0;
    every(0.26, 0.34, (time) => {
      const c = at(time);
      const out = c.panner(-0.45, c.gain(0.07, master));
      step++;
      const bassDeg = [0, 7, 4, 7][step % 4];
      pluck(c, out, (root / 2) * Math.pow(2, bassDeg / 12), time, { g: 0.6, dur: 0.6, bright: 0.4 });
      if (step % 2 === 1 && Math.random() < 0.8) {
        const top = scale[Math.floor(Math.random() * scale.length)];
        for (const d of [0, 4, 7]) pluck(c, out, root * 2 * Math.pow(2, (top + d) / 12) * (1 + (Math.random() - 0.5) * 0.006), time, { g: 0.22, dur: 0.5, bright: 0.7 });
      }
      c.finish();
    });
    // the odd clink of glasses
    every(4, 9, (time) => {
      const c = at(time);
      const out = c.panner(Math.random() - 0.5, c.gain(0.03, master));
      for (const f of [2630, 4110]) tone(c, out, { f: f * (0.95 + Math.random() * 0.1), t: time, d: 0.3, g: 0.5 });
      c.finish();
    });
  }

  return () => {
    for (const tm of timers) clearInterval(tm);
    try {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.0001, now + 1.2);
      for (const n of s.nodes) {
        if (n instanceof AudioScheduledSourceNode) {
          try { n.stop(now + 1.3); } catch { /* ignore */ }
        }
      }
      s.end = now + 1.3;
      s.finish();
    } catch { /* ignore */ }
  };
}

// ---------- Heartbeat ----------

interface Heart { timer: ReturnType<typeof setInterval>; bpm: number; next: number }
let heart: Heart | null = null;

export function setHeartbeat(e: Engine, on: boolean, bpm?: number): void {
  const b = Math.max(30, Math.min(220, bpm && Number.isFinite(bpm) ? bpm : heart?.bpm ?? 72));
  if (!on) {
    if (heart) clearInterval(heart.timer);
    heart = null;
    return;
  }
  if (heart) {
    heart.bpm = b;
    return;
  }
  const h: Heart = { bpm: b, next: e.ctx.currentTime + 0.05, timer: 0 as unknown as ReturnType<typeof setInterval> };
  h.timer = setInterval(() => {
    try {
      const now = e.ctx.currentTime;
      if (h.next < now - 0.5) h.next = now + 0.05; // tab was suspended; resync
      while (h.next < now + 0.25) {
        beat(e, h.next, h.bpm);
        h.next += 60 / h.bpm;
      }
    } catch { /* ignore */ }
  }, 60);
  heart = h;
}

function beat(e: Engine, t: number, bpm: number): void {
  const s = scope(e, Math.max(0, t - e.ctx.currentTime - 0.01));
  const out = s.gain(0.9, e.sfx);
  const lp = s.filter('lowpass', 180, 0.8, out);
  const fast = Math.min(1, Math.max(0, (bpm - 60) / 100));
  const dub = 0.17 - 0.04 * fast;
  tone(s, lp, { f: 62, f2: 38, glide: 0.12, t, a: 0.008, d: 0.16, g: 0.9 });
  tone(s, lp, { f: 70, f2: 44, glide: 0.1, t: t + dub, a: 0.008, d: 0.13, g: 0.6 });
  const n = s.gain(0, lp);
  perc(n.gain, t, 0.25, 0.005, 0.08);
  s.noise(t, t + 0.12, n);
  s.finish();
}

export function stopAmbience(): void {
  windStop?.();
  windStop = null;
  if (heart) clearInterval(heart.timer);
  heart = null;
}
