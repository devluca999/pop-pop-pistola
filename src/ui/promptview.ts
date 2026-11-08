import { CONFIG, PROMPT_VERB, DRAW_LABEL, type PromptType, type DrawType, type PromptOutcome } from '../rules';
import { h, tile } from './dom';
import { pixelText } from './pixelfont';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Pie-slice path on a wheel of radius r for the angles a0..a1 (radians, 0 = top, clockwise). */
function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M0 0 L${p(a0)} A${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
}

export interface Wheel {
  el: SVGSVGElement;
  needle: SVGLineElement;
  setArc(centerFrac: number, halfFrac: number, perfectHalfFrac: number): void;
  setNeedle(frac: number): void;
}

/** WHEEL draw: the same for both players. */
export interface WheelSpec { arc: number; start: number; dir: 1 | -1 }

/** A timing wheel: needle sweeps clockwise; gold arc = success, cream slice = perfect. */
export function makeWheel(): Wheel {
  const el = svg('svg', { class: 'wheel', viewBox: '-50 -50 100 100' }) as SVGSVGElement;
  el.append(svg('circle', { r: 46, fill: '#1d140e', stroke: '#f2e6c9', 'stroke-width': 3 }));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    el.append(svg('line', { x1: Math.sin(a) * 38, y1: -Math.cos(a) * 38, x2: Math.sin(a) * 44, y2: -Math.cos(a) * 44, stroke: '#7a6450', 'stroke-width': 2 }));
  }
  const arc = svg('path', { fill: '#e8b33c' });
  const perfect = svg('path', { fill: '#fff4d6' });
  const needle = svg('line', { x1: 0, y1: 0, x2: 0, y2: -44, stroke: '#c8321f', 'stroke-width': 4, 'stroke-linecap': 'square' }) as SVGLineElement;
  el.append(arc, perfect, needle, svg('circle', { r: 5, fill: '#c8321f' }));
  return {
    el, needle,
    setArc(c, half, ph) {
      const T = Math.PI * 2;
      arc.setAttribute('d', arcPath(44, (c - half) * T, (c + half) * T));
      perfect.setAttribute('d', ph > 0 ? arcPath(44, (c - ph) * T, (c + ph) * T) : '');
    },
    setNeedle(f) { needle.setAttribute('transform', `rotate(${(f % 1) * 360})`); },
  };
}

export interface PromptViewOpts {
  type: PromptType;
  labels: string[];          // key labels (3 for IN ORDER)
  mine: boolean;             // big + full contrast
  wobble: boolean;           // Hector drunk
  smoke: boolean;            // Dusty's smoke covers it
  frame: 'p1' | 'p2';
  tag: string;               // P1 / P2 / YOU / CPU
  arcMs?: number;            // TIME IT
  cueMs?: number;            // RELEASE
  gesture?: string;          // touch: what to do, e.g. "SWIPE ↑"
}

/**
 * One player's nerve prompt: verb label, a type-specific tile, live feedback.
 * Lifecycle: countdown(n) / demo -> active (update every frame) -> result.
 */
export class PromptView {
  root: HTMLElement;
  private body: HTMLElement;
  private verb: HTMLElement;
  private tiles: HTMLElement[] = [];
  private bar?: HTMLElement;
  private counter?: HTMLElement;
  private wheel?: Wheel;
  private phase: 'count' | 'demo' | 'active' | 'done' = 'count';
  private lastCount = -1;

  constructor(zone: HTMLElement, private o: PromptViewOpts) {
    this.root = h('div', { class: `pv frame-${o.frame} ${o.mine ? 'mine' : 'theirs'}` });
    this.verb = h('div', { class: 'verb', html: pixelText(PROMPT_VERB[o.type]) });
    this.body = h('div', { class: `pv-body pv-${o.type}` });
    this.root.append(h('div', { class: 'pv-tag' }, o.tag), this.verb, this.body);
    if (o.smoke) this.root.append(h('div', { class: 'smoke-cover' }));
    zone.append(this.root);
  }

  /** 3-2-1 before the prompt (digit 0 = blank). */
  countdown(digit: number) {
    if (this.phase === 'count' && this.lastCount === digit) return;
    this.phase = 'count';
    this.lastCount = digit;
    this.body.replaceChildren(tile(digit > 0 ? String(digit) : '', `${this.o.mine ? 'big' : ''} ghost pop-in`));
  }

  /** First time this type shows up: a looping mini demo of the input. */
  demo() {
    if (this.phase === 'demo') return;
    this.phase = 'demo';
    const d = h('div', { class: `demo demo-${this.o.type}` });
    const t = tile(this.o.type === 'steady' ? '✋' : '→', 'ghosty');
    if (this.o.type === 'order') d.append(tile('↑', 'ghosty d1'), tile('←', 'ghosty d2'), tile('→', 'ghosty d3'));
    else d.append(t);
    if (this.o.type === 'hold' || this.o.type === 'release') d.append(h('div', { class: 'demo-bar' }, h('i')));
    if (this.o.type === 'time') d.append(h('div', { class: 'demo-needle' }));
    if (this.o.type === 'mash') d.append(h('div', { class: 'demo-count' }, 'x4'));
    this.body.replaceChildren(h('div', { class: 'new-tag' }, 'NEW!'), d);
  }

  /** Builds the live prompt. */
  activate() {
    if (this.phase === 'active') return;
    this.phase = 'active';
    const big = this.o.mine ? 'big' : '';
    const wob = this.o.wobble ? 'wobble' : '';
    const t = this.o.type;
    const parts: Node[] = [];
    if (t === 'order') {
      const row = h('div', { class: 'order-row' });
      this.o.labels.forEach((l, k) => {
        const tl = tile(l, `pop-in ${k === 0 ? 'next' : 'dim'}`);
        this.tiles.push(tl);
        row.append(tl);
        if (k < this.o.labels.length - 1) row.append(h('span', { class: 'order-arrow', html: pixelText('→') }));
      });
      parts.push(row);
    } else if (t === 'steady') {
      const tl = tile('✋', `${big} pop-in steady-tile`);
      this.tiles.push(tl);
      parts.push(tl, h('div', { class: 'pv-note' }, "DON'T PRESS"));
    } else {
      const tl = tile(this.o.labels[0], `${big} pop-in`);
      this.tiles.push(tl);
      if (t === 'time') {
        this.wheel = makeWheel();
        const sweep = CONFIG.nerve.timeSweepMs;
        this.wheel.setArc((this.o.arcMs ?? 600) / sweep, CONFIG.nerve.timeArcHalfMs / sweep, 0);
        const w = h('div', { class: 'wheel-wrap' });
        w.append(this.wheel.el, tl);
        parts.push(w);
      } else {
        parts.push(tl);
      }
      if (t === 'hold' || t === 'release') {
        this.bar = h('i');
        parts.push(h('div', { class: 'hold-bar' }, this.bar));
      }
      if (t === 'mash') {
        this.counter = h('div', { class: 'mash-count', html: pixelText(`x${CONFIG.nerve.mashCount}`) });
        tl.classList.add('mash-shake');
        parts.push(this.counter);
      }
    }
    if (this.o.gesture) parts.push(h('div', { class: 'pv-gesture' }, this.o.gesture));
    const holder = h('div', { class: `pv-live ${wob}` }, ...parts);
    this.body.replaceChildren(holder);
  }

  /** ms = time since the prompt appeared. */
  update(ms: number, r: PromptOutcome) {
    if (this.phase !== 'active') return;
    const t = this.o.type;
    const main = this.tiles[0];
    if (t === 'time' && this.wheel) this.wheel.setNeedle(Math.min(ms, CONFIG.nerve.timeSweepMs) / CONFIG.nerve.timeSweepMs);
    if (t === 'hold' && this.bar) {
      const f = r.holding && r.pressT !== null ? 1 : r.status === 'ok' || r.status === 'beaten' ? 1 : 0;
      const frac = r.holding ? Math.min(1, (ms - (r.pressT ?? 0)) / CONFIG.nerve.holdMs) : f;
      this.bar.style.width = `${Math.round(frac * 100)}%`;
    }
    if (t === 'release' && this.bar) {
      const cue = this.o.cueMs ?? CONFIG.nerve.releaseCueMin;
      const frac = Math.min(1, ms / cue);
      this.bar.style.width = `${Math.round(frac * 100)}%`;
      const now = ms >= cue;
      this.verb.classList.toggle('cue', now);
      if (now && !this.verb.dataset.cue) { this.verb.dataset.cue = '1'; this.verb.innerHTML = pixelText('LET GO!'); }
      else if (!now && r.holding) this.verb.innerHTML = pixelText('KEEP HOLDING');
    }
    if (t === 'mash' && this.counter && r.count !== this.lastCount) {
      this.lastCount = r.count;
      this.counter.innerHTML = pixelText(`x${Math.max(0, CONFIG.nerve.mashCount - r.count)}`);
    }
    if (t === 'order') {
      this.tiles.forEach((tl, k) => {
        tl.classList.toggle('ok', k < r.count);
        tl.classList.toggle('next', k === r.count);
        tl.classList.toggle('dim', k > r.count);
      });
    }
    if (r.pressT !== null && t !== 'order' && t !== 'steady') main?.classList.toggle('down', r.holding || t === 'tap' || t === 'time');
  }

  result(status: PromptOutcome['status']) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const good = status === 'ok';
    for (const tl of this.tiles) {
      tl.classList.remove('mash-shake', 'dim', 'next');
      tl.classList.add(good ? 'ok' : 'bad');
    }
    if (this.bar && good) this.bar.style.width = '100%';
    const msg = status === 'beaten' ? 'STARED DOWN' : status === 'slow' ? 'TOO SLOW' : status === 'miss' ? 'FLINCH' : '';
    if (msg) this.root.append(h('div', { class: 'pv-result bad' }, msg));
    else this.root.append(h('div', { class: 'pv-result good' }, 'CLEAN!'));
  }

  destroy() { this.root.remove(); }
}

/** The draw at the bell for one player: RING, WHEEL or SPEED TAP. */
export class DrawView {
  root: HTMLElement;
  private tl: HTMLElement;
  private ring?: SVGCircleElement;
  private band?: SVGCircleElement;
  private wheel?: Wheel;
  private counter?: HTMLElement;
  private pips: HTMLElement[] = [];
  private lastCount = -1;
  private spec?: WheelSpec;

  constructor(zone: HTMLElement, private type: DrawType, label: string, o: { mine: boolean; frame: 'p1' | 'p2'; tag: string; smoke: boolean; wheel?: WheelSpec }) {
    this.spec = o.wheel;
    this.root = h('div', { class: `pv draw-view frame-${o.frame} ${o.mine ? 'mine' : 'theirs'}` });
    const big = o.mine ? 'big' : '';
    this.tl = tile(label, `${big} pop-in ${label.length > 2 ? 'wide' : ''}`);
    const verb = h('div', { class: 'verb', html: pixelText(type === 'wheel' ? 'ONE SHOT' : type === 'speed' ? `TAP x${CONFIG.draw.speedCount}` : 'DRAW') });
    const body = h('div', { class: 'pv-body' });
    if (type === 'ring') {
      const s = svg('svg', { class: 'ring', viewBox: '-50 -50 100 100' });
      this.band = svg('circle', { fill: 'none', stroke: '#e8b33c', opacity: 0.85 }) as SVGCircleElement;
      this.ring = svg('circle', { fill: 'none', stroke: '#f2e6c9', 'stroke-width': 2.4, 'stroke-dasharray': '3 2' }) as SVGCircleElement;
      s.append(this.band, this.ring);
      body.append(s, this.tl);
    } else if (type === 'wheel') {
      this.wheel = makeWheel();
      const w = h('div', { class: 'wheel-wrap draw' });
      w.append(this.wheel.el, this.tl);
      body.append(w);
    } else {
      this.counter = h('div', { class: 'mash-count', html: pixelText(String(CONFIG.draw.speedCount)) });
      const pips = h('div', { class: 'speed-pips' });
      for (let k = 0; k < CONFIG.draw.speedCount; k++) { const p = h('i'); this.pips.push(p); pips.append(p); }
      body.append(this.tl, this.counter, pips);
    }
    this.root.append(h('div', { class: 'pv-tag' }, o.tag), verb, body);
    if (o.smoke) this.root.append(h('div', { class: 'smoke-cover' }));
    zone.append(this.root);
  }

  /** perfect: ring band width / wheel perfect half / speed span. arcHalf: wheel only. */
  setWindow(perfect: number, arcHalf: number, arcCenter: number, mine: boolean) {
    if (this.type === 'ring' && this.band) {
      if (perfect <= 0) { this.band.setAttribute('stroke-width', '0'); return; }
      const c = CONFIG.draw.goldCenterMs;
      const r1 = ringRadius(c - perfect / 2), r2 = ringRadius(c + perfect / 2);
      this.band.setAttribute('r', String((r1 + r2) / 2));
      this.band.setAttribute('stroke-width', String(Math.max(1.5, r1 - r2)));
      if (!mine) this.band.setAttribute('opacity', '0.5');
    }
    if (this.type === 'wheel' && this.wheel) {
      const P = CONFIG.draw.wheelPeriodMs;
      const dir = this.spec?.dir ?? 1;
      this.wheel.setArc(dir * arcCenter / P, arcHalf / P, perfect / P);
    }
  }

  update(ms: number, count: number) {
    if (this.ring) {
      this.ring.setAttribute('r', String(Math.max(0, ringRadius(ms))));
      this.ring.setAttribute('opacity', ms > CONFIG.draw.ringMs ? '0' : '1');
    }
    if (this.wheel && !this.frozen) {
      const P = CONFIG.draw.wheelPeriodMs;
      const dir = this.spec?.dir ?? 1;
      this.wheel.setNeedle((dir * ((this.spec?.start ?? 0) + ms)) / P);
    }
    if (this.counter && count !== this.lastCount) {
      this.lastCount = count;
      this.counter.innerHTML = pixelText(String(Math.max(0, CONFIG.draw.speedCount - count)));
      this.pips.forEach((p, k) => p.classList.toggle('on', k < count));
      this.tl.classList.remove('hit');
      void this.tl.offsetWidth;
      if (count > 0) this.tl.classList.add('hit');
    }
  }

  jam() {
    this.tl.classList.remove('bad');
    void this.tl.offsetWidth;
    this.tl.classList.add('bad');
  }
  private frozen = false;
  /** Shot fired. WHEEL: the needle freezes where you shot; `missed` = outside the arc. */
  drew(missed = false) {
    this.frozen = this.type === 'wheel';
    this.tl.classList.add('down', missed ? 'bad' : 'ok');
  }
  destroy() { this.root.remove(); }
}

/** Radius (svg units, tile ~ 22) of the closing ring at ms after the bell. */
export function ringRadius(ms: number): number {
  const c = CONFIG.draw.goldCenterMs;
  return 21 * (1 + 1.3 * (c - ms) / c);
}

/** Big draw-type label for the countdown, e.g. "WHEEL". */
export function drawLabel(type: DrawType): string {
  return DRAW_LABEL[type];
}
