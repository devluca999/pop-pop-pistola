// Low-level Web Audio helpers. No imports from the engine so this stays cycle-free.

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const EPS = 0.0001;

/**
 * A Scope collects every node created for one sound (or one music bar) so the
 * whole graph can be disconnected once it has finished playing.
 */
export class Scope {
  readonly nodes: AudioNode[] = [];
  end: number;
  constructor(readonly ctx: AudioContext, readonly noiseBuf: AudioBuffer, public t: number) {
    this.end = t;
  }

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  until(time: number): void {
    if (time > this.end) this.end = time;
  }

  gain(v = 1, dest?: AudioNode): GainNode {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 1, dest?: AudioNode): BiquadFilterNode {
    const f = this.add(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = clampFreq(freq);
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  panner(pan: number, dest?: AudioNode): StereoPannerNode {
    const p = this.add(this.ctx.createStereoPanner());
    p.pan.value = Math.max(-1, Math.min(1, pan));
    if (dest) p.connect(dest);
    return p;
  }

  osc(type: OscillatorType, freq: number, start: number, stop: number, dest?: AudioNode): OscillatorNode {
    const o = this.add(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = clampFreq(freq);
    if (dest) o.connect(dest);
    o.start(start);
    o.stop(stop);
    this.until(stop);
    return o;
  }

  /** Looping white noise starting at a random offset. */
  noise(start: number, stop: number, dest?: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.add(this.ctx.createBufferSource());
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    if (dest) src.connect(dest);
    src.start(start, Math.random() * (this.noiseBuf.duration - 0.1));
    src.stop(stop);
    this.until(stop);
    return src;
  }

  buffer(buf: AudioBuffer, start: number, dest?: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.add(this.ctx.createBufferSource());
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (dest) src.connect(dest);
    src.start(start);
    this.until(start + buf.duration / rate);
    return src;
  }

  /** Schedule disconnection of every node after the last source has ended. */
  finish(extra = 0.3): void {
    const nodes = this.nodes.slice();
    const ms = Math.max(0, this.end - this.ctx.currentTime + extra) * 1000;
    setTimeout(() => {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    }, ms);
  }
}

export const clampFreq = (f: number): number => Math.max(10, Math.min(20000, f));

/** Attack then exponential decay. Returns end time. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const pk = Math.max(peak, EPS * 2);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(pk, t + attack);
  p.exponentialRampToValueAtTime(EPS, t + attack + decay);
  return t + attack + decay;
}

/** Attack, hold (gently sagging to `sustain`*peak), then exponential release. Returns end time. */
export function ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number, sustain = 0.75): number {
  const pk = Math.max(peak, EPS * 2);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(pk, t + attack);
  p.linearRampToValueAtTime(Math.max(pk * sustain, EPS * 2), t + attack + hold);
  p.exponentialRampToValueAtTime(EPS, t + attack + hold + release);
  return t + attack + hold + release;
}

export function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, EPS), t);
  p.exponentialRampToValueAtTime(Math.max(to, EPS), t + Math.max(dur, 0.001));
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  f2?: number;
  glide?: number;
  t?: number;
  a?: number;
  d: number;
  g: number;
  detune?: number;
}

/** A single enveloped oscillator, optionally gliding from f to f2. */
export function tone(s: Scope, dest: AudioNode, o: ToneOpts): OscillatorNode {
  const t = o.t ?? s.t;
  const g = s.gain(0, dest);
  const end = perc(g.gain, t, o.g, o.a ?? 0.003, o.d);
  const osc = s.osc(o.type ?? 'sine', o.f, t, end + 0.02, g);
  if (o.f2 !== undefined) sweep(osc.frequency, t, o.f, o.f2, o.glide ?? o.d);
  if (o.detune) osc.detune.value = o.detune;
  return osc;
}

export interface BurstOpts {
  t?: number;
  a?: number;
  d: number;
  g: number;
  type?: BiquadFilterType;
  f: number;
  f2?: number;
  sweepT?: number;
  q?: number;
}

/** Filtered noise burst. */
export function burst(s: Scope, dest: AudioNode, o: BurstOpts): BiquadFilterNode {
  const t = o.t ?? s.t;
  const g = s.gain(0, dest);
  const end = perc(g.gain, t, o.g, o.a ?? 0.002, o.d);
  const f = s.filter(o.type ?? 'bandpass', o.f, o.q ?? 1, g);
  if (o.f2 !== undefined) sweep(f.frequency, t, o.f, o.f2, o.sweepT ?? o.d);
  s.noise(t, end + 0.02, f);
  return f;
}

// ---------- Karplus-Strong plucked string ----------

const ksCache = new Map<string, AudioBuffer>();

export function ksBuffer(ctx: BaseAudioContext, freq: number, dur: number, damp = 0.996, bright = 0.6): AudioBuffer {
  const key = `${Math.round(freq * 10)}|${dur}|${damp}|${bright}`;
  const hit = ksCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.round(sr / freq));
  const len = Math.max(1, Math.floor(sr * dur));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.random() * 2 - 1;
    prev = bright * r + (1 - bright) * prev;
    ring[i] = prev;
  }
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx]!;
    const nxt = ring[(idx + 1) % n]!;
    d[i] = cur;
    ring[idx] = damp * 0.5 * (cur + nxt);
    idx = (idx + 1) % n;
  }
  // fade the tail to avoid a click at the buffer end
  const fade = Math.min(len, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) d[len - 1 - i] = d[len - 1 - i]! * (i / fade);
  if (ksCache.size > 96) {
    const first = ksCache.keys().next().value;
    if (first !== undefined) ksCache.delete(first);
  }
  ksCache.set(key, buf);
  return buf;
}

export interface PluckOpts { g: number; dur?: number; bend?: number; damp?: number; bright?: number }

/** Plucked string with optional "twang" pitch bend (bend = starting rate ratio, e.g. 0.95). */
export function pluck(s: Scope, dest: AudioNode, freq: number, t: number, o: PluckOpts): void {
  const dur = o.dur ?? 1.6;
  const buf = ksBuffer(s.ctx, freq, dur, o.damp ?? 0.996, o.bright ?? 0.6);
  const g = s.gain(o.g, dest);
  const src = s.buffer(buf, t, g);
  if (o.bend !== undefined && o.bend !== 1) {
    src.playbackRate.setValueAtTime(o.bend, t);
    src.playbackRate.exponentialRampToValueAtTime(1, t + 0.09);
  }
}

// ---------- Static buffers ----------

export function makeNoise(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Stereo impulse response: decaying, slightly darkening noise. Cheap "canyon" reverb. */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const k = 0.15 + 0.8 * x; // more smoothing (darker) later in the tail
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - x, decay) * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}
