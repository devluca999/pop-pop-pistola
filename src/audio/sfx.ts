// Procedural one-shot sound effects. Each recipe draws into a Scope and an output node.
import { makeOut, scope, type Engine } from './context';
import { rnd } from './rng';
import { Scope, ahr, burst, mtof, perc, sweep, tone } from './synth';
import type { SfxName, SfxOptions } from './types';

type Recipe = (s: Scope, out: GainNode, r: number) => void;

/** A formant-filtered voice-ish bank: input -> parallel bandpasses -> out. */
function formantBank(s: Scope, out: AudioNode, formants: readonly (readonly [number, number, number])[]): GainNode {
  const input = s.gain(1);
  for (const [f, q, g] of formants) {
    const bp = s.filter('bandpass', f, q);
    const gg = s.gain(g, out);
    input.connect(bp);
    bp.connect(gg);
  }
  return input;
}

const VOWEL_AH = [[750, 6, 3], [1150, 8, 2], [2700, 10, 1]] as const;
const VOWEL_OO = [[350, 6, 3.5], [800, 8, 1.6], [2300, 10, 0.5]] as const;
const VOWEL_EH = [[550, 6, 3], [1800, 9, 2], [2600, 10, 1]] as const;

/** Little "canyon echo" of a gunshot: a dark delayed burst. */
function echo(s: Scope, out: AudioNode, t: number, g: number, d: number): void {
  burst(s, out, { t, a: 0.01, d, g, type: 'lowpass', f: 900, f2: 200, q: 0.7 });
}

const recipes: Record<SfxName, Recipe> = {
  bellToll: (s, o, r) => {
    const t = s.t;
    const base = 196 * r;
    // [ratio, gain, decay seconds] - inharmonic church bell partials
    const partials: [number, number, number][] = [
      [0.5, 0.45, 7], [1, 0.55, 5], [1.183, 0.38, 3.6], [1.506, 0.24, 3], [2, 0.38, 2.6],
      [2.514, 0.18, 1.9], [2.662, 0.12, 1.7], [3.011, 0.13, 1.4], [4.166, 0.1, 1.0], [5.433, 0.07, 0.7], [6.796, 0.05, 0.5],
    ];
    for (const [ratio, g, d] of partials) {
      tone(s, o, { f: base * ratio, t, a: 0.002, d, g: g * 0.5 });
      // detuned twin -> slow beating "wah-wah" shimmer of a real bell
      if (ratio <= 2) tone(s, o, { f: base * ratio + 0.6 + ratio * 0.9, t, a: 0.002, d: d * 0.9, g: g * 0.25 });
    }
    // clapper strike
    burst(s, o, { t, d: 0.05, g: 0.5, type: 'bandpass', f: 3200, q: 1.5 });
    tone(s, o, { type: 'triangle', f: base * 8.1, t, d: 0.12, g: 0.12 });
  },

  gunshot: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, d: 0.03, g: 0.9, type: 'highpass', f: 2500 * r });
    burst(s, o, { t, d: 0.32, g: 1.1, type: 'lowpass', f: 7000 * r, f2: 300, sweepT: 0.25, q: 0.8 });
    tone(s, o, { f: 150 * r, f2: 38, glide: 0.12, t, d: 0.26, g: 1 });
    echo(s, o, t + 0.34, 0.25, 0.35);
    echo(s, o, t + 0.7, 0.1, 0.4);
  },

  shotgun: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, d: 0.05, g: 1, type: 'highpass', f: 1800 * r });
    burst(s, o, { t, d: 0.75, g: 1.3, type: 'lowpass', f: 5000 * r, f2: 140, sweepT: 0.6, q: 0.7 });
    burst(s, o, { t: t + 0.012, d: 0.4, g: 0.6, type: 'bandpass', f: 900 * r, q: 0.6 });
    tone(s, o, { f: 110 * r, f2: 28, glide: 0.25, t, d: 0.55, g: 1.2 });
    echo(s, o, t + 0.42, 0.35, 0.6);
    echo(s, o, t + 0.9, 0.15, 0.6);
  },

  click: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, d: 0.012, g: 0.7, type: 'highpass', f: 3500 * r });
    tone(s, o, { type: 'square', f: 2100 * r, t, d: 0.012, g: 0.12 });
    burst(s, o, { t: t + 0.045, d: 0.02, g: 0.45, type: 'bandpass', f: 2500 * r, q: 3 });
  },

  jam: (s, o, r) => {
    const t = s.t;
    for (const f of [312, 527, 811, 1247, 1733]) tone(s, o, { type: 'triangle', f: f * r, t, d: 0.16, g: 0.16 });
    burst(s, o, { t, d: 0.09, g: 0.6, type: 'lowpass', f: 900 * r });
    for (let i = 0; i < 7; i++) {
      const tt = t + 0.06 + i * 0.035 + rnd(0, 0.02);
      burst(s, o, { t: tt, d: 0.015, g: 0.35 * (1 - i / 9), type: 'bandpass', f: rnd(2500, 4200) * r, q: 4 });
    }
  },

  crow: (s, o, r) => {
    const n = Math.random() < 0.5 ? 2 : 3;
    const bank = formantBank(s, o, [[1300 * r, 4, 1.6], [2600 * r, 6, 1], [700 * r, 3, 0.6]]);
    for (let i = 0; i < n; i++) {
      const t = s.t + i * 0.3 + rnd(0, 0.05);
      const dur = rnd(0.17, 0.25);
      const g = s.gain(0, bank);
      ahr(g.gain, t, 0.8, 0.02, dur * 0.6, dur * 0.4, 0.7);
      const osc = s.osc('sawtooth', 620 * r, t, t + dur + 0.05, g);
      sweep(osc.frequency, t, rnd(600, 680) * r, rnd(400, 460) * r, dur);
      // rasp: fast square FM
      const lfo = s.osc('square', rnd(45, 70), t, t + dur + 0.05);
      const depth = s.gain(90 * r, osc.frequency);
      lfo.connect(depth);
      burst(s, bank, { t, a: 0.02, d: dur, g: 0.35, type: 'bandpass', f: 1800 * r, q: 1 });
    }
  },

  tumbleweed: (s, o, r) => {
    const t = s.t;
    const dur = 1.4;
    const pan = s.panner(-0.7, o);
    pan.pan.linearRampToValueAtTime(0.7, t + dur);
    const g = s.gain(0, pan);
    ahr(g.gain, t, 0.5, 0.3, 0.7, 0.4, 0.8);
    const f = s.filter('bandpass', 900 * r, 1.2, g);
    f.frequency.setValueAtTime(900 * r, t);
    f.frequency.linearRampToValueAtTime(2600 * r, t + 0.6);
    f.frequency.linearRampToValueAtTime(1300 * r, t + dur);
    s.noise(t, t + dur + 0.1, f);
    // twiggy crackles
    for (let i = 0; i < 14; i++) {
      burst(s, pan, { t: t + rnd(0.05, dur), d: 0.012, g: rnd(0.08, 0.2), type: 'highpass', f: rnd(3000, 6000) });
    }
  },

  door: (s, o, r) => {
    const t = s.t;
    // creak
    const cg = s.gain(0, o);
    ahr(cg.gain, t, 0.3, 0.05, 0.25, 0.05, 0.9);
    const bp = s.filter('bandpass', 1200 * r, 7, cg);
    const creak = s.osc('sawtooth', 70 * r, t, t + 0.4, bp);
    creak.frequency.setValueAtTime(60 * r, t);
    creak.frequency.linearRampToValueAtTime(110 * r, t + 0.15);
    creak.frequency.linearRampToValueAtTime(80 * r, t + 0.32);
    // bang + saloon flaps
    const bangs: [number, number][] = [[0.36, 1], [0.58, 0.45], [0.74, 0.25], [0.86, 0.12]];
    for (const [dt, g] of bangs) {
      burst(s, o, { t: t + dt, d: 0.12, g: g * 0.9, type: 'lowpass', f: 900 * r, q: 0.8 });
      tone(s, o, { f: 95 * r, f2: 50, glide: 0.1, t: t + dt, d: 0.14, g: g * 0.8 });
      burst(s, o, { t: t + dt, d: 0.02, g: g * 0.3, type: 'bandpass', f: 2200 * r, q: 2 });
    }
  },

  cough: (s, o, r) => {
    const n = Math.random() < 0.4 ? 2 : 3;
    const bank = formantBank(s, o, [[600 * r, 3, 2.2], [1100 * r, 5, 1.4], [2400 * r, 6, 0.6]]);
    for (let i = 0; i < n; i++) {
      const t = s.t + i * rnd(0.2, 0.26);
      const g = 1 - i * 0.25;
      burst(s, bank, { t, a: 0.004, d: 0.16, g: 0.9 * g, type: 'lowpass', f: 3500, q: 0.5 });
      tone(s, bank, { type: 'sawtooth', f: 125 * r, f2: 95 * r, t, a: 0.005, d: 0.12, g: 0.25 * g });
    }
  },

  spurs: (s, o, r) => {
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = s.t + i * 0.035 + rnd(0, 0.03) + (i > n / 2 ? 0.08 : 0);
      for (const f of [4200, 5350, 6150]) tone(s, o, { f: f * rnd(0.97, 1.03) * r, t, d: rnd(0.08, 0.16), g: 0.05 });
    }
  },

  glassClink: (s, o, r) => {
    for (const [dt, g] of [[0, 1], [0.09, 0.55]] as const) {
      const t = s.t + dt;
      for (const [f, gg, d] of [[2630, 0.2, 0.6], [4110, 0.12, 0.45], [5920, 0.07, 0.3], [7800, 0.04, 0.2]] as const) {
        tone(s, o, { f: f * r * (1 + dt), t, d, g: gg * g });
      }
      burst(s, o, { t, d: 0.01, g: 0.2 * g, type: 'highpass', f: 6000 });
    }
  },

  cigarPuff: (s, o, r) => {
    const t = s.t;
    const g = s.gain(0, o);
    ahr(g.gain, t, 0.35, 0.12, 0.25, 0.4, 0.6);
    const f = s.filter('lowpass', 700 * r, 1, g);
    sweep(f.frequency, t, 500 * r, 1400 * r, 0.25);
    s.noise(t, t + 0.9, f);
    for (let i = 0; i < 5; i++) burst(s, o, { t: t + rnd(0, 0.3), d: 0.008, g: 0.06, type: 'highpass', f: 5000 });
  },

  lanternWhoosh: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, a: 0.05, d: 0.45, g: 0.8, type: 'lowpass', f: 200 * r, f2: 1800 * r, sweepT: 0.3, q: 1.5 });
    tone(s, o, { f: 70 * r, f2: 120 * r, glide: 0.2, t, a: 0.03, d: 0.4, g: 0.5 });
    for (let i = 0; i < 6; i++) {
      const tt = t + 0.15 + i * 0.06;
      const osc = tone(s, o, { f: rnd(2000, 4200) * r, t: tt, a: 0.02, d: rnd(0.4, 0.8), g: 0.04 });
      osc.detune.value = rnd(-20, 20);
    }
  },

  choir: (s, o, r) => {
    const t = s.t;
    const dur = 2.5;
    const amp = s.gain(0, o);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.5, t + 0.7);
    amp.gain.setValueAtTime(0.5, t + dur - 0.9);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bank = formantBank(s, amp, VOWEL_AH);
    // D major chord, "aah" - heavenly
    for (const m of [50, 57, 62, 66, 69, 74]) {
      for (const det of [-9, 0, 8]) {
        const osc = s.osc('sawtooth', mtof(m) * r, t, t + dur + 0.05);
        osc.detune.value = det;
        const g = s.gain(0.09, bank);
        osc.connect(g);
      }
    }
    const lfo = s.osc('sine', 5, t, t + dur);
    lfo.connect(s.gain(0.04, amp.gain));
  },

  boo: (s, o, r) => {
    const bank = formantBank(s, o, VOWEL_OO);
    for (let i = 0; i < 6; i++) {
      const t = s.t + rnd(0, 0.25);
      const dur = rnd(1.0, 1.4);
      const f0 = rnd(110, 210) * r;
      const g = s.gain(0, bank);
      ahr(g.gain, t, 0.22, 0.12, dur - 0.4, 0.3, 0.8);
      const osc = s.osc('sawtooth', f0, t, t + dur + 0.05, g);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f0 * 1.04, t + 0.15);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + dur);
      const vib = s.osc('sine', rnd(4, 6.5), t, t + dur);
      vib.connect(s.gain(f0 * 0.02, osc.frequency));
    }
  },

  cheer: (s, o, r) => {
    const bank = formantBank(s, o, VOWEL_EH);
    for (let i = 0; i < 7; i++) {
      const t = s.t + rnd(0, 0.15);
      const dur = rnd(0.5, 0.8);
      const f0 = rnd(180, 380) * r;
      const g = s.gain(0, bank);
      ahr(g.gain, t, 0.16, 0.05, dur - 0.25, 0.2, 0.7);
      const osc = s.osc('sawtooth', f0, t, t + dur + 0.05, g);
      osc.frequency.setValueAtTime(f0 * 0.8, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + dur * 0.6);
    }
    // a few claps
    for (let i = 0; i < 10; i++) burst(s, o, { t: s.t + rnd(0.05, 0.8), d: 0.03, g: 0.25, type: 'bandpass', f: rnd(1200, 2000), q: 1.5 });
  },

  heartCrack: (s, o, r) => {
    const t = s.t;
    for (let i = 0; i < 9; i++) burst(s, o, { t: t + i * 0.025 + rnd(0, 0.02), d: 0.03, g: rnd(0.3, 0.7), type: 'bandpass', f: rnd(1500, 4000) * r, q: 2 });
    const shaper = s.add(s.ctx.createWaveShaper());
    shaper.curve = crunchCurve();
    const g = s.gain(0, o);
    shaper.connect(g);
    perc(g.gain, t, 0.25, 0.005, 0.35);
    const osc = s.osc('square', 520 * r, t, t + 0.4, shaper);
    sweep(osc.frequency, t, 520 * r, 130 * r, 0.35);
    tone(s, o, { f: 80 * r, f2: 45, t, d: 0.2, g: 0.6 });
  },

  hit: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, d: 0.08, g: 0.9, type: 'bandpass', f: 1400 * r, q: 0.9 });
    burst(s, o, { t, d: 0.02, g: 0.6, type: 'highpass', f: 3000 * r });
    tone(s, o, { f: 230 * r, f2: 70, glide: 0.1, t, d: 0.14, g: 0.9 });
  },

  fall: (s, o, r) => {
    const t = s.t;
    for (const [dt, g] of [[0, 1], [0.17, 0.4]] as const) {
      tone(s, o, { f: 95 * r, f2: 38, glide: 0.18, t: t + dt, d: 0.32, g: g });
      burst(s, o, { t: t + dt, d: 0.25, g: 0.7 * g, type: 'lowpass', f: 450 * r });
    }
    burst(s, o, { t: t + 0.05, a: 0.08, d: 0.8, g: 0.18, type: 'bandpass', f: 2200, q: 0.6 });
  },

  hatFly: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, a: 0.06, d: 0.45, g: 0.5, type: 'bandpass', f: 400 * r, f2: 3200 * r, sweepT: 0.45, q: 2 });
    tone(s, o, { type: 'triangle', f: 500 * r, f2: 1500 * r, glide: 0.4, t, a: 0.05, d: 0.45, g: 0.12 });
  },

  promptGood: (s, o, r) => {
    tone(s, o, { type: 'triangle', f: 880 * r, t: s.t, d: 0.07, g: 0.35 });
    tone(s, o, { type: 'triangle', f: 1320 * r, t: s.t + 0.06, d: 0.12, g: 0.35 });
  },

  promptBad: (s, o, r) => {
    const t = s.t;
    const lp = s.filter('lowpass', 1300, 1, o);
    tone(s, lp, { type: 'sawtooth', f: 140 * r, f2: 115 * r, t, d: 0.22, g: 0.4 });
    tone(s, lp, { type: 'square', f: 148 * r, f2: 118 * r, t, d: 0.22, g: 0.25 });
  },

  flinch: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, a: 0.01, d: 0.12, g: 0.4, type: 'bandpass', f: 1200 * r, f2: 2400 * r, q: 2 });
    const osc = tone(s, o, { type: 'triangle', f: 420 * r, f2: 260 * r, t, d: 0.2, g: 0.3 });
    const lfo = s.osc('sine', 22, t, t + 0.25);
    lfo.connect(s.gain(30, osc.frequency));
  },

  perfect: (s, o, r) => {
    const t = s.t;
    for (const m of [79, 86, 91]) tone(s, o, { f: mtof(m) * r, t, d: 0.9, g: 0.16 });
    [100, 105, 108, 112].forEach((m, i) => tone(s, o, { f: mtof(m - 12) * r, t: t + 0.05 + i * 0.045, d: 0.3, g: 0.07 }));
  },

  uiMove: (s, o, r) => {
    tone(s, o, { type: 'triangle', f: 1200 * r, t: s.t, d: 0.03, g: 0.18 });
  },

  uiSelect: (s, o, r) => {
    tone(s, o, { type: 'triangle', f: 660 * r, t: s.t, d: 0.06, g: 0.3 });
    tone(s, o, { type: 'triangle', f: 990 * r, t: s.t + 0.06, d: 0.1, g: 0.3 });
  },

  uiBack: (s, o, r) => {
    tone(s, o, { type: 'triangle', f: 660 * r, t: s.t, d: 0.06, g: 0.25 });
    tone(s, o, { type: 'triangle', f: 440 * r, t: s.t + 0.06, d: 0.1, g: 0.25 });
  },

  pop: (s, o, r) => {
    const t = s.t;
    tone(s, o, { f: 380 * r, f2: 1500 * r, glide: 0.03, t, a: 0.001, d: 0.09, g: 0.7 });
    burst(s, o, { t, d: 0.015, g: 0.5, type: 'bandpass', f: 1800 * r, q: 1.5 });
  },

  fuego: (s, o, r) => {
    const t = s.t;
    const amp = s.gain(0, o);
    ahr(amp.gain, t, 0.5, 0.015, 0.22, 0.45, 0.7);
    const lp = s.filter('lowpass', 400, 2, amp);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(3800 * r, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1100 * r, t + 0.5);
    for (const m of [38, 50, 54, 57, 62]) {
      const f = mtof(m) * r;
      for (const det of [-7, 7]) {
        const osc = s.osc('sawtooth', f, t, t + 0.75, lp);
        osc.detune.value = det;
        osc.frequency.setValueAtTime(f * 0.94, t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      }
    }
    burst(s, o, { t, d: 0.12, g: 0.6, type: 'lowpass', f: 1500 });
    tone(s, o, { f: 90, f2: 45, t, d: 0.2, g: 0.6 });
  },

  feint: (s, o, r) => {
    for (let i = 0; i < 3; i++) {
      burst(s, o, { t: s.t + i * 0.05 + rnd(0, 0.015), a: 0.008, d: 0.06, g: 0.3, type: 'bandpass', f: rnd(800, 1700) * r, q: 2 });
    }
  },

  blind: (s, o, r) => {
    const t = s.t;
    burst(s, o, { t, a: 0.05, d: 0.4, g: 0.5, type: 'highpass', f: 2000 * r, f2: 8000 * r, sweepT: 0.3 });
    const ring = tone(s, o, { f: 3500 * r, t: t + 0.05, a: 0.05, d: 1.3, g: 0.12 });
    s.osc('sine', 6, t, t + 1.4).connect(s.gain(25, ring.frequency));
    tone(s, o, { f: 6100 * r, t: t + 0.1, a: 0.2, d: 1.2, g: 0.03 });
  },

  vaporize: (s, o, r) => {
    const t = s.t;
    const lp = s.filter('lowpass', 3000, 3, o);
    sweep(lp.frequency, t, 600, 6000, 0.35);
    const z = tone(s, lp, { type: 'square', f: 200 * r, f2: 2400 * r, glide: 0.35, t, d: 0.4, g: 0.3 });
    const lfo = s.osc('sine', 30, t, t + 0.45);
    lfo.connect(s.gain(120, z.frequency));
    for (let i = 0; i < 8; i++) tone(s, o, { f: rnd(2500, 6000) * r, t: t + 0.3 + rnd(0, 0.4), d: rnd(0.1, 0.25), g: 0.06 });
  },

  heal: (s, o, r) => {
    [72, 76, 79, 84, 88].forEach((m, i) => {
      const t = s.t + i * 0.075;
      tone(s, o, { type: 'triangle', f: mtof(m) * r, t, a: 0.01, d: 0.6, g: 0.18 });
      tone(s, o, { f: mtof(m + 12) * r, t, a: 0.01, d: 0.4, g: 0.05 });
    });
  },

  // ---------- Prompt types ----------

  tapTick: (s, o, r) => {
    burst(s, o, { t: s.t, d: 0.02, g: 0.6, type: 'bandpass', f: 3800 * r, q: 3 });
    tone(s, o, { type: 'triangle', f: 1900 * r, t: s.t, d: 0.035, g: 0.22 });
  },

  holdRise: (s, o, r) => {
    const t = s.t;
    const amp = s.gain(0, o);
    ahr(amp.gain, t, 0.28, 0.04, 0.46, 0.1, 0.9);
    const osc = s.osc('triangle', 300 * r, t, t + 0.65, amp);
    sweep(osc.frequency, t, 300 * r, 900 * r, 0.6);
    const sine = s.osc('sine', 600 * r, t, t + 0.65, s.gain(0.4, amp));
    sweep(sine.frequency, t, 600 * r, 1800 * r, 0.6);
    const vib = s.osc('sine', 7, t, t + 0.65);
    vib.connect(s.gain(12 * r, osc.frequency));
  },

  mashClick: (s, o, r) => {
    const t = s.t;
    const v = rnd(0.92, 1.08) * r;
    burst(s, o, { t, d: 0.025, g: 0.75, type: 'bandpass', f: 2400 * v, q: 2 });
    tone(s, o, { type: 'square', f: 420 * v, f2: 180 * v, glide: 0.04, t, d: 0.05, g: 0.22 });
    tone(s, o, { f: 140 * v, f2: 70, t, d: 0.06, g: 0.5 });
  },

  timeTick: (s, o, r) => {
    // tick ... tock
    for (const [dt, f, g] of [[0, 2600, 0.5], [0.22, 1700, 0.42]] as const) {
      const t = s.t + dt;
      burst(s, o, { t, d: 0.018, g, type: 'bandpass', f: f * r, q: 6 });
      tone(s, o, { type: 'triangle', f: f * 0.5 * r, t, d: 0.03, g: g * 0.35 });
    }
  },

  wheelTick: (s, o, r) => {
    burst(s, o, { t: s.t, d: 0.01, g: 0.22, type: 'bandpass', f: 4200 * r * rnd(0.97, 1.03), q: 5 });
  },

  releasePop: (s, o, r) => {
    const t = s.t;
    tone(s, o, { type: 'triangle', f: 1400 * r, f2: 350 * r, glide: 0.07, t, a: 0.001, d: 0.08, g: 0.45 });
    burst(s, o, { t, d: 0.03, g: 0.4, type: 'highpass', f: 2000 * r, f2: 6000 * r, sweepT: 0.03 });
  },

  orderBlip: (s, o, r) => {
    tone(s, o, { type: 'square', f: 660 * r, t: s.t, d: 0.08, g: 0.12 });
    tone(s, o, { f: 1320 * r, t: s.t, d: 0.1, g: 0.15 });
  },

  steadyHum: (s, o, r) => {
    const t = s.t;
    const amp = s.gain(0, o);
    ahr(amp.gain, t, 0.35, 0.12, 0.5, 0.2, 0.85);
    const lp = s.filter('lowpass', 420, 2, amp);
    for (const [f, det] of [[55, 0], [55, 9], [82.4, -5]] as const) {
      const osc = s.osc('sawtooth', f * r, t, t + 0.85, lp);
      osc.detune.value = det;
    }
    const lfo = s.osc('sine', 3.2, t, t + 0.85);
    lfo.connect(s.gain(140, lp.frequency));
  },

  // ---------- Countdown ----------

  countTick: (s, o, r) => {
    const t = s.t;
    // woodblock: two damped inharmonic modes + knock
    tone(s, o, { f: 880 * r, t, d: 0.07, g: 0.45 });
    tone(s, o, { f: 1870 * r, t, d: 0.04, g: 0.18 });
    burst(s, o, { t, d: 0.012, g: 0.4, type: 'bandpass', f: 2500 * r, q: 2 });
  },

  countGo: (s, o, r) => {
    const t = s.t;
    for (const m of [84, 88, 91]) tone(s, o, { type: 'triangle', f: mtof(m) * r, t, a: 0.004, d: 0.45, g: 0.18 });
    tone(s, o, { f: mtof(96) * r, t: t + 0.02, d: 0.5, g: 0.08 });
    burst(s, o, { t, d: 0.05, g: 0.45, type: 'bandpass', f: 3000 * r, q: 1.5 });
    tone(s, o, { f: 1100 * r, t, d: 0.08, g: 0.35 });
  },
};

/** Reverb send per sound (0 = dry). */
const REV: Partial<Record<SfxName, number>> = {
  bellToll: 0.7, gunshot: 0.45, shotgun: 0.5, choir: 0.8, perfect: 0.3, heal: 0.4, crow: 0.25,
  door: 0.2, fall: 0.2, lanternWhoosh: 0.3, fuego: 0.3, glassClink: 0.2, boo: 0.3, cheer: 0.25, blind: 0.3, vaporize: 0.3,
  countGo: 0.25, holdRise: 0.15, steadyHum: 0.15, tapTick: 0.03, mashClick: 0.03, wheelTick: 0.02,
};

/** Base level per sound so callers don't need to balance them. */
const LEVEL: Partial<Record<SfxName, number>> = {
  bellToll: 1, gunshot: 0.9, shotgun: 0.9, uiMove: 0.6, spurs: 0.8, boo: 0.9, cheer: 0.8, choir: 0.7,
  wheelTick: 0.5, mashClick: 0.8, steadyHum: 0.9, countTick: 0.85, countGo: 0.9,
};

let crunch: Float32Array<ArrayBuffer> | null = null;
function crunchCurve(): Float32Array<ArrayBuffer> {
  if (crunch) return crunch;
  const n = 512;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 6) * (Math.abs(x) > 0.7 ? 0.8 : 1);
  }
  crunch = c;
  return c;
}

export function playSfx(e: Engine, name: SfxName, opts?: SfxOptions): void {
  const recipe = recipes[name];
  if (!recipe) return;
  const rate = opts?.rate && opts.rate > 0 && Number.isFinite(opts.rate) ? opts.rate : 1;
  const gain = (opts?.gain ?? 1) * (LEVEL[name] ?? 0.8);
  const s = scope(e);
  const out = makeOut(e, s, e.sfx, opts?.pan ?? 0, gain, REV[name] ?? 0.08);
  recipe(s, out, rate);
  s.finish();
}

// ---------- Drumroll: one noise source amplitude-modulated per stroke ----------

let rollStop: (() => void) | null = null;

export function playDrumroll(e: Engine, durationMs: number): void {
  rollStop?.();
  const dur = Math.max(0.2, Math.min(15, durationMs / 1000));
  const s = scope(e);
  const t0 = s.t;
  const out = makeOut(e, s, e.sfx, 0, 0.9, 0.2);
  const amp = s.gain(0, out);
  const bp = s.filter('bandpass', 2200, 0.8, amp);
  const hp = s.filter('highpass', 400, 0.7, bp);
  const src = s.noise(t0, t0 + dur + 0.2, hp);
  // body tone for the snare
  const bodyAmp = s.gain(0, out);
  const body = s.osc('triangle', 190, t0, t0 + dur + 0.2, bodyAmp);
  body.frequency.value = 190;

  const p = amp.gain;
  const bp2 = bodyAmp.gain;
  p.setValueAtTime(0, t0);
  bp2.setValueAtTime(0, t0);
  let t = t0;
  let i = 0;
  while (t < t0 + dur) {
    const x = (t - t0) / dur;
    const level = 0.08 + 0.9 * x * x;
    const stroke = level * (i % 2 === 0 ? 1 : 0.8) * rnd(0.85, 1.05);
    p.setValueAtTime(stroke, t);
    p.setTargetAtTime(0.0001, t + 0.003, 0.012);
    bp2.setValueAtTime(stroke * 0.25, t);
    bp2.setTargetAtTime(0.0001, t + 0.002, 0.008);
    const interval = 1 / (16 + 14 * x); // speeds up 16 -> 30 strokes/s
    t += interval;
    i++;
  }
  p.setTargetAtTime(0, t0 + dur, 0.02);
  s.finish();
  rollStop = () => {
    try {
      const now = e.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(0, now, 0.01);
      bp2.cancelScheduledValues(now);
      bp2.setTargetAtTime(0, now, 0.01);
      src.stop(now + 0.05);
      body.stop(now + 0.05);
    } catch { /* ignore */ }
    rollStop = null;
  };
  const mine = rollStop;
  setTimeout(() => { if (rollStop === mine) rollStop = null; }, dur * 1000 + 300);
}

export function stopDrumroll(): void {
  rollStop?.();
}

export const SFX_NAMES = Object.keys(recipes) as SfxName[];
