import type { CharacterId, PlayerIndex, ScreenSide } from '../types';
import {
  CONFIG, applyExchange, canHeal, cpuExchangeLog, cpuFeintReaction, generatePlan, makeRng, randomSeed,
  resolveExchange, goldBand,
  type Difficulty, type ExchangePlan, type ExchangeResult, type InputEvent, type MatchState, type WillChoice,
  newMatch,
} from '../rules';
import type { GameInput } from '../input';
import { keyLabel, padLabel } from '../input/labels';
import { h, tile, shout, heartSvg, clear } from '../ui/dom';
import type { AppCtx } from './ctx';
import type { NetLink, NetMsg } from '../net/types';

export type DuelMode = 'cpu' | 'local' | 'online';

export interface DuelSetup {
  mode: DuelMode;
  characters: [CharacterId, CharacterId];
  difficulty?: Difficulty;
  /** The player seen from behind / shown on the left. */
  localView: PlayerIndex;
  net?: NetLink;
  isHost?: boolean;
}

export type DuelExit = { kind: 'menu' } | { kind: 'rematch' };

interface Run {
  ex: number;
  plan: ExchangePlan;
  t0: number;
  logs: [InputEvent[], InputEvent[]];
  cpuQueue: InputEvent[];
  fired: Set<string>;
  res: ExchangeResult | null;
  remoteUpTo: number;
  promptEls: { zone: HTMLElement; tile: HTMLElement; hold?: HTMLElement }[][];
  drawEls: ({ zone: HTMLElement; tile: HTMLElement; ring: SVGCircleElement; band: SVGCircleElement } | null)[];
  lastJam: [number, number];
  lastUpSent: number;
}

const NAMES: Record<CharacterId, string> = { hector: 'BIG HAT HECTOR', dusty: "LIL' DUSTY", mercy: 'SISTER MERCY' };
const LEAD_MS = 1300;

export class Duel {
  state: MatchState;
  private run: Run | null = null;
  private phase: 'intro' | 'exchange' | 'aftermath' | 'choice' | 'over' | 'waiting' | 'paused' = 'intro';
  private root: HTMLElement;
  private hud: HTMLElement;
  private fx: HTMLElement;
  private zones: HTMLElement;
  private top: HTMLElement;
  private timers: { at: number; fn: () => void }[] = [];
  private unsub: (() => void)[] = [];
  private lastDevicePad: [boolean, boolean] = [false, false];
  private willChoice: WillChoice | null = null;
  private choiceDeadline = 0;
  private pausedAt = 0;
  private lastRemoteHeard = performance.now();
  private exCounter = 0;
  private washL = 0;
  private washR = 0;
  private flash = 0;
  private outcomeAt = 0;
  private disposed = false;

  constructor(private ctx: AppCtx, private setup: DuelSetup, private onExit: (e: DuelExit) => void) {
    this.state = newMatch(setup.characters[0], setup.characters[1]);
    this.root = h('div', { class: 'layer' });
    this.zones = h('div', { class: 'layer' });
    this.fx = h('div', { class: 'layer' });
    this.hud = h('div', { class: 'layer' });
    this.top = h('div', { class: 'layer' });
    this.root.append(this.zones, this.fx, this.hud, this.top);
    ctx.ui.append(this.root);

    const { stage } = ctx;
    const near = setup.characters[setup.localView];
    const far = setup.characters[setup.localView === 0 ? 1 : 0];
    stage.setMode('duel');
    stage.setDuelists(near, far);
    stage.setSmokeCloud(false);
    stage.setPush(0);
    stage.setHalo('near', 0);
    stage.setHalo('far', 0);
    ctx.input.twoPlayers = setup.mode === 'local';
    ctx.input.soloPlayer = setup.mode === 'local' ? 0 : setup.localView;
    this.unsub.push(ctx.input.onGame((e) => this.onInput(e)));
    this.unsub.push(ctx.input.onMenu((m) => { if (m === 'back') this.togglePause(); }));
    if (setup.net) this.unsub.push(setup.net.on((m) => this.onNet(m)));

    ctx.audio.music('duel');
    ctx.audio.wind(true);
    this.renderHud();
    this.intro();
  }

  // ------------------------------------------------------------ helpers

  private side(i: PlayerIndex): ScreenSide { return i === this.setup.localView ? 'near' : 'far'; }
  private isLocalHuman(i: PlayerIndex): boolean {
    if (this.setup.mode === 'local') return true;
    return i === this.setup.localView;
  }
  private isCpu(i: PlayerIndex): boolean { return this.setup.mode === 'cpu' && i !== this.setup.localView; }
  private pan(i: PlayerIndex) { return this.side(i) === 'near' ? -0.3 : 0.3; }
  private after(ms: number, fn: () => void) { this.timers.push({ at: performance.now() + ms, fn }); }
  private bindingIndex(i: PlayerIndex): PlayerIndex { return this.setup.mode === 'local' ? i : 0; }

  private keyFor(i: PlayerIndex, slot: number): string {
    if (this.isCpu(i)) return keyLabel(this.ctx.settings.keys[1].prompt[slot]);
    if (!this.isLocalHuman(i)) return '?';
    const b = this.bindingIndex(i);
    return this.lastDevicePad[i] ? padLabel(this.ctx.settings.pads[b].prompt[slot]) : keyLabel(this.ctx.settings.keys[b].prompt[slot]);
  }
  private healKey(i: PlayerIndex): string {
    const b = this.bindingIndex(i);
    return this.lastDevicePad[i] ? padLabel(this.ctx.settings.pads[b].heal) : keyLabel(this.ctx.settings.keys[b].heal);
  }
  private feintKey(i: PlayerIndex): string {
    const b = this.bindingIndex(i);
    return this.lastDevicePad[i] ? padLabel(this.ctx.settings.pads[b].feint) : keyLabel(this.ctx.settings.keys[b].feint);
  }

  private banner(text: string, ms = 1200, cls = '') {
    const el = h('div', { class: `banner ${cls}` }, text);
    this.top.append(el);
    this.after(ms, () => el.remove());
    return el;
  }
  private shoutAt(text: string, ms: number, cls = 'slam', pos?: { x: number; y: number }) {
    const el = shout(text, cls);
    const wrap = pos
      ? h('div', { class: 'float-tag', style: `left:${pos.x * 100}%;top:${pos.y * 100}%` }, el)
      : h('div', { class: 'center burst' }, el);
    this.top.append(wrap);
    this.after(ms, () => wrap.remove());
  }
  private toast(text: string, ms = 2500) {
    const el = h('div', { class: 'toast' }, text);
    this.top.append(el);
    this.after(ms, () => el.remove());
  }

  // ------------------------------------------------------------ HUD

  private renderHud(res?: ExchangeResult | null, crack: [boolean, boolean] = [false, false]) {
    clear(this.hud);
    for (const i of [0, 1] as PlayerIndex[]) {
      const p = this.state.players[i];
      const hearts = res ? res.hearts[i] : p.hearts;
      const left = this.side(i) === 'near';
      const tag = this.setup.mode === 'local' ? `P${i + 1}` : this.isCpu(i) ? 'CPU' : this.isLocalHuman(i) ? 'YOU' : 'RIVAL';
      const col = h('div', { class: `hud-side ${left ? 'left' : 'right'}` });
      col.append(h('div', { class: 'hud-name' }, h('span', { class: 'tagp' }, tag), NAMES[p.character]));
      const hr = h('div', { class: 'row' });
      for (let k = 0; k < CONFIG.hearts; k++) {
        const full = k < hearts;
        const cracking = crack[i] && k === hearts;
        const el = h('div', { class: `heart ${cracking ? 'crack' : ''}`, html: heartSvg(full ? 'full' : cracking ? 'cracked' : 'empty') });
        hr.append(el);
      }
      col.append(hr);
      const items = h('div', { class: 'row' });
      const healName = p.character === 'hector' ? 'WHISKEY' : p.character === 'dusty' ? 'CIGAR' : null;
      if (healName) {
        const total = CONFIG.characters[p.character].heals;
        for (let k = 0; k < total; k++) {
          items.append(h('div', { class: `item ${k < p.healsLeft - (res?.healed[i] ? 1 : 0) ? '' : 'used'}` }, healName));
        }
      } else {
        const pips = h('div', { class: 'row' });
        for (let k = 0; k < CONFIG.mercy.chargeForWill; k++) pips.append(h('div', { class: `pip ${k < p.charge ? 'on' : ''}` }));
        items.append(h('div', { class: 'item' }, p.charge >= CONFIG.mercy.chargeForWill ? 'WILL OF GOD' : 'CHARGE'), pips);
      }
      col.append(items);
      if (res && this.phase === 'exchange') {
        const fl = h('div', { class: 'row' });
        for (let k = 0; k < CONFIG.draw.maxFlinches; k++) fl.append(h('div', { class: `flinch ${k < res.flinches[i] ? 'on' : ''}` }));
        col.append(fl);
        if (res.lastStand[i]) col.append(h('div', { class: 'item' }, 'LAST STAND'));
      }
      this.hud.append(col);
    }
  }
  private hudKey = '';
  private maybeHud(res: ExchangeResult) {
    const key = JSON.stringify([res.hearts, res.flinches, res.healed, res.lastStand, this.phase]);
    if (key !== this.hudKey) { this.hudKey = key; this.renderHud(res); }
  }

  // ------------------------------------------------------------ flow

  private intro() {
    this.phase = 'intro';
    const { stage, audio } = this.ctx;
    stage.setPose('near', 'idle');
    stage.setPose('far', 'idle');
    this.shoutAt('HIGH NOON', 1600);
    audio.sfx('spurs');
    this.after(500, () => audio.voice(this.state.players[1].character, 'taunt', { pan: this.pan(1) }));
    this.after(1100, () => audio.voice(this.state.players[0].character, 'taunt', { pan: this.pan(0) }));
    this.after(1900, () => this.nextExchange());
  }

  private nextExchange() {
    if (this.disposed) return;
    if (this.setup.mode === 'online') {
      if (!this.setup.isHost) { this.phase = 'waiting'; return; }
      const plan = generatePlan(randomSeed());
      const ex = ++this.exCounter;
      this.setup.net!.send({ type: 'plan', ex, plan, state: this.state, lead: LEAD_MS });
      this.begin(ex, plan, performance.now() + LEAD_MS);
      return;
    }
    this.begin(++this.exCounter, generatePlan(randomSeed()), performance.now() + 500);
  }

  private begin(ex: number, plan: ExchangePlan, t0: number) {
    clear(this.zones);
    const run: Run = {
      ex, plan, t0, logs: [[], []], cpuQueue: [], fired: new Set(), res: null, remoteUpTo: -Infinity,
      promptEls: plan.prompts.map(() => []), drawEls: [null, null], lastJam: [0, 0], lastUpSent: 0,
    };
    for (const i of [0, 1] as PlayerIndex[]) {
      if (this.isCpu(i)) run.cpuQueue = cpuExchangeLog(plan, this.state, i, this.setup.difficulty ?? 'normal', makeRng(plan.seed ^ 0x9e3779b9));
    }
    this.run = run;
    this.phase = 'exchange';
    this.willChoice = null;
    const { stage } = this.ctx;
    stage.setPush(0);
    stage.setPose('near', 'idle');
    stage.setPose('far', 'idle');
    for (const i of [0, 1] as PlayerIndex[]) {
      stage.setDrunk(this.side(i), false);
      const p = this.state.players[i];
      if (p.character === 'mercy') stage.setHalo(this.side(i), p.charge);
    }
    stage.setSmokeCloud(this.state.smoke[0] || this.state.smoke[1]);
    this.hudKey = '';
  }

  /** Called every frame by the app. */
  frame(now: number) {
    if (this.disposed) return;
    this.ctx.input.poll();
    for (const t of [...this.timers]) if (now >= t.at) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); }
    this.updateWash();
    if (this.phase === 'paused') return;
    if (this.setup.mode === 'online') this.netTick(now);
    const run = this.run;
    if (!run) return;
    const t = now - run.t0;
    if (this.phase === 'choice') this.choiceTick(now);
    if (this.phase !== 'exchange') return;
    if (t < 0) return;

    // CPU inputs that are due
    while (run.cpuQueue.length && run.cpuQueue[0].t <= t) {
      const ev = run.cpuQueue.shift()!;
      const cpu = this.isCpu(0) ? 0 : 1;
      run.logs[cpu].push(ev);
      this.onAnyEvent(cpu as PlayerIndex, ev);
    }

    const tEff = this.setup.mode === 'online' ? Math.min(t, run.remoteUpTo) : t;
    const res = resolveExchange(run.plan, this.state, run.logs, Math.max(0, tEff));
    run.res = res;
    this.present(run, res, t);
    if (res.done && res.outcome) this.outcome(run, res);
  }

  // ------------------------------------------------------------ presentation during the exchange

  private once(run: Run, key: string, fn: () => void) {
    if (run.fired.has(key)) return;
    run.fired.add(key);
    fn();
  }

  private present(run: Run, res: ExchangeResult, t: number) {
    const { stage, audio } = this.ctx;
    const plan = run.plan;
    this.maybeHud(res);

    this.once(run, 'ready', () => {
      this.banner('READY...', CONFIG.readyMs - 200);
      audio.heartbeat(!this.localLastStand(res), 70);
      for (const i of [0, 1] as PlayerIndex[]) {
        if (!this.isLocalHuman(i) || !canHeal(this.state.players[i])) continue;
        const nm = this.state.players[i].character === 'hector' ? 'WHISKEY' : 'CIGAR';
        const zone = this.zoneFor(i);
        zone.append(h('div', { class: 'pop-in' }, (() => { const tl = tile(this.healKey(i), 'small'); tl.append(h('span', { class: 'tag' }, nm)); return tl; })()));
        this.after(CONFIG.readyMs - 150, () => zone.remove());
      }
      if (this.state.smoke.some(Boolean)) this.banner('SMOKE IN THE AIR', 1200, 'small');
    });

    for (const i of [0, 1] as PlayerIndex[]) {
      if (res.healed[i]) this.once(run, `heal${i}`, () => {
        const ch = this.state.players[i].character;
        stage.setPose(this.side(i), 'heal');
        stage.fx(ch === 'hector' ? 'whiskey' : 'cigarSmoke', this.side(i));
        audio.sfx(ch === 'hector' ? 'glassClink' : 'cigarPuff', { pan: this.pan(i) });
        audio.voice(ch, 'drink', { pan: this.pan(i) });
        if (ch === 'hector') stage.setDrunk(this.side(i), true);
        this.after(900, () => stage.setPose(this.side(i), 'idle'));
      });
    }

    // Nerve prompts
    plan.prompts.forEach((p, k) => {
      if (t < p.t) return;
      this.once(run, `prompt${k}`, () => {
        stage.setPush(k + 1);
        clear(this.zones);
        for (const i of [0, 1] as PlayerIndex[]) {
          const zone = this.zoneFor(i);
          const tl = tile(this.keyFor(i, p.slots[i]), this.isLocalHuman(i) ? 'big pop-in' : 'pop-in');
          if (p.hold) { tl.append(h('span', { class: 'tag' }, 'HOLD')); tl.append(h('div', { class: 'hold' }, h('i'))); }
          const holder = h('div', { class: res.drunk[i] ? 'wobble' : '' }, tl);
          zone.append(holder);
          if (this.state.smoke[i]) zone.append(h('div', { class: 'smoke-cover' }));
          run.promptEls[k][i] = { zone, tile: tl, hold: tl.querySelector('.hold i') as HTMLElement | undefined };
        }
        audio.sfx('uiMove', { gain: 0.6 });
        if (k === 1) {
          const who: PlayerIndex = Math.random() < 0.5 ? 0 : 1;
          audio.voice(this.state.players[who].character, 'mutter', { pan: this.pan(who) });
        }
      });
      const end = p.t + CONFIG.nerve.promptWindowMs + 250;
      for (const i of [0, 1] as PlayerIndex[]) {
        const el = run.promptEls[k][i];
        if (!el) continue;
        const r = res.prompts[k][i];
        if (r.holding && el.hold) el.hold.style.width = `${Math.min(100, ((t - (r.pressT ?? t)) / CONFIG.nerve.holdMs) * 100)}%`;
        if (r.pressT !== null) el.tile.classList.add('down');
        if (r.status === 'ok') {
          this.once(run, `ok${k}${i}`, () => { el.tile.classList.add('ok'); if (el.hold) el.hold.style.width = '100%'; if (this.isLocalHuman(i)) audio.sfx('promptGood', { pan: this.pan(i) }); });
        } else if (r.status !== 'pending') {
          this.once(run, `bad${k}${i}`, () => {
            el.tile.classList.remove('ok');
            el.tile.classList.add('bad');
            el.tile.append(h('span', { class: 'tag' }, r.status === 'beaten' ? 'STARED DOWN' : r.status === 'slow' ? 'TOO SLOW' : 'FLINCH'));
            audio.sfx('flinch', { pan: this.pan(i) });
            stage.setPose(this.side(i), 'flinch');
            this.after(350, () => { if (this.phase === 'exchange' && t < plan.bellT) stage.setPose(this.side(i), 'idle'); });
          });
        }
      }
      if (t >= end) this.once(run, `promptEnd${k}`, () => {
        for (const el of run.promptEls[k]) el?.zone.remove();
      });
    });

    // Standoff
    if (t >= plan.standoffStart) this.once(run, 'standoff', () => {
      clear(this.zones);
      this.banner('STEADY...', 900);
      audio.drumroll(Math.min(1600, plan.bellT - plan.standoffStart - 200));
      for (const i of [0, 1] as PlayerIndex[]) {
        stage.setPose(this.side(i), 'ready');
        if (this.isLocalHuman(i) && CONFIG.characters[this.state.players[i].character].canFeint && this.setup.mode !== 'local') {
          this.banner(`${this.feintKey(i)}: FEINT`, 1600, 'small');
        }
      }
    });
    for (const f of plan.fakes) {
      if (t >= f.t) this.once(run, `fake${f.t}`, () => {
        stage.fake(f.kind);
        audio.sfx(f.kind === 'door' ? 'door' : f.kind);
      });
    }
    for (const f of res.feints) {
      if (f.status === 'bit') this.once(run, `bite${f.by}`, () => {
        const v: PlayerIndex = f.by === 0 ? 1 : 0;
        stage.setPose(this.side(v), 'flinch');
        this.banner(`${this.tagOf(v)} BIT THE FEINT!`, 1100, 'small');
        audio.sfx('flinch', { pan: this.pan(v) });
        this.after(400, () => stage.setPose(this.side(v), 'ready'));
      });
      if (f.status === 'whiff') this.once(run, `whiff${f.by}`, () => this.banner('NO BITE', 800, 'small'));
    }

    // Bell
    if (t >= plan.bellT) {
      this.once(run, 'bell', () => {
        stage.ringBell();
        audio.sfx('bellToll');
        audio.sfx('fuego');
        audio.duck(0.7, 1200);
        audio.heartbeat(false);
        this.shoutAt('FUEGO!', 900, 'slam huge');
        clear(this.zones);
        for (const i of [0, 1] as PlayerIndex[]) {
          const zone = this.zoneFor(i);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'ring');
          svg.setAttribute('viewBox', '-50 -50 100 100');
          const band = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          band.setAttribute('fill', 'none');
          band.setAttribute('stroke', '#e8b33c');
          band.setAttribute('opacity', '0.85');
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          ring.setAttribute('fill', 'none');
          ring.setAttribute('stroke', '#f2e6c9');
          ring.setAttribute('stroke-width', '2.4');
          ring.setAttribute('stroke-dasharray', '3 2');
          svg.append(band, ring);
          const tl = tile(this.keyFor(i, plan.drawSlots[i]), this.isLocalHuman(i) ? 'big pop-in' : 'pop-in');
          zone.append(svg, tl);
          if (this.state.smoke[i]) zone.append(h('div', { class: 'smoke-cover' }));
          run.drawEls[i] = { zone, tile: tl, ring, band };
          this.setBand(band, res.goldBand[i], this.isLocalHuman(i));
        }
      });
      const dt = t - plan.bellT;
      for (const i of [0, 1] as PlayerIndex[]) {
        const el = run.drawEls[i];
        if (!el) continue;
        const r = ringRadius(dt);
        el.ring.setAttribute('r', String(Math.max(0, r)));
        el.ring.setAttribute('opacity', dt > CONFIG.draw.ringMs ? '0' : '1');
        if (res.jammedUntil[i] > run.lastJam[i]) {
          run.lastJam[i] = res.jammedUntil[i];
          el.tile.classList.remove('bad');
          void el.tile.offsetWidth;
          el.tile.classList.add('bad');
          audio.sfx('jam', { pan: this.pan(i) });
          stage.setPose(this.side(i), 'jam');
          this.banner(`${this.tagOf(i)} JAMMED!`, 700, 'small');
        }
        if (res.draws[i]) this.once(run, `drew${i}`, () => {
          el.tile.classList.add('down', 'ok');
          stage.setPose(this.side(i), 'draw');
        });
      }
    }
  }

  private setBand(band: SVGCircleElement, width: number, mine: boolean) {
    if (width <= 0) { band.setAttribute('stroke-width', '0'); return; }
    const c = CONFIG.draw.goldCenterMs;
    const r1 = ringRadius(c - width / 2);
    const r2 = ringRadius(c + width / 2);
    band.setAttribute('r', String((r1 + r2) / 2));
    band.setAttribute('stroke-width', String(Math.max(1.5, r1 - r2)));
    if (!mine) band.setAttribute('opacity', '0.5');
  }

  private localLastStand(res: ExchangeResult) {
    if (this.setup.mode === 'local') return res.lastStand[0] || res.lastStand[1];
    return res.lastStand[this.setup.localView];
  }

  private tagOf(i: PlayerIndex) {
    if (this.setup.mode === 'local') return `P${i + 1}`;
    if (this.isCpu(i)) return 'CPU';
    return this.isLocalHuman(i) ? 'YOU' : 'RIVAL';
  }

  private zoneFor(i: PlayerIndex): HTMLElement {
    const left = this.side(i) === 'near';
    const solo = this.setup.mode !== 'local' && !left;
    const zone = h('div', { class: `prompt-zone ${left ? 'left' : solo ? 'right solo-right' : 'right'}` });
    this.zones.append(zone);
    return zone;
  }

  // ------------------------------------------------------------ input

  private onInput(e: GameInput) {
    const i = e.player;
    if (!this.isLocalHuman(i)) return;
    this.lastDevicePad[i] = e.pad;
    if (this.phase === 'choice') { this.choiceInput(i, e); return; }
    const run = this.run;
    if (!run || this.phase !== 'exchange') return;
    const t = e.t - run.t0;
    if (t < 0) return;
    const ev: InputEvent = e.kind === 'press' || e.kind === 'release' ? { t, kind: e.kind, slot: e.slot } : { t, kind: e.kind };
    run.logs[i].push(ev);
    if (this.setup.mode === 'online') this.setup.net!.send({ type: 'input', ex: run.ex, ev });
    this.onAnyEvent(i, ev);
  }

  /** Immediate, cosmetic reactions to an input from anyone (human, CPU, remote). */
  private onAnyEvent(i: PlayerIndex, ev: InputEvent) {
    const run = this.run;
    if (!run) return;
    const { stage, audio } = this.ctx;
    const plan = run.plan;
    if (ev.kind === 'feint' && ev.t >= plan.standoffStart && ev.t < plan.bellT && CONFIG.characters[this.state.players[i].character].canFeint) {
      this.once(run, `feint${i}`, () => {
        stage.setPose(this.side(i), 'feint');
        audio.sfx('feint', { pan: this.pan(i) });
        this.after(450, () => { if (this.phase === 'exchange') stage.setPose(this.side(i), 'ready'); });
        const v: PlayerIndex = i === 0 ? 1 : 0;
        if (this.isCpu(v)) {
          const delay = cpuFeintReaction(this.setup.difficulty ?? 'normal', makeRng(plan.seed + Math.round(ev.t)));
          if (delay !== null) {
            // The CPU flinches at the feint; drop its planned fake-fall so it isn't punished twice.
            run.cpuQueue = run.cpuQueue.filter((q) => !(q.kind === 'press' && q.t < plan.bellT && q.t > ev.t));
            run.cpuQueue.push({ t: ev.t + delay, kind: 'press', slot: 0 });
            run.cpuQueue.sort((a, b) => a.t - b.t);
          }
        }
      });
    }
  }

  // ------------------------------------------------------------ outcome

  private outcome(_run: Run, res: ExchangeResult) {
    if (this.phase !== 'exchange') return;
    this.phase = 'aftermath';
    this.outcomeAt = performance.now();
    const o = res.outcome!;
    const { stage, audio, settings } = this.ctx;
    clear(this.zones);
    audio.heartbeat(false);
    const lethal = (i: PlayerIndex) => res.hearts[i] - o.damage[i] <= 0;
    const crack: [boolean, boolean] = [o.damage[0] > 0, o.damage[1] > 0];

    const fire = (i: PlayerIndex, wide = false) => {
      const s = this.side(i);
      const ch = this.state.players[i].character;
      stage.setPose(s, 'fire');
      if (ch === 'mercy') {
        stage.fx('lanternFlash', s);
        audio.sfx('lanternWhoosh', { pan: this.pan(i) });
      } else if (ch === 'dusty') {
        stage.fx('shotgunBlast', s);
        stage.fx('smokePuff', s);
        audio.sfx('shotgun', { pan: this.pan(i) });
        if (settings.shake) stage.shake(0.8);
      } else {
        stage.fx('muzzle', s);
        stage.fx('sparks', s);
        audio.sfx('gunshot', { pan: this.pan(i) });
        if (settings.shake) stage.shake(0.35);
      }
      if (wide) this.after(300, () => this.banner('...WIDE!', 700, 'small'));
    };
    const hit = (i: PlayerIndex) => {
      const s = this.side(i);
      const dead = lethal(i);
      stage.setPose(s, dead ? 'dead' : 'hit');
      audio.sfx('hit', { pan: this.pan(i) });
      audio.sfx('heartCrack', { pan: this.pan(i), gain: 0.7 });
      audio.voice(this.state.players[i].character, dead ? 'death' : 'hit', { pan: this.pan(i) });
      this.shoutAt('POP!', 900, 'slam', stage.screenPos(s, 'head'));
      audio.sfx('pop');
      if (dead) { stage.fx('hatFly', s); stage.fx('dust', s); this.after(500, () => audio.sfx('fall', { pan: this.pan(i) })); audio.sfx('hatFly'); }
    };
    const doFlash = (amt: number) => { this.flash = settings.reduceFlashing ? amt * 0.35 : amt; };
    const freeze = (perfect: boolean) => {
      stage.punch();
      if (perfect && !settings.reducedMotion) { stage.slowmo(0.2, 1300); audio.sfx('perfect'); this.banner('DEAD-EYE!', 1300); }
      else if (!settings.reducedMotion) stage.slowmo(0.04, 170);
    };

    switch (o.kind) {
      case 'early': {
        const i = o.actor!;
        stage.setPose(this.side(i), 'draw');
        audio.sfx('click', { pan: this.pan(i) });
        audio.sfx('boo');
        const what = o.fake ? { crow: 'IT WAS A CROW!', tumbleweed: 'IT WAS A TUMBLEWEED!', door: 'IT WAS THE SALOON DOOR!', cough: 'SOMEBODY COUGHED!' }[o.fake.kind] : 'NO BELL YET!';
        this.shoutAt('TOO EARLY', 1500);
        this.banner(`${this.tagOf(i)}: ${what}`, 2200, 'small');
        this.after(500, () => { stage.setPose(this.side(i), 'flinch'); audio.voice(this.state.players[i].character, 'hit', { pan: this.pan(i) }); });
        if (lethal(i)) this.after(700, () => { stage.setPose(this.side(i), 'dead'); stage.fx('hatFly', this.side(i)); });
        break;
      }
      case 'reset': {
        stage.fake('tumbleweed');
        audio.sfx('tumbleweed');
        this.shoutAt('NOBODY DREW', 1500);
        break;
      }
      case 'shot': {
        const a = o.actor!;
        const b: PlayerIndex = a === 0 ? 1 : 0;
        fire(a);
        if (res.draws[b]) this.after(120, () => fire(b, true));
        this.after(60, () => hit(b));
        doFlash(0.8);
        freeze(o.perfect[a]);
        this.after(1100, () => { if (!lethal(a)) audio.voice(this.state.players[a].character, 'gloat', { pan: this.pan(a) }); });
        break;
      }
      case 'trade': {
        fire(0); fire(1);
        this.after(60, () => { hit(0); hit(1); });
        doFlash(1);
        freeze(o.perfect[0] || o.perfect[1]);
        this.banner('TRADE!', 1400);
        break;
      }
      case 'blind':
      case 'mutualBlind': {
        const victims = ([0, 1] as PlayerIndex[]).filter((i) => o.blinded[i]);
        for (const i of [0, 1] as PlayerIndex[]) if (this.state.players[i].character === 'mercy' && (o.kind === 'mutualBlind' || o.actor === i)) fire(i);
        audio.sfx('blind');
        for (const v of victims) {
          stage.setPose(this.side(v), 'blinded');
          if (this.side(v) === 'near') this.washL = 1; else this.washR = 1;
          if (res.draws[v] && this.state.players[v].character !== 'mercy') this.after(150, () => fire(v, true));
        }
        doFlash(0.5);
        stage.punch();
        this.shoutAt('BLINDED!', 1400);
        if (o.actor !== null) {
          const m = this.state.players[o.actor];
          stage.setHalo(this.side(o.actor), Math.min(2, m.charge + 1));
          this.after(900, () => audio.voice('mercy', 'hum', { pan: this.pan(o.actor!) }));
        }
        break;
      }
      case 'will': {
        const m = o.actor!;
        fire(m);
        audio.sfx('choir');
        stage.setPose(this.side(m), 'pray');
        stage.setHalo(this.side(m), 2);
        doFlash(0.6);
        this.shoutAt('WILL OF GOD', 1600);
        this.startChoice(m, res);
        return;
      }
    }
    this.renderHud(null, crack);
    this.renderHudAfter(res, crack);
    this.after(o.kind === 'reset' ? CONFIG.resetMessageMs : CONFIG.aftermathMs, () => this.finishExchange(res, null));
  }

  private renderHudAfter(res: ExchangeResult, crack: [boolean, boolean]) {
    const preview = { ...this.state, players: this.state.players.map((p, i) => ({ ...p, hearts: Math.max(0, res.hearts[i] - res.outcome!.damage[i]) })) } as MatchState;
    const saved = this.state;
    this.state = preview;
    this.renderHud(null, crack);
    this.state = saved;
  }

  // Will of God choice
  private choiceFor: PlayerIndex = 0;
  private choiceRes: ExchangeResult | null = null;
  private startChoice(m: PlayerIndex, res: ExchangeResult) {
    this.phase = 'choice';
    this.choiceFor = m;
    this.choiceRes = res;
    this.willChoice = null;
    const canHealNow = !this.state.players[m].fullHealUsed;
    if (this.isCpu(m)) { this.after(1100, () => this.resolveChoice('vaporize')); return; }
    if (!this.isLocalHuman(m)) { this.choiceDeadline = performance.now() + 6000; return; }
    this.choiceDeadline = performance.now() + 3200;
    const row = h('div', { class: 'choice-row' });
    const v = h('div', {}, tile(this.keyFor(m, this.run!.plan.drawSlots[m]), 'big'), 'VAPORIZE');
    row.append(v);
    if (canHealNow) row.append(h('div', {}, tile(this.healKey(m), 'big'), 'FULL HEAL'));
    const panel = h('div', { class: 'center', style: 'top:62%' }, row);
    panel.id = 'will-choice';
    this.top.append(panel);
  }
  private choiceInput(i: PlayerIndex, e: GameInput) {
    if (i !== this.choiceFor || this.willChoice) return;
    if (e.kind === 'heal') this.resolveChoice('heal');
    else if (e.kind === 'press') this.resolveChoice('vaporize');
  }
  private choiceTick(now: number) {
    if (!this.willChoice && this.isLocalHuman(this.choiceFor) && now > this.choiceDeadline) this.resolveChoice('vaporize');
    if (!this.willChoice && !this.isLocalHuman(this.choiceFor) && !this.isCpu(this.choiceFor) && now > this.choiceDeadline) this.resolveChoice('vaporize');
  }
  private resolveChoice(choice: WillChoice) {
    if (this.willChoice || this.phase !== 'choice') return;
    const m = this.choiceFor;
    const res = this.choiceRes!;
    const real = choice === 'heal' && !this.state.players[m].fullHealUsed ? 'heal' : 'vaporize';
    this.willChoice = real;
    document.getElementById('will-choice')?.remove();
    if (this.setup.mode === 'online' && this.isLocalHuman(m)) this.setup.net!.send({ type: 'choice', ex: this.run!.ex, choice: real });
    const { stage, audio } = this.ctx;
    const v: PlayerIndex = m === 0 ? 1 : 0;
    this.phase = 'aftermath';
    if (real === 'vaporize') {
      stage.fx('lanternFlash', this.side(m));
      this.after(250, () => { stage.fx('vaporize', this.side(v)); audio.sfx('vaporize'); this.shoutAt('VAPORIZED', 1600); });
      this.flash = this.ctx.settings.reduceFlashing ? 0.35 : 1;
    } else {
      stage.fx('heal', this.side(m));
      audio.sfx('heal');
      this.shoutAt('FULL HEAL', 1400);
    }
    this.after(CONFIG.aftermathMs, () => this.finishExchange(res, real));
  }

  private finishExchange(res: ExchangeResult, choice: WillChoice | null) {
    if (this.disposed) return;
    const { state } = applyExchange(this.state, res, choice);
    this.state = state;
    this.washL = Math.min(this.washL, 0.6);
    this.washR = Math.min(this.washR, 0.6);
    const { stage } = this.ctx;
    for (const i of [0, 1] as PlayerIndex[]) {
      if (state.players[i].character === 'mercy') stage.setHalo(this.side(i), state.players[i].charge);
    }
    this.renderHud();
    if (state.winner !== null) { this.matchOver(); return; }
    this.nextExchange();
  }

  private matchOver() {
    this.phase = 'over';
    clear(this.zones);
    const { stage, audio } = this.ctx;
    const w = this.state.winner;
    audio.heartbeat(false);
    if (w === 'draw') {
      this.shoutAt('DRAW', 99999);
      audio.music('lose');
    } else {
      stage.setPose(this.side(w!), 'win');
      audio.voice(this.state.players[w!].character, 'gloat', { pan: this.pan(w!) });
      const humanWon = this.setup.mode === 'local' || this.isLocalHuman(w!);
      audio.music(humanWon ? 'win' : 'lose');
      if (humanWon) audio.sfx('cheer');
      const who = this.setup.mode === 'local' ? `P${w! + 1} WINS` : this.isLocalHuman(w!) ? 'YOU WIN' : 'YOU LOSE';
      this.shoutAt(who, 99999);
    }
    this.after(1600, () => {
      const menu = h('div', { class: 'menu', style: 'position:absolute;left:50%;bottom:12%;transform:translateX(-50%)' });
      const again = h('button', { class: 'sel' }, this.setup.mode === 'online' ? 'REMATCH' : 'RUN IT BACK');
      const quit = h('button', {}, 'MAIN MENU');
      again.onclick = () => this.exit({ kind: 'rematch' });
      quit.onclick = () => this.exit({ kind: 'menu' });
      menu.append(again, quit);
      this.top.append(menu);
      let sel = 0;
      const btns = [again, quit];
      const off = this.ctx.input.onMenu((m) => {
        if (m === 'up' || m === 'down') { sel = 1 - sel; btns.forEach((b, k) => b.classList.toggle('sel', k === sel)); this.ctx.audio.sfx('uiMove'); }
        if (m === 'confirm') { this.ctx.audio.sfx('uiSelect'); btns[sel].click(); }
      });
      this.unsub.push(off);
    });
  }

  // ------------------------------------------------------------ pause

  private togglePause() {
    if (this.phase === 'over') return;
    if (this.setup.mode === 'online') {
      if (this.phase === 'paused') { this.phase = this.prevPhase; document.getElementById('pause')?.remove(); return; }
      this.prevPhase = this.phase;
      this.showPause(true);
      this.phase = 'paused';
      return;
    }
    if (this.phase === 'paused') {
      const d = performance.now() - this.pausedAt;
      if (this.run) this.run.t0 += d;
      for (const t of this.timers) t.at += d;
      this.phase = this.prevPhase;
      document.getElementById('pause')?.remove();
      return;
    }
    this.prevPhase = this.phase;
    this.pausedAt = performance.now();
    this.phase = 'paused';
    this.showPause(false);
  }
  private prevPhase: Duel['phase'] = 'exchange';
  private showPause(online: boolean) {
    const panel = h('div', { class: 'screen dim', id: 'pause' });
    panel.append(h('div', { class: 'title-label' }, online ? 'LEAVE THE DUEL?' : 'PAUSED'));
    const m = h('div', { class: 'menu' });
    const resume = h('button', { class: 'sel' }, online ? 'STAY' : 'RESUME');
    const quit = h('button', {}, 'QUIT TO MENU');
    resume.onclick = () => this.togglePause();
    quit.onclick = () => this.exit({ kind: 'menu' });
    m.append(resume, quit);
    panel.append(m, h('div', { class: 'hint' }, online ? 'The duel keeps running while this is open.' : 'ESC to resume'));
    this.top.append(panel);
    let sel = 0;
    const btns = [resume, quit];
    const off = this.ctx.input.onMenu((mi) => {
      if (!document.getElementById('pause')) { off(); return; }
      if (mi === 'up' || mi === 'down') { sel = 1 - sel; btns.forEach((b, k) => b.classList.toggle('sel', k === sel)); }
      if (mi === 'confirm') btns[sel].click();
    });
  }

  // ------------------------------------------------------------ online

  private netTick(now: number) {
    const run = this.run;
    const net = this.setup.net!;
    if (run && (this.phase === 'exchange' || this.phase === 'paused') && now - run.lastUpSent > 80) {
      run.lastUpSent = now;
      net.send({ type: 'upto', ex: run.ex, t: now - run.t0 });
    }
    // keep-alive so the other side can spot a disconnect between exchanges too
    if (now - this.lastPing > 500) { this.lastPing = now; net.send({ type: 'ping' }); }
    const silent = now - this.lastRemoteHeard;
    if (this.phase === 'exchange' && silent > 3000) {
      this.phase = 'waiting';
      this.run = null;
      clear(this.zones);
      this.ctx.audio.heartbeat(false);
      this.toast('CONNECTION HICCUP: RESTARTING THE EXCHANGE', 3000);
      this.hiccup = true;
    }
    if (silent > 20000 && this.phase !== 'over') {
      this.toast('YOUR RIVAL RODE OFF (DISCONNECTED)', 4000);
      this.phase = 'over';
      this.after(3000, () => this.exit({ kind: 'menu' }));
    }
  }
  private lastPing = 0;
  private hiccup = false;

  private onNet(m: NetMsg) {
    this.lastRemoteHeard = performance.now();
    const remote: PlayerIndex = this.setup.localView === 0 ? 1 : 0;
    if (this.hiccup && this.setup.isHost && this.phase === 'waiting') {
      this.hiccup = false;
      this.after(600, () => this.nextExchange());
    }
    switch (m.type) {
      case 'plan':
        if (this.setup.isHost) return;
        this.state = m.state;
        this.exCounter = m.ex;
        this.hiccup = false;
        this.renderHud();
        this.begin(m.ex, m.plan, performance.now() + m.lead);
        break;
      case 'input':
        if (this.run && m.ex === this.run.ex) {
          this.run.logs[remote].push(m.ev);
          this.onAnyEvent(remote, m.ev);
        }
        break;
      case 'upto':
        if (this.run && m.ex === this.run.ex) this.run.remoteUpTo = Math.max(this.run.remoteUpTo, m.t);
        break;
      case 'choice':
        if (this.run && m.ex === this.run.ex && this.phase === 'choice') this.resolveChoice(m.choice);
        break;
      case 'bye':
        this.toast('YOUR RIVAL LEFT THE DUEL', 3000);
        this.phase = 'over';
        this.after(2500, () => this.exit({ kind: 'menu' }));
        break;
      case 'rematch':
        this.toast('RIVAL WANTS A REMATCH', 2500);
        this.remoteRematch = true;
        break;
    }
  }
  remoteRematch = false;

  // ------------------------------------------------------------ post FX + teardown

  private updateWash() {
    const k = this.ctx.settings.reducedMotion ? 0.03 : 0.012;
    this.washL = Math.max(0, this.washL - k);
    this.washR = Math.max(0, this.washR - k);
    this.flash = Math.max(0, this.flash - (this.ctx.settings.reduceFlashing ? 0.03 : 0.12));
    this.ctx.stage.setPost({ washLeft: this.washL, washRight: this.washR, flash: this.flash });
    void this.outcomeAt;
  }

  private exit(e: DuelExit) {
    if (this.disposed) return;
    if (this.setup.mode === 'online' && e.kind === 'menu') this.setup.net?.send({ type: 'bye' });
    this.dispose();
    this.onExit(e);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsub) u();
    this.ctx.audio.heartbeat(false);
    this.ctx.stage.setPost({ washLeft: 0, washRight: 0, flash: 0 });
    this.root.remove();
  }
}

/** Radius (svg units, tile ~ 22) of the closing ring at ms after the bell. */
export function ringRadius(ms: number): number {
  const c = CONFIG.draw.goldCenterMs;
  const tileR = 21;
  return tileR * (1 + 1.3 * (c - ms) / c);
}

void goldBand;
