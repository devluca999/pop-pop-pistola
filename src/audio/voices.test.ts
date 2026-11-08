import { describe, expect, it } from 'vitest';
import type { CharacterId } from '../types';
import { mulberry32 } from './rng';
import type { VoiceMood } from './types';
import { PROFILES, VOWELS, planUtterance } from './voicePlan';

const CHARS: CharacterId[] = ['hector', 'dusty', 'mercy'];
const MOODS: VoiceMood[] = ['mutter', 'hit', 'gloat', 'taunt', 'hum', 'drink', 'death'];

describe('planUtterance', () => {
  it('is deterministic for a given seed', () => {
    const a = planUtterance('hector', 'mutter', mulberry32(42));
    const b = planUtterance('hector', 'mutter', mulberry32(42));
    expect(a).toEqual(b);
  });

  it('produces well-formed, ordered syllables for every character and mood', () => {
    for (const ch of CHARS) {
      for (const mood of MOODS) {
        for (let seed = 1; seed < 40; seed++) {
          const u = planUtterance(ch, mood, mulberry32(seed));
          expect(u.syllables.length).toBeGreaterThan(0);
          let prev = -1;
          for (const s of u.syllables) {
            expect(s.t).toBeGreaterThanOrEqual(prev);
            expect(s.dur).toBeGreaterThan(0);
            expect(s.f0).toBeGreaterThan(40);
            expect(s.f0).toBeLessThan(800);
            expect(s.f0End).toBeGreaterThan(20);
            expect(VOWELS[s.vowel]).toBeDefined();
            for (const f of s.formants) expect(f).toBeGreaterThan(150);
            expect(s.gain).toBeGreaterThan(0);
            expect(s.gain).toBeLessThanOrEqual(1);
            prev = s.t + s.dur - 1e-9;
          }
          expect(u.duration).toBeLessThan(3);
        }
      }
    }
  });

  it('mutters use 2-6 syllables, hits are a single grunt', () => {
    for (let seed = 1; seed < 100; seed++) {
      const m = planUtterance('dusty', 'mutter', mulberry32(seed)).syllables.length;
      expect(m).toBeGreaterThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(6);
      expect(planUtterance('hector', 'hit', mulberry32(seed)).syllables).toHaveLength(1);
    }
  });

  it('death ends in a long downward slide', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = planUtterance('mercy', 'death', mulberry32(seed)).syllables;
      const last = s[s.length - 1]!;
      expect(last.dur).toBeGreaterThan(0.8);
      expect(last.f0End).toBeLessThan(last.f0 * 0.6);
    }
  });

  it('gloat is a laughing pattern of repeated h-syllables that steps down', () => {
    const s = planUtterance('hector', 'gloat', mulberry32(7)).syllables;
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(new Set(s.map((x) => x.vowel)).size).toBe(1);
    expect(s.every((x) => x.consonant === 'h')).toBe(true);
    expect(s[s.length - 1]!.f0).toBeLessThan(s[0]!.f0);
  });

  it('characters sound distinct: Hector high & nasal, Dusty low, Mercy hums', () => {
    expect(PROFILES.hector.f0).toBeGreaterThan(PROFILES.dusty.f0 * 2);
    expect(PROFILES.hector.nasal).not.toBeNull();
    expect(PROFILES.dusty.formantScale).toBeLessThan(1);
    expect(PROFILES.mercy.legato).toBe(true);
    const hum = planUtterance('mercy', 'hum', mulberry32(3)).syllables;
    expect(hum.every((x) => x.vowel === 'm' && x.consonant === null)).toBe(true);
    const avg = (ch: CharacterId): number => {
      let sum = 0;
      let n = 0;
      for (let seed = 1; seed < 50; seed++) {
        for (const x of planUtterance(ch, 'mutter', mulberry32(seed)).syllables) { sum += x.f0; n++; }
      }
      return sum / n;
    };
    expect(avg('hector')).toBeGreaterThan(avg('dusty') * 1.8);
  });
});
