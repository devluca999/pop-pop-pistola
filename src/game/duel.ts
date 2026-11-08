import type { CharacterId, PlayerIndex, ScreenSide } from '../types';
import {
  CONFIG, applyExchange, canHeal, cpuExchangeLog, cpuFeintReaction, generatePlan, makeRng, markSeen, randomSeed,
  resolveExchange, newMatch, DRAW_LABEL,
  type Difficulty, type ExchangePlan, type ExchangeResult, type InputEvent, type MatchState, type WillChoice,
  type PromptType, type DrawType,
} from '../rules';
import type { GameInput } from '../input';
import { keyLabel, bindingLabels } from '../input/labels';
import type { Device } from '../settings';
import { h, tile, shout, heartSvg, clear } from '../ui/dom';
import { pixelText } from '../ui/pixelfont';
import { PromptView, DrawView } from '../ui/promptview';
import type { AppCtx } from './ctx';
import type { NetLink, NetMsg } from '../net/types';
import type { SfxName } from '../audio';

export type DuelMode = 'cpu' | 'local' | 'online';

export interface DuelSetup {
  mode: DuelMode;
  characters: [CharacterId, CharacterId];
  difficulty?: Difficulty;
  /** The player seen from behind / shown on the left. */
  localView: PlayerIndex;
  net?: NetLink;
  isHost?: boolean;
  /** Online: the rival's key labels (for look-alike avoidance and their own display). */
  remoteLabels?: string[];
  /** Controller each player chose (by player index). Prompts show that device's buttons. */
  devices?: [Device, Device];
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
  views: (PromptView | null)[][];
  draws: (DrawView | null)[];
  counts: number[][];
  lastJam: [number, number];
  lastUpSent: number;
  countdownEl: HTMLElement | null;
}

const NAMES: Record<CharacterId, string> = { hector: 'BIG HAT HECTOR', dusty: "LIL' DUSTY", mercy: 'SISTER MERCY' };
const LEAD_MS = 1300;
const APPEAR_SFX: Record<PromptType, SfxName> = {
  tap: 'tapTick', hold: 'holdRise', mash: 'mashClick', time: 'timeTick', release: 'tapTick', order: 'orderBlip', steady: 'steadyHum',
};
const DRAW_HELP: Record<DrawType, string> = {
  ring: 'PRESS YOUR KEY AS THE RING HITS THE GOLD',
  wheel: 'PRESS ACTION WHILE THE NEEDLE IS IN THE GOLD',
  speed: `TAP YOUR KEY ${CONFIG.draw.speedCount} TIMES, FAST`,
};
const ICON_EYE = '<svg viewBox="0 0 10 8" shape-rendering="crispEdges"><path d="M0 4h1V3h1V2h6v1h1v1h1v1H9v1H8v1H2V6H1V5H0z" fill="#f2e6c9"/><rect x="4" y="3" width="2" height="2" fill="#1d140e"/><path d="M1 7 9 1" stroke="#c8321f" stroke-width="1.2"/></svg>';
const ICON_SMOKE = '<svg viewBox="0 0 10 8" shape-rendering="crispEdges"><path d="M2 3h2V2h3v1h1v1h1v2H8v1H1V6H0V4h2z" fill="#c9c4b8"/></svg>';

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
  private willChoice: WillChoice | null = null;
  private choiceDeadline = 0;
  private pausedAt = 0;
  private lastRemoteHeard = performance.now();
  private exCounter = 0;
  private washL = 0;
  private washR = 0;
  private flash = 0;
  private disposed = false;
  private zoneEls: [HTMLElement | null, HTMLElement | null] = [null, null];

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
    ctx.input.padGameMode = true;
    this.unsub.push(ctx.input.onGame((e) => this.onInput(e)));
    this.unsub.push(ctx.input.onMenu((m) => { if (m === 'back') this.togglePause(); }));
    if (setup.net) {
      this.unsub.push(setup.net.on((m) => this.onNet(m)));
      // Heartbeats run on a timer, not the render loop, so a backgrounded tab keeps talking.
      const iv = window.setInterval(() => this.netTick(performance.now()), 50);
      this.unsub.push(() => clearInterval(iv));
    }

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

  /** The six prompt-key labels a player sees (what look-alike avoidance works on). */
  labelsFor(i: PlayerIndex): string[] {
    if (this.isCpu(i)) return this.ctx.settings.keys[1].prompt.map(keyLabel);
    if (!this.isLocalHuman(i)) return this.setup.remoteLabels ?? ['1', '2', '3', '4', '5', '6'];
    return this.myLabels(i).prompt;
  }
  /** Button labels on the device this player chose on the controller screen. */
  private myLabels(i: PlayerIndex) { return bindingLabels(this.ctx.settings, this.bindingIndex(i), this.device(i)); }
  private device(i: PlayerIndex): Device { return this.setup.devices?.[i] ?? 'keyboard'; }
  private keyFor(i: PlayerIndex, slot: number): string { return this.labelsFor(i)[slot] ?? '?'; }
  private healKey(i: PlayerIndex): string { return this.myLabels(i).heal; }
  private feintKey(i: PlayerIndex): string { return this.myLabels(i).feint; }
  private actionKey(i: PlayerIndex): string {
    if (this.isCpu(i)) return 'ENTER';
    if (!this.isLocalHuman(i)) return 'GO';
    return this.myLabels(i).action;
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
  private tagOf(i: PlayerIndex) {
    if (this.setup.mode === 'local') return `P${i + 1}`;
    if (this.isCpu(i)) return 'CPU';
    return this.isLocalHuman(i) ? 'YOU' : 'RIVAL';
  }
  /** Left (near) side is framed red, right side blue. */
  private frameOf(i: PlayerIndex): 'p1' | 'p2' { return this.side(i) === 'near' ? 'p1' : 'p2'; }

  /** Each player's prompts live in a zone on their own side of the screen. */
  private zoneFor(i: PlayerIndex): HTMLElement {
    const existing = this.zoneEls[i];
    if (existing && existing.isConnected) return existing;
    const left = this.side(i) === 'near';
    const zone = h('div', { class: `prompt-zone ${left ? 'left' : 'right'}` });
    this.zones.append(zone);
    this.zoneEls[i] = zone;
    return zone;
  }
  private clearZones() {
    clear(this.zones);
    this.zoneEls = [null, null];
  }

  // ------------------------------------------------------------ HUD

  private renderHud(res?: ExchangeResult | null, crack: [boolean, boolean] = [false, false], showStatus = true) {
    clear(this.hud);
    for (const i of [0, 1] as PlayerIndex[]) {
      const p = this.state.players[i];
      const hearts = res ? res.hearts[i] : p.hearts;
      const left = this.side(i) === 'near';
      const col = h('div', { class: `hud-side ${left ? 'left' : 'right'}`, style: `--frame:${left ? '#c8321f' : '#3f6fd1'}` });
      col.append(h('div', { class: 'hud-name' }, h('span', { class: 'tagp', style: `background:${left ? '#c8321f' : '#3f6fd1'}` }, this.tagOf(i)), NAMES[p.character]));
      const hr = h('div', { class: 'row' });
      for (let k = 0; k < CONFIG.hearts; k++) {
        const full = k < hearts;
        const cracking = crack[i] && k === hearts;
        hr.append(h('div', { class: `heart ${cracking ? 'crack' : ''}`, html: heartSvg(full ? 'full' : cracking ? 'cracked' : 'empty') }));
      }
      col.append(hr);
      // one-round status effects sit right under the hearts
      if (showStatus) {
        if (p.status.blind) col.append(h('div', { class: 'status-tag', html: `${ICON_EYE}BLINDED <b>1 ROUND</b>` }));
        if (p.status.smoke) col.append(h('div', { class: 'status-tag', html: `${ICON_SMOKE}SMOKE <b>1 ROUND</b>` }));
      }
      const items = h('div', { class: 'row' });
      const healName = p.character === 'hector' ? 'WHISKEY' : p.character === 'dusty' ? 'CIGAR' : null;
      if (healName) {
        const total = CONFIG.characters[p.character].heals;
        for (let k = 0; k < total; k++) items.append(h('div', { class: `item ${k < p.healsLeft - (res?.healed[i] ? 1 : 0) ? '' : 'used'}` }, healName));
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
    this.after(1900, () => { if (!this.run) this.nextExchange(); });
  }

  private makePlan(): ExchangePlan {
    return generatePlan(randomSeed(), { labels: [this.labelsFor(0), this.labelsFor(1)], seen: this.state.seen });
  }

  private nextExchange() {
    if (this.disposed) return;
    if (this.setup.mode === 'online') {
      // Guests wait for the host's plan (it may already have arrived during the intro).
      if (!this.setup.isHost) { if (this.phase !== 'exchange') this.phase = 'waiting'; return; }
      const plan = this.makePlan();
      const ex = ++this.exCounter;
      this.setup.net!.send({ type: 'plan', ex, plan, state: this.state, lead: LEAD_MS });
      this.begin(ex, plan, performance.now() + LEAD_MS);
      return;
    }
    this.begin(++this.exCounter, this.makePlan(), performance.now() + 500);
  }

  private begin(ex: number, plan: ExchangePlan, t0: number) {
    this.clearZones();
    clear(this.fx);
    const run: Run = {
      ex, plan, t0, logs: [[], []], cpuQueue: [], fired: new Set(), res: null, remoteUpTo: -Infinity,
      views: plan.prompts.map(() => [null, null]), draws: [null, null], counts: plan.prompts.map(() => [0, 0]),
      lastJam: [0, 0], lastUpSent: 0, countdownEl: null,
    };
    for (const i of [0, 1] as PlayerIndex[]) {
      if (this.isCpu(i)) run.cpuQueue = cpuExchangeLog(plan, this.state, i, this.setup.difficulty ?? 'normal', makeRng(plan.seed ^ 0x9e3779b9));
    }
    this.state = markSeen(this.state, plan);
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
    stage.setSmokeCloud(this.state.players.some((p) => p.status.smoke));
    this.hudKey = '';
  }

  /** Called every frame by the app. */
  frame(now: number) {
    if (this.disposed) return;
    this.ctx.input.poll();
    for (const t of [...this.timers]) if (now >= t.at) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); }
    this.updateWash();
    if (this.phase === 'paused') return;
    const run = this.run;
    if (!run) return;
    const t = now - run.t0;
    if (this.phase === 'choice') this.choiceTick(now);
    if (this.phase !== 'exchange') return;
    if (t < 0) return;

    while (run.cpuQueue.length && run.cpuQueue[0].t <= t) {
      const ev = run.cpuQueue.shift()!;
      const cpu: PlayerIndex = this.isCpu(0) ? 0 : 1;
      run.logs[cpu].push(ev);
      this.onAnyEvent(cpu, ev);
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
        const tl = tile(this.healKey(i), 'pop-in');
        tl.append(h('span', { class: 'tag' }, nm));
        const hint = h('div', { class: 'pv frame-' + this.frameOf(i) + ' mine' }, h('div', { class: 'verb', html: pixelText('HEAL?') }), tl);
        zone.append(hint);
        this.after(CONFIG.readyMs - 150, () => hint.remove());
      }
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

    // Nerve prompts: countdown (and a mini demo the first time), then the live prompt
    plan.prompts.forEach((p, k) => {
      if (t < p.c) return;
      this.once(run, `pv${k}`, () => {
        this.clearZones();
        for (const i of [0, 1] as PlayerIndex[]) {
          run.views[k][i] = new PromptView(this.zoneFor(i), {
            type: p.type,
            labels: p.keys[i].map((s) => this.keyFor(i, s)),
            mine: this.isLocalHuman(i),
            wobble: res.drunk[i],
            smoke: this.state.players[i].status.smoke,
            frame: this.frameOf(i),
            tag: this.tagOf(i),
            arcMs: p.arcMs?.[i],
            cueMs: p.cueMs,
          });
        }
      });
      const views = run.views[k];
      if (t < p.t) {
        const inDemo = p.demo && t < p.c + CONFIG.nerve.demoMs;
        if (inDemo) {
          for (const v of views) v?.demo();
          this.once(run, `demo${k}`, () => audio.sfx(APPEAR_SFX[p.type], { gain: 0.6 }));
        } else {
          const step = CONFIG.nerve.countdownMs / 3;
          const digit = Math.min(3, Math.max(1, Math.ceil((p.t - t) / step)));
          for (const v of views) v?.countdown(digit);
          this.once(run, `ct${k}${digit}`, () => audio.sfx('countTick', { rate: 1 + (3 - digit) * 0.1, gain: 0.7 }));
        }
        return;
      }
      this.once(run, `act${k}`, () => {
        stage.setPush(k + 1);
        for (const v of views) v?.activate();
        audio.sfx(APPEAR_SFX[p.type]);
        if (k === 1) {
          const who: PlayerIndex = Math.random() < 0.5 ? 0 : 1;
          audio.voice(this.state.players[who].character, 'mutter', { pan: this.pan(who) });
        }
      });
      for (const i of [0, 1] as PlayerIndex[]) {
        const v = views[i];
        if (!v) continue;
        const r = res.prompts[k][i];
        v.update(t - p.t, r);
        if (this.isLocalHuman(i)) {
          // live input sounds for the player's own prompt
          if (r.count > run.counts[k][i]) {
            run.counts[k][i] = r.count;
            audio.sfx(p.type === 'order' ? 'orderBlip' : 'mashClick', { rate: p.type === 'order' ? 1 + 0.25 * (r.count - 1) : 1, pan: this.pan(i) });
          }
          if (r.holding && p.type === 'hold') this.once(run, `holdsfx${k}${i}`, () => audio.sfx('holdRise', { pan: this.pan(i) }));
          if (p.type === 'release' && t - p.t >= (p.cueMs ?? 0)) this.once(run, `cue${k}`, () => audio.sfx('countGo', { gain: 0.6 }));
        }
        if (r.status === 'ok') {
          this.once(run, `ok${k}${i}`, () => {
            v.result('ok');
            if (this.isLocalHuman(i)) audio.sfx(p.type === 'release' ? 'releasePop' : 'promptGood', { pan: this.pan(i) });
          });
        } else if (r.status !== 'pending') {
          this.once(run, `bad${k}${i}`, () => {
            v.result(r.status);
            audio.sfx('flinch', { pan: this.pan(i) });
            stage.setPose(this.side(i), 'flinch');
          });
        }
      }
      if (t >= p.end + 350) this.once(run, `pvEnd${k}`, () => { for (const v of views) v?.destroy(); });
    });

    // Draw countdown: the draw type is revealed with a full 3-2-1; the bell comes after
    if (t >= plan.standoffStart && t < plan.bellT) {
      this.once(run, 'standoff', () => {
        this.clearZones();
        audio.drumroll(Math.min(1600, plan.countdownEnd - plan.standoffStart));
        const el = h('div', { class: 'countdown' });
        this.top.append(el);
        run.countdownEl = el;
        for (const i of [0, 1] as PlayerIndex[]) {
          stage.setPose(this.side(i), 'ready');
          if (this.isLocalHuman(i) && CONFIG.characters[this.state.players[i].character].canFeint && this.setup.mode !== 'local') {
            this.banner(`${this.feintKey(i)}: FEINT`, 1600, 'small');
          }
        }
      });
      const el = run.countdownEl;
      if (el) {
        const label = DRAW_LABEL[plan.drawType];
        const S = CONFIG.standoff;
        const inDemo = plan.drawDemo && t < plan.standoffStart + S.demoMs;
        let mode = '';
        if (inDemo) mode = 'demo';
        else if (t < plan.countdownEnd) mode = `c${Math.min(3, Math.max(1, Math.ceil((plan.countdownEnd - t) / (S.countdownMs / 3))))}`;
        else mode = 'wait';
        if (el.dataset.mode !== mode) {
          el.dataset.mode = mode;
          const help = plan.drawType === 'wheel'
            ? `${DRAW_HELP.wheel} (${this.localActionHint()})`
            : DRAW_HELP[plan.drawType];
          if (mode === 'demo') {
            el.replaceChildren(h('div', { class: 'draw-label', html: pixelText(label) }), h('div', { class: 'sub' }, `NEW DRAW: ${help}`));
            audio.sfx('countGo', { gain: 0.5 });
          } else if (mode === 'wait') {
            el.replaceChildren(h('div', { class: 'draw-label small', html: pixelText(label) }), h('div', { class: 'sub' }, 'WAIT FOR THE BELL...'));
          } else {
            const digit = Number(mode.slice(1));
            el.replaceChildren(h('div', { class: 'draw-label', html: pixelText(label) }), tile(String(digit), 'pop-in'), h('div', { class: 'sub' }, help));
            audio.sfx('countTick', { rate: 1 + (3 - digit) * 0.1 });
          }
        }
      }
    }
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
      });
      if (f.status === 'whiff') this.once(run, `whiff${f.by}`, () => this.banner('NO BITE', 800, 'small'));
    }

    // Bell
    if (t >= plan.bellT) {
      this.once(run, 'bell', () => {
        run.countdownEl?.remove();
        run.countdownEl = null;
        stage.ringBell();
        audio.sfx('bellToll');
        audio.sfx('fuego');
        audio.duck(0.7, 1200);
        audio.heartbeat(false);
        this.shoutAt('FUEGO!', 900, 'slam huge');
        this.clearZones();
        for (const i of [0, 1] as PlayerIndex[]) {
          const label = plan.drawType === 'wheel' ? this.actionKey(i) : this.keyFor(i, plan.drawSlots[i]);
          const v = new DrawView(this.zoneFor(i), plan.drawType, label, {
            mine: this.isLocalHuman(i), frame: this.frameOf(i), tag: this.tagOf(i), smoke: this.state.players[i].status.smoke,
          });
          v.setWindow(res.drawWin[i].perfect, res.drawWin[i].arcHalf, plan.wheelArc[i], this.isLocalHuman(i));
          run.draws[i] = v;
        }
      });
      const dt = t - plan.bellT;
      for (const i of [0, 1] as PlayerIndex[]) {
        const v = run.draws[i];
        if (!v) continue;
        v.update(dt, res.speedCount[i]);
        if (this.isLocalHuman(i) && res.speedCount[i] > 0 && plan.drawType === 'speed') {
          this.once(run, `sp${i}${res.speedCount[i]}`, () => audio.sfx('mashClick', { rate: 1 + res.speedCount[i] * 0.05, pan: this.pan(i) }));
        }
        if (res.jammedUntil[i] > run.lastJam[i]) {
          run.lastJam[i] = res.jammedUntil[i];
          v.jam();
          audio.sfx('jam', { pan: this.pan(i) });
          stage.setPose(this.side(i), 'jam');
          this.banner(`${this.tagOf(i)} JAMMED!`, 700, 'small');
        }
        if (res.draws[i]) this.once(run, `drew${i}`, () => { v.drew(); stage.setPose(this.side(i), 'draw'); });
      }
    }
  }

  private localActionHint(): string {
    if (this.setup.mode === 'local') return `P1 ${this.actionKey(0)} · P2 ${this.actionKey(1)}`;
    return this.actionKey(this.setup.localView);
  }

  private localLastStand(res: ExchangeResult) {
    if (this.setup.mode === 'local') return res.lastStand[0] || res.lastStand[1];
    return res.lastStand[this.setup.localView];
  }

  // ------------------------------------------------------------ input

  private onInput(e: GameInput) {
    const i = e.player;
    if (!this.isLocalHuman(i)) return;
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
        const v: PlayerIndex = i === 0 ? 1 : 0;
        if (this.isCpu(v)) {
          const delay = cpuFeintReaction(this.setup.difficulty ?? 'normal', makeRng(plan.seed + Math.round(ev.t)));
          if (delay !== null) {
            // The CPU flinches at the feint; drop its planned fake-fall so it isn't punished twice.
            run.cpuQueue = run.cpuQueue.filter((q) => !((q.kind === 'press' || q.kind === 'action') && q.t < plan.bellT && q.t > ev.t));
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
    const o = res.outcome!;
    const { stage, audio, settings } = this.ctx;
    this.clearZones();
    _run.countdownEl?.remove();
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
      if (dead) { this.after(500, () => audio.sfx('fall', { pan: this.pan(i) })); audio.sfx('hatFly'); }
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
        if (lethal(i)) this.after(700, () => stage.setPose(this.side(i), 'dead'));
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
    this.renderHudAfter(res, crack);
    this.after(o.kind === 'reset' ? CONFIG.resetMessageMs : CONFIG.aftermathMs, () => this.finishExchange(res, null));
  }

  private renderHudAfter(res: ExchangeResult, crack: [boolean, boolean]) {
    const preview = { ...this.state, players: this.state.players.map((p, i) => ({ ...p, hearts: Math.max(0, res.hearts[i] - res.outcome!.damage[i]) })) } as MatchState;
    const saved = this.state;
    this.state = preview;
    this.renderHud(null, crack, false);
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
    row.append(h('div', {}, tile(this.actionKey(m), 'big'), 'VAPORIZE'));
    if (canHealNow) row.append(h('div', {}, tile(this.healKey(m), 'big'), 'FULL HEAL'));
    const panel = h('div', { class: 'center', style: 'top:62%' }, row);
    panel.id = 'will-choice';
    this.top.append(panel);
  }
  private choiceInput(i: PlayerIndex, e: GameInput) {
    if (i !== this.choiceFor || this.willChoice) return;
    if (e.kind === 'heal') this.resolveChoice('heal');
    else if (e.kind === 'press' || e.kind === 'action') this.resolveChoice('vaporize');
  }
  private choiceTick(now: number) {
    if (!this.willChoice && !this.isCpu(this.choiceFor) && now > this.choiceDeadline) this.resolveChoice('vaporize');
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
    this.clearZones();
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
      this.ctx.input.padGameMode = false;
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

  private prevPhase: Duel['phase'] = 'exchange';
  private togglePause() {
    if (this.phase === 'over') return;
    if (this.setup.mode === 'online') {
      // Online can't pause: the overlay only asks whether to leave, and the duel keeps running.
      const open = document.getElementById('pause');
      if (open) { open.remove(); this.ctx.input.padGameMode = true; } else this.showPause(true);
      return;
    }
    if (this.phase === 'paused') {
      const d = performance.now() - this.pausedAt;
      if (this.run) this.run.t0 += d;
      for (const t of this.timers) t.at += d;
      this.phase = this.prevPhase;
      this.top.querySelectorAll('#pause').forEach((n) => n.remove());
      this.ctx.input.padGameMode = true;
      return;
    }
    this.prevPhase = this.phase;
    this.pausedAt = performance.now();
    this.phase = 'paused';
    this.showPause(false);
  }
  private showPause(online: boolean) {
    this.top.querySelectorAll('#pause').forEach((n) => n.remove());
    // pad A/B work as menu buttons again while the pause menu is open
    this.ctx.input.padGameMode = false;
    const panel = h('div', { class: 'screen dim', id: 'pause' });
    panel.append(h('div', { class: 'title-label' }, online ? 'LEAVE THE DUEL?' : 'PAUSED'));
    const m = h('div', { class: 'menu' });
    const resume = h('button', { class: 'sel' }, online ? 'STAY' : 'RESUME');
    const quit = h('button', {}, 'QUIT TO MENU');
    resume.onclick = () => this.togglePause();
    quit.onclick = () => this.exit({ kind: 'menu' });
    m.append(resume, quit);
    panel.append(m, h('div', { class: 'hint' }, online ? 'The duel keeps running while this is open.' : 'ESC / START to resume'));
    this.top.append(panel);
    let sel = 0;
    const btns = [resume, quit];
    const off = this.ctx.input.onMenu((mi) => {
      if (!document.getElementById('pause')) { off(); return; }
      if (online && mi === 'back') { this.ctx.input.padGameMode = true; return; }
      if (mi === 'up' || mi === 'down') { sel = 1 - sel; btns.forEach((b, k) => b.classList.toggle('sel', k === sel)); }
      if (mi === 'confirm') btns[sel].click();
    });
  }

  // ------------------------------------------------------------ online

  private lastPing = 0;
  private hiccup = false;
  remoteRematch = false;

  private netTick(now: number) {
    const run = this.run;
    const net = this.setup.net!;
    if (run && this.phase === 'exchange' && now - run.lastUpSent > 80) {
      run.lastUpSent = now;
      net.send({ type: 'upto', ex: run.ex, t: now - run.t0 });
    }
    if (now - this.lastPing > 500) { this.lastPing = now; net.send({ type: 'ping' }); }
    const silent = now - this.lastRemoteHeard;
    if (this.phase === 'exchange' && silent > 3000) {
      this.phase = 'waiting';
      this.run?.countdownEl?.remove();
      this.run = null;
      this.clearZones();
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

  // ------------------------------------------------------------ post FX + teardown

  private updateWash() {
    const k = this.ctx.settings.reducedMotion ? 0.03 : 0.012;
    this.washL = Math.max(0, this.washL - k);
    this.washR = Math.max(0, this.washR - k);
    this.flash = Math.max(0, this.flash - (this.ctx.settings.reduceFlashing ? 0.03 : 0.12));
    this.ctx.stage.setPost({ washLeft: this.washL, washRight: this.washR, flash: this.flash });
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
    // Menus and local select expect both keyboard halves again.
    this.ctx.input.twoPlayers = true;
    this.ctx.input.soloPlayer = 0;
    this.ctx.input.padGameMode = false;
    this.ctx.audio.heartbeat(false);
    this.ctx.stage.setPost({ washLeft: 0, washRight: 0, flash: 0 });
    this.root.remove();
  }
}
