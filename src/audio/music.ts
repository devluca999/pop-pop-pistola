// Procedural spaghetti-western music + drop-in custom music files.
import type { Engine } from './context';
import { Scope, burst, mtof, perc, pluck } from './synth';
import type { MusicTrack } from './types';

type Track = Exclude<MusicTrack, 'none'>;

interface Player { stop(fade: number): void }

let current: { track: MusicTrack; player: Player | null; custom: boolean } = { track: 'none', player: null, custom: false };

// ---------- Custom files ----------

const custom = new Map<Track, AudioBuffer>();
let customLoading = false;

/** Probe /audio/music/<track>.(mp3|ogg). 404s (and Vite's HTML fallback) are ignored silently. */
export function loadCustomMusic(e: Engine): void {
  if (customLoading || typeof fetch === 'undefined') return;
  customLoading = true;
  const base = `${import.meta.env?.BASE_URL ?? '/'}audio/music/`;
  const tracks: Track[] = ['title', 'duel', 'win', 'lose'];
  for (const tr of tracks) {
    void (async () => {
      for (const ext of ['mp3', 'ogg']) {
        try {
          const url = `${base}${tr}.${ext}`;
          const head = await fetch(url, { method: 'HEAD' });
          if (!head.ok || !isAudio(head.headers.get('content-type'))) continue;
          const res = await fetch(url);
          if (!res.ok || !isAudio(res.headers.get('content-type'))) continue;
          const buf = await e.ctx.decodeAudioData(await res.arrayBuffer());
          custom.set(tr, buf);
          // If this track is already playing procedurally (loops only), swap to the file.
          if (current.track === tr && !current.custom && (tr === 'title' || tr === 'duel')) {
            const want = current.track;
            current = { track: 'none', player: current.player, custom: false };
            playMusic(e, want);
          }
          return;
        } catch { /* missing / undecodable: keep procedural */ }
      }
    })();
  }
}

const isAudio = (ct: string | null): boolean => !!ct && (ct.startsWith('audio/') || ct.includes('ogg'));

function playBuffer(e: Engine, buf: AudioBuffer, loop: boolean): Player {
  const ctx = e.ctx;
  const g = ctx.createGain();
  g.connect(e.musicDuck);
  const t = ctx.currentTime + 0.02;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(1, t + 0.4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(g);
  src.start(t);
  src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } };
  return {
    stop(fade) {
      try {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0.0001, now + fade);
        src.stop(now + fade + 0.05);
      } catch { /* ignore */ }
    },
  };
}

// ---------- Public ----------

export function playMusic(e: Engine, track: MusicTrack): void {
  if (track === current.track && (current.player || track === 'none')) return;
  current.player?.stop(track === 'none' ? 0.8 : 0.5);
  current = { track, player: null, custom: false };
  if (track === 'none') return;
  const buf = custom.get(track);
  if (buf) {
    current.player = playBuffer(e, buf, track === 'title' || track === 'duel');
    current.custom = true;
    return;
  }
  current.player = PROC[track](e);
}

export function stopMusic(): void {
  current.player?.stop(0.3);
  current = { track: 'none', player: null, custom: false };
}

// ---------- Procedural instruments ----------

type Note = readonly [number | null, number]; // [midi | rest, beats]

/** Spaghetti-western whistle: sine with portamento, delayed vibrato and breath. */
function whistle(s: Scope, dest: AudioNode, notes: readonly Note[], t0: number, beat: number, gain: number): void {
  const total = notes.reduce((a, n) => a + n[1], 0) * beat;
  const end = t0 + total + 0.2;
  const amp = s.gain(0, dest);
  const osc = s.osc('sine', mtof(notes.find((n) => n[0] !== null)?.[0] ?? 76), t0, end, amp);
  const vib = s.osc('sine', 5.6, t0, end);
  const depth = s.gain(0, osc.frequency);
  vib.connect(depth);
  const breath = s.gain(0, dest);
  s.noise(t0, end, s.filter('bandpass', 2600, 2, breath));

  let t = t0;
  amp.gain.setValueAtTime(0.0001, t0);
  breath.gain.setValueAtTime(0, t0);
  let first = true;
  for (const [m, b] of notes) {
    const d = b * beat;
    if (m === null) {
      amp.gain.setTargetAtTime(0.0001, t, 0.03);
      breath.gain.setTargetAtTime(0, t, 0.03);
    } else {
      const f = mtof(m);
      if (first) {
        osc.frequency.setValueAtTime(f * 0.92, t);
        first = false;
      }
      osc.frequency.setTargetAtTime(f, t, 0.025);
      amp.gain.setTargetAtTime(gain, t, 0.02);
      amp.gain.setTargetAtTime(gain * 0.8, t + d * 0.6, 0.1);
      breath.gain.setTargetAtTime(gain * 0.04, t, 0.02);
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(d > 0.4 ? f * 0.014 : f * 0.004, t + Math.min(d, 0.35));
    }
    t += d;
  }
  amp.gain.setTargetAtTime(0.0001, t, 0.06);
  breath.gain.setTargetAtTime(0, t, 0.06);
}

/** Trumpet-ish lead: saw + square, filter swell, delayed vibrato. */
function brass(s: Scope, dest: AudioNode, m: number, t: number, d: number, g: number): void {
  const f = mtof(m);
  const amp = s.gain(0, dest);
  const lp = s.filter('lowpass', 800, 1.5, amp);
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.exponentialRampToValueAtTime(3200, t + 0.05);
  lp.frequency.exponentialRampToValueAtTime(1800, t + d);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(g, t + 0.025);
  amp.gain.setValueAtTime(g * 0.85, t + Math.max(0.03, d - 0.06));
  amp.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
  for (const [type, det, lvl] of [['sawtooth', -6, 1], ['square', 5, 0.5]] as const) {
    const o = s.osc(type, f, t, t + d + 0.15);
    o.detune.value = det;
    o.frequency.setValueAtTime(f * 0.96, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    o.connect(s.gain(lvl, lp));
    if (d > 0.3) {
      const vib = s.osc('sine', 5.5, t, t + d + 0.15);
      const vd = s.gain(0, o.frequency);
      vd.gain.setValueAtTime(0, t + 0.15);
      vd.gain.linearRampToValueAtTime(f * 0.015, t + d);
      vib.connect(vd);
    }
  }
}

function strum(s: Scope, dest: AudioNode, chord: readonly number[], t: number, g: number, spread = 0.018): void {
  chord.forEach((m, i) => pluck(s, dest, mtof(m), t + i * spread, { g: g * (i === 0 ? 1 : 0.7), dur: 1.8, damp: 0.995, bright: 0.55 }));
}

function rimTick(s: Scope, dest: AudioNode, t: number, g: number): void {
  burst(s, dest, { t, d: 0.015, g, type: 'highpass', f: 6000 });
}

// ---------- Bar sequencer ----------

type BarFn = (s: Scope, out: AudioNode, bar: number, t: number, beat: number) => void;

function sequencer(e: Engine, bpm: number, beats: number, barFn: BarFn, level: number): Player {
  const ctx = e.ctx;
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(e.musicDuck);
  const rev = ctx.createGain();
  rev.gain.value = 0.35;
  out.connect(rev);
  rev.connect(e.reverbIn);
  const beat = 60 / bpm;
  let next = ctx.currentTime + 0.08;
  let bar = 0;
  const tick = (): void => {
    try {
      const now = ctx.currentTime;
      if (next < now - 1) next = now + 0.05; // resync after suspension
      while (next < now + 0.35) {
        const s = new Scope(ctx, e.noise, next);
        barFn(s, out, bar, next, beat);
        s.finish();
        next += beats * beat;
        bar++;
      }
    } catch { /* ignore */ }
  };
  tick();
  const timer = setInterval(tick, 80);
  return {
    stop(fade) {
      clearInterval(timer);
      try {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0.0001, now + fade);
      } catch { /* ignore */ }
      setTimeout(() => { try { out.disconnect(); rev.disconnect(); } catch { /* ignore */ } }, (fade + beats * beat + 2.5) * 1000);
    },
  };
}

function oneShot(e: Engine, fn: (s: Scope, out: AudioNode) => void, level: number): Player {
  const ctx = e.ctx;
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(e.musicDuck);
  const rev = ctx.createGain();
  rev.gain.value = 0.35;
  out.connect(rev);
  rev.connect(e.reverbIn);
  const s = new Scope(ctx, e.noise, ctx.currentTime + 0.05);
  fn(s, out);
  s.finish();
  setTimeout(() => { try { out.disconnect(); rev.disconnect(); } catch { /* ignore */ } }, (s.end - ctx.currentTime + 3) * 1000);
  return {
    stop(fade) {
      try {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0.0001, now + fade);
      } catch { /* ignore */ }
    },
  };
}

// ---------- Tracks ----------

const Am = [45, 57, 60, 64] as const;
const G = [43, 55, 59, 62] as const;
const E = [40, 56, 59, 64] as const;
const Dm = [38, 57, 62, 65] as const;

// Original whistle tune, A minor, 4 bars of 4/4.
const TITLE_THEME: readonly Note[] = [
  [76, 1.5], [81, 0.5], [76, 1], [74, 0.5], [72, 0.5],
  [71, 2], [null, 1], [69, 0.5], [71, 0.5],
  [72, 1.5], [74, 0.5], [76, 1], [79, 0.5], [77, 0.5],
  [76, 3], [null, 1],
];
const TITLE_ANSWER: readonly Note[] = [[76, 1.5], [74, 0.5], [72, 1], [71, 1], [69, 3], [null, 1]];
const TWANG_LICK = [45, 52, 57, 60, 59, 57, 52, 45] as const;
const LOOP_CHORDS = [Am, Am, G, E, Am, Am, Dm, E] as const;
const INTRO_CHORDS = [Am, E, Am, E] as const;

const titleBar: BarFn = (s, out, bar, t, beat) => {
  if (bar < 4) {
    if (bar === 0) whistle(s, out, TITLE_THEME, t, beat, 0.32);
    const ch = INTRO_CHORDS[bar]!;
    pluck(s, out, mtof(ch[0]), t, { g: 0.5, dur: 2.2, damp: 0.996, bright: 0.4, bend: 0.97 });
    strum(s, out, ch.slice(1), t + beat * 2, 0.18);
    return;
  }
  if (bar === 4) {
    // twangy guitar motif with bends
    TWANG_LICK.forEach((m, i) => {
      pluck(s, out, mtof(m), t + i * beat * 0.5, { g: 0.42, dur: 1.4, damp: 0.995, bright: 0.85, bend: i % 3 === 2 ? 0.94 : 0.985 });
    });
    return;
  }
  // quiet loop
  const lb = (bar - 5) % 8;
  const ch = LOOP_CHORDS[lb]!;
  pluck(s, out, mtof(ch[0]), t, { g: 0.32, dur: 2, damp: 0.996, bright: 0.35 });
  pluck(s, out, mtof(ch[0] + 7), t + beat * 2, { g: 0.22, dur: 1.6, damp: 0.996, bright: 0.35 });
  const arp = [1, 2, 3, 2, 1, 2, 3, 2];
  arp.forEach((idx, i) => {
    if (i === 0 || i === 4) return;
    pluck(s, out, mtof(ch[idx]!), t + i * beat * 0.5, { g: 0.09, dur: 1.2, damp: 0.994, bright: 0.5 });
  });
  if (lb === 4) whistle(s, out, TITLE_ANSWER, t, beat, 0.16);
  if (lb === 7) pluck(s, out, mtof(64), t + beat * 3, { g: 0.2, dur: 1.4, bright: 0.85, bend: 0.93 });
};

const DUEL_BASS = [
  [[0, 33], [1.5, 33], [2, 36], [3, 28]],
  [[0, 33], [1.5, 33], [2, 40], [3, 38]],
] as const;

const duelBar: BarFn = (s, out, bar, t, beat) => {
  for (const [b, m] of DUEL_BASS[bar % 2]!) {
    pluck(s, out, mtof(m + 12), t + b * beat, { g: 0.55, dur: 1.6, damp: 0.994, bright: 0.3, bend: 0.99 });
  }
  for (let i = 0; i < 4; i++) rimTick(s, out, t + i * beat, i === 0 ? 0.05 : 0.03);
  if (bar >= 2 && Math.random() < 0.3) {
    const m = Math.random() < 0.5 ? 64 : 69;
    pluck(s, out, mtof(m), t + beat * (Math.random() < 0.5 ? 1 : 3), { g: 0.2, dur: 1.6, bright: 0.9, bend: 0.88 });
  }
  if (bar % 8 === 4) whistle(s, out, [[76, 3], [74, 1], [null, 1]], t, beat, 0.07);
};

const winStinger = (s: Scope, out: AudioNode): void => {
  const t = s.t;
  const b = 0.16;
  brass(s, out, 67, t, b * 0.9, 0.22);
  brass(s, out, 72, t + b, b * 0.9, 0.22);
  brass(s, out, 76, t + b * 2, b * 0.9, 0.22);
  brass(s, out, 79, t + b * 3, 1.1, 0.26);
  brass(s, out, 76, t + b * 3, 1.1, 0.12);
  strum(s, out, [48, 55, 60, 64, 67], t + b * 3, 0.3, 0.012);
  // timpani-ish hits
  for (const [dt, g] of [[0, 0.5], [b * 3, 0.8]] as const) {
    const amp = s.gain(0, out);
    perc(amp.gain, t + dt, g, 0.005, 0.6);
    const o = s.osc('sine', 98, t + dt, t + dt + 0.7, amp);
    o.frequency.exponentialRampToValueAtTime(80, t + dt + 0.5);
  }
};

const loseStinger = (s: Scope, out: AudioNode): void => {
  // sad trombone: wah wah wah waaaah
  const notes: [number, number][] = [[58, 0.42], [57, 0.42], [56, 0.42], [55, 1.5]];
  let t = s.t;
  for (const [m, d] of notes) {
    const f = mtof(m);
    const amp = s.gain(0, out);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.3, t + 0.05);
    amp.gain.setValueAtTime(0.27, t + d - 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    const lp = s.filter('lowpass', 300, 4, amp);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1300, t + Math.min(0.2, d * 0.5));
    lp.frequency.exponentialRampToValueAtTime(500, t + d);
    const o = s.osc('sawtooth', f, t, t + d + 0.1, lp);
    o.frequency.setValueAtTime(f * 1.03, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    if (d > 1) {
      const wob = s.osc('sine', 5.5, t + 0.2, t + d + 0.1);
      wob.connect(s.gain(f * 0.03, o.frequency));
      const wah = s.osc('sine', 5.5, t + 0.2, t + d + 0.1);
      wah.connect(s.gain(450, lp.frequency));
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + d);
    }
    t += d + 0.04;
  }
};

const PROC: Record<Track, (e: Engine) => Player> = {
  title: (e) => sequencer(e, 96, 4, titleBar, 0.9),
  duel: (e) => sequencer(e, 72, 4, duelBar, 0.55),
  win: (e) => oneShot(e, winStinger, 0.9),
  lose: (e) => oneShot(e, loseStinger, 0.9),
};
