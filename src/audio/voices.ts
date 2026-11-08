// Renders a planned Simlish utterance: pitched source -> formant bandpasses, plus noise consonants.
import type { CharacterId } from '../types';
import { makeOut, scope, type Engine } from './context';
import { mulberry32, randomSeed } from './rng';
import { burst } from './synth';
import type { VoiceMood } from './types';
import { VOWELS, planUtterance, type Consonant, type Utterance } from './voicePlan';

const MAX_ACTIVE = 5;
let active = 0;

interface ConsSpec { type: BiquadFilterType; f: number; q: number; d: number; g: number }
const CONS: Record<Consonant, ConsSpec> = {
  k: { type: 'bandpass', f: 2600, q: 2, d: 0.03, g: 0.5 },
  t: { type: 'highpass', f: 4000, q: 0.7, d: 0.025, g: 0.45 },
  s: { type: 'highpass', f: 5000, q: 0.7, d: 0.08, g: 0.3 },
  h: { type: 'bandpass', f: 1500, q: 0.6, d: 0.06, g: 0.22 },
  p: { type: 'lowpass', f: 900, q: 0.7, d: 0.02, g: 0.5 },
  g: { type: 'lowpass', f: 1300, q: 1, d: 0.03, g: 0.45 },
  b: { type: 'lowpass', f: 600, q: 0.7, d: 0.025, g: 0.55 },
};

export function playVoice(e: Engine, ch: CharacterId, mood: VoiceMood, pan = 0): void {
  if (active >= MAX_ACTIVE) return;
  const u = planUtterance(ch, mood, mulberry32(randomSeed()));
  render(e, u, pan);
}

function render(e: Engine, u: Utterance, pan: number): void {
  const p = u.profile;
  const s = scope(e);
  const t0 = s.t;
  const end = t0 + u.duration + 0.05;
  const out = makeOut(e, s, e.voice, pan, 1, 0.12);

  // Source with vibrato
  const amp = s.gain(0);
  const lp = s.filter('lowpass', p.lowpass, 0.7);
  amp.connect(lp);
  const src = s.osc(p.source, u.syllables[0]!.f0, t0, end + 0.05, amp);
  const vib = s.osc('sine', p.vibRate, t0, end + 0.05);
  vib.connect(s.gain(p.f0 * p.vibDepth, src.frequency));

  // Formant bank (3 parallel bandpasses), frequencies automated per syllable
  const qs = [7, 11, 14];
  const comp = p.source === 'triangle' ? 2.6 : 1.8; // bandpasses eat level; triangles even more
  const bands = [0, 1, 2].map((i) => {
    const bp = s.filter('bandpass', u.syllables[0]!.formants[i]!, qs[i]!);
    const g = s.gain(VOWELS[u.syllables[0]!.vowel].g[i]! * comp, out);
    lp.connect(bp);
    bp.connect(g);
    return { bp, g };
  });
  if (p.nasal) {
    const nb = s.filter('bandpass', p.nasal, 6);
    lp.connect(nb);
    nb.connect(s.gain(1.1, out));
  }
  // a little dry body so low voices aren't too thin
  lp.connect(s.gain(0.06, out));

  const A = amp.gain;
  A.setValueAtTime(0.0001, t0);
  let prevEnd = t0;
  for (const syl of u.syllables) {
    const t = t0 + syl.t;
    const legatoJoin = p.legato && t - prevEnd < 0.01;
    const att = Math.min(0.03, syl.dur * 0.3);
    const rel = Math.min(0.05, syl.dur * 0.35);
    const g = 0.5 * syl.gain;
    if (!legatoJoin) A.setValueAtTime(0.0001, t);
    A.linearRampToValueAtTime(g, t + att);
    A.linearRampToValueAtTime(g * 0.8, t + syl.dur - rel);
    A.linearRampToValueAtTime(p.legato ? g * 0.35 : 0.0001, t + syl.dur);

    if (legatoJoin) src.frequency.setTargetAtTime(syl.f0, t, 0.03);
    else src.frequency.setValueAtTime(syl.f0, t);
    src.frequency.exponentialRampToValueAtTime(Math.max(20, syl.f0End), t + syl.dur);

    const v = VOWELS[syl.vowel];
    bands.forEach((b, i) => {
      b.bp.frequency.setTargetAtTime(syl.formants[i]!, t, 0.015);
      b.g.gain.setTargetAtTime(v.g[i]! * comp, t, 0.015);
    });

    if (syl.consonant) {
      const c = CONS[syl.consonant];
      const ct = Math.max(t0, t - c.d * 0.5);
      burst(s, out, { t: ct, a: 0.002, d: c.d, g: c.g * syl.gain, type: c.type, f: c.f * p.formantScale, q: c.q });
    }
    prevEnd = t + syl.dur;
  }
  A.linearRampToValueAtTime(0.0001, end);

  active++;
  s.finish();
  setTimeout(() => { active = Math.max(0, active - 1); }, (end - e.ctx.currentTime) * 1000 + 50);
}
