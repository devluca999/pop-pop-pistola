// Pure "Simlish" gibberish planner: no Web Audio here, so it is unit-testable.
import type { CharacterId } from '../types';
import { intRange, pick, range, type Rng } from './rng';
import type { VoiceMood } from './types';

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'm';
export type Consonant = 'k' | 't' | 's' | 'h' | 'p' | 'g' | 'b';

/** [F1, F2, F3] in Hz plus relative band gains. */
export const VOWELS: Record<Vowel, { f: readonly [number, number, number]; g: readonly [number, number, number] }> = {
  a: { f: [730, 1090, 2440], g: [1, 0.55, 0.25] },
  e: { f: [530, 1840, 2480], g: [1, 0.5, 0.25] },
  i: { f: [300, 2250, 3000], g: [1, 0.45, 0.3] },
  o: { f: [570, 840, 2410], g: [1, 0.6, 0.15] },
  u: { f: [320, 870, 2240], g: [1, 0.4, 0.1] },
  // closed-mouth nasal hum: low murmur, weak upper bands
  m: { f: [260, 1050, 2200], g: [1, 0.12, 0.05] },
};

export interface VoiceProfile {
  id: CharacterId;
  /** Base pitch in Hz. */
  f0: number;
  /** Random pitch spread in semitones around f0. */
  spread: number;
  syl: readonly [number, number];
  gap: readonly [number, number];
  formantScale: number;
  vowels: readonly Vowel[];
  consonants: readonly Consonant[];
  consonantProb: number;
  source: 'sawtooth' | 'square' | 'triangle';
  vibRate: number;
  /** Vibrato depth as a ratio of f0. */
  vibDepth: number;
  /** Extra narrow resonance (Hz) for nasal voices, or null. */
  nasal: number | null;
  /** Lowpass on the source. */
  lowpass: number;
  legato: boolean;
}

export const PROFILES: Record<CharacterId, VoiceProfile> = {
  hector: {
    id: 'hector', f0: 235, spread: 6, syl: [0.08, 0.15], gap: [0.02, 0.07], formantScale: 1.15,
    vowels: ['i', 'e', 'a', 'a', 'o'], consonants: ['k', 't', 'p', 's', 'g'], consonantProb: 0.75,
    source: 'sawtooth', vibRate: 7, vibDepth: 0.02, nasal: 1500, lowpass: 5000, legato: false,
  },
  dusty: {
    id: 'dusty', f0: 92, spread: 3, syl: [0.14, 0.26], gap: [0.04, 0.12], formantScale: 0.85,
    vowels: ['o', 'u', 'a', 'o', 'e'], consonants: ['g', 'b', 'h', 'k'], consonantProb: 0.55,
    source: 'sawtooth', vibRate: 4, vibDepth: 0.015, nasal: null, lowpass: 1800, legato: false,
  },
  mercy: {
    id: 'mercy', f0: 205, spread: 4, syl: [0.2, 0.34], gap: [0, 0.02], formantScale: 1.1,
    vowels: ['m', 'm', 'm', 'o', 'u'], consonants: ['h'], consonantProb: 0.15,
    source: 'triangle', vibRate: 5, vibDepth: 0.012, nasal: null, lowpass: 2400, legato: true,
  },
};

export interface Syllable {
  /** Start time in seconds relative to utterance start. */
  t: number;
  dur: number;
  f0: number;
  f0End: number;
  vowel: Vowel;
  /** Scaled formant frequencies for this syllable. */
  formants: [number, number, number];
  consonant: Consonant | null;
  gain: number;
}

export interface Utterance {
  profile: VoiceProfile;
  mood: VoiceMood;
  syllables: Syllable[];
  duration: number;
}

const semi = (n: number): number => Math.pow(2, n / 12);

function formantsFor(p: VoiceProfile, v: Vowel, rng: Rng): [number, number, number] {
  const f = VOWELS[v].f;
  const j = range(rng, 0.95, 1.05);
  return [f[0] * p.formantScale * j, f[1] * p.formantScale * j, f[2] * p.formantScale];
}

/** Build a gibberish utterance for a character and mood. Deterministic for a given rng. */
export function planUtterance(ch: CharacterId, mood: VoiceMood, rng: Rng): Utterance {
  const p = PROFILES[ch];
  const syl: Syllable[] = [];
  let t = 0;

  const push = (o: { dur: number; f0: number; f0End?: number; vowel: Vowel; consonant?: Consonant | null; gain: number; gap?: number }): void => {
    syl.push({
      t,
      dur: o.dur,
      f0: o.f0,
      f0End: o.f0End ?? o.f0,
      vowel: o.vowel,
      formants: formantsFor(p, o.vowel, rng),
      consonant: o.consonant ?? null,
      gain: o.gain,
    });
    t += o.dur + (o.gap ?? range(rng, p.gap[0], p.gap[1]));
  };
  const cons = (): Consonant | null => (rng() < p.consonantProb ? pick(rng, p.consonants) : null);
  const randPitch = (): number => p.f0 * semi(range(rng, -p.spread / 2, p.spread / 2));
  const sylDur = (k = 1): number => range(rng, p.syl[0], p.syl[1]) * k;

  switch (mood) {
    case 'mutter':
    case 'taunt': {
      const n = mood === 'mutter' ? intRange(rng, 2, 6) : intRange(rng, 3, 5);
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        const f0 = randPitch() * (mood === 'taunt' ? 1.08 : 0.95);
        let f0End = f0 * semi(range(rng, -1.5, 1.5));
        if (last) f0End = mood === 'taunt' ? f0 * semi(range(rng, 4, 7)) : f0 * semi(-range(rng, 2, 4));
        push({
          dur: sylDur(last ? 1.5 : 1),
          f0,
          f0End,
          vowel: pick(rng, p.vowels),
          consonant: cons(),
          gain: mood === 'mutter' ? range(rng, 0.45, 0.65) : range(rng, 0.75, 1),
        });
      }
      break;
    }
    case 'hit': {
      const f0 = p.f0 * semi(range(rng, 3, 6));
      push({
        dur: range(rng, 0.1, 0.16) * (ch === 'dusty' ? 1.3 : 1),
        f0,
        f0End: f0 * semi(-range(rng, 4, 7)),
        vowel: ch === 'mercy' ? 'o' : pick(rng, ['a', 'u'] as const),
        consonant: rng() < 0.5 ? 'h' : null,
        gain: 1,
      });
      break;
    }
    case 'gloat': {
      const n = intRange(rng, 4, 6);
      const vowel: Vowel = ch === 'mercy' ? 'm' : ch === 'hector' ? 'e' : 'a';
      let f = p.f0 * semi(range(rng, 4, 6));
      for (let i = 0; i < n; i++) {
        push({ dur: range(rng, 0.07, 0.11), f0: f, f0End: f * semi(-1), vowel, consonant: 'h', gain: 0.9 - i * 0.06, gap: range(rng, 0.04, 0.07) });
        f *= semi(-range(rng, 0.7, 1.5));
      }
      break;
    }
    case 'hum': {
      const n = intRange(rng, 3, 5);
      const scale = [0, 2, 3, 5, 7, 10];
      for (let i = 0; i < n; i++) {
        const f0 = p.f0 * 0.9 * semi(pick(rng, scale));
        push({ dur: range(rng, 0.25, 0.42), f0, f0End: f0, vowel: 'm', consonant: null, gain: 0.55, gap: 0 });
      }
      break;
    }
    case 'drink': {
      for (let i = 0; i < 2; i++) {
        push({ dur: 0.07, f0: p.f0 * 0.8, f0End: p.f0 * 0.7, vowel: 'u', consonant: 'g', gain: 0.4, gap: range(rng, 0.08, 0.12) });
      }
      const f0 = p.f0 * semi(range(rng, 2, 4));
      push({ dur: range(rng, 0.55, 0.75), f0, f0End: f0 * semi(-5), vowel: ch === 'mercy' ? 'm' : 'a', consonant: 'h', gain: 0.8, gap: 0 });
      break;
    }
    case 'death': {
      const n = intRange(rng, 1, 2);
      for (let i = 0; i < n; i++) {
        const f0 = p.f0 * semi(range(rng, 2, 5));
        push({ dur: sylDur(), f0, f0End: f0 * semi(-1), vowel: pick(rng, ['a', 'o', 'u'] as const), consonant: 'h', gain: 0.8 });
      }
      const f0 = p.f0 * semi(range(rng, 3, 6));
      push({ dur: range(rng, 0.9, 1.3), f0, f0End: f0 * 0.45, vowel: ch === 'mercy' ? 'o' : pick(rng, ['o', 'a'] as const), consonant: null, gain: 0.9, gap: 0 });
      break;
    }
  }

  const lastS = syl[syl.length - 1]!;
  return { profile: p, mood, syllables: syl, duration: lastS.t + lastS.dur };
}
