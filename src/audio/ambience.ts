// Continuous layers: wind ambience and heartbeat.
import { scope, type Engine } from './context';
import { Scope, perc, tone } from './synth';

// ---------- Wind ----------

let windStop: (() => void) | null = null;

export function setWind(e: Engine, on: boolean): void {
  if (on) {
    if (windStop) return;
    windStop = startWind(e);
  } else {
    windStop?.();
    windStop = null;
  }
}

function startWind(e: Engine): () => void {
  const ctx = e.ctx;
  const s = new Scope(ctx, e.noise, ctx.currentTime + 0.01);
  const t = s.t;
  const FOREVER = t + 60 * 60 * 24;
  const master = s.gain(0, e.ambDuck);
  master.gain.setValueAtTime(0.0001, t);
  master.gain.linearRampToValueAtTime(1, t + 2);

  // Body: broad bandpassed noise with a slowly wandering centre and level
  const bodyG = s.gain(0.09, master);
  const bodyF = s.filter('bandpass', 420, 0.9, bodyG);
  s.noise(t, FOREVER, bodyF);
  const lfo1 = s.osc('sine', 0.071, t, FOREVER);
  lfo1.connect(s.gain(220, bodyF.frequency));
  const lfo2 = s.osc('sine', 0.13, t, FOREVER);
  lfo2.connect(s.gain(0.04, bodyG.gain));

  // Howl: a narrow resonant whistle that drifts
  const howlG = s.gain(0.025, master);
  const howlF = s.filter('bandpass', 850, 10, howlG);
  s.noise(t, FOREVER, howlF, 0.97);
  const lfo3 = s.osc('sine', 0.047, t, FOREVER);
  lfo3.connect(s.gain(260, howlF.frequency));
  const lfo4 = s.osc('triangle', 0.09, t, FOREVER);
  lfo4.connect(s.gain(0.022, howlG.gain));

  // Low rumble
  const lowG = s.gain(0.05, master);
  s.noise(t, FOREVER, s.filter('lowpass', 160, 0.7, lowG));

  return () => {
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
