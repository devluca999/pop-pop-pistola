// POP.POP.Pistola audio: everything is synthesized with the Web Audio API.
// Every public method is a safe no-op before unlock() and never throws.
import type { CharacterId } from '../types';
import { setHeartbeat, setWind } from './ambience';
import { duck as duckBuses, engine, ensureEngine, setVolumes as setBusVolumes } from './context';
import { loadCustomMusic, playMusic } from './music';
import { playDrumroll, playSfx } from './sfx';
import type { AudioEngine, MusicTrack, SfxName, SfxOptions, Volumes, VoiceMood } from './types';
import { playVoice } from './voices';

export type { AudioEngine, MusicTrack, SfxName, SfxOptions, VoiceMood, Volumes } from './types';

// Desired continuous state, remembered so calls made before unlock() take effect afterwards.
const want: { music: MusicTrack; wind: boolean; heart: boolean; bpm: number } = { music: 'none', wind: false, heart: false, bpm: 72 };

const safe = (fn: () => void): void => {
  try { fn(); } catch (err) {
    if (import.meta.env?.DEV) console.warn('[audio]', err);
  }
};

const running = (): ReturnType<typeof engine> => {
  const e = engine();
  return e && e.ctx.state !== 'closed' ? e : null;
};

let started = false;

export const audio: AudioEngine = {
  unlock() {
    safe(() => {
      const e = ensureEngine();
      if (!e) return;
      if (e.ctx.state === 'suspended') void e.ctx.resume().catch(() => undefined);
      if (started) return;
      started = true;
      // iOS: play a silent buffer inside the gesture
      const b = e.ctx.createBufferSource();
      b.buffer = e.ctx.createBuffer(1, 1, e.ctx.sampleRate);
      b.connect(e.ctx.destination);
      b.start();
      b.onended = () => b.disconnect();
      loadCustomMusic(e);
      if (want.music !== 'none') playMusic(e, want.music);
      if (want.wind) setWind(e, true);
      if (want.heart) setHeartbeat(e, true, want.bpm);
    });
  },

  sfx(name: SfxName, opts?: SfxOptions) {
    safe(() => {
      const e = running();
      if (e) playSfx(e, name, opts);
    });
  },

  drumroll(durationMs: number) {
    safe(() => {
      const e = running();
      if (e && Number.isFinite(durationMs)) playDrumroll(e, durationMs);
    });
  },

  voice(ch: CharacterId, mood: VoiceMood, opts?: { pan?: number }) {
    safe(() => {
      const e = running();
      if (e) playVoice(e, ch, mood, opts?.pan ?? 0);
    });
  },

  music(track: MusicTrack) {
    safe(() => {
      want.music = track;
      const e = running();
      if (e && started) playMusic(e, track);
    });
  },

  wind(on: boolean) {
    safe(() => {
      want.wind = on;
      const e = running();
      if (e && started) setWind(e, on);
    });
  },

  heartbeat(on: boolean, bpm?: number) {
    safe(() => {
      want.heart = on;
      if (bpm && Number.isFinite(bpm)) want.bpm = bpm;
      const e = running();
      if (e && started) setHeartbeat(e, on, want.bpm);
    });
  },

  setVolumes(v: Volumes) {
    safe(() => setBusVolumes(v));
  },

  duck(amount: number, ms: number) {
    safe(() => duckBuses(amount, ms));
  },
};

export default audio;
