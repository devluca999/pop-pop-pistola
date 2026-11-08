import type { CharacterId, FilterMode, PlayerIndex } from '../types';
import type { AppCtx } from '../game/ctx';
import type { MenuInput, GameInput } from '../input';
import { keyLabel, padLabel } from '../input/labels';
import { DEFAULT_KEYS, DEFAULT_PADS } from '../settings';
import { DITHER_MIN } from '../render/post';
import { h, shout, clear } from './dom';
import type { Difficulty } from '../rules';
import { CONFIG } from '../rules';

export interface ScreenHandle { dispose(): void }

/** Keyboard/gamepad navigable vertical button list. */
export function navMenu(ctx: AppCtx, buttons: HTMLButtonElement[], onBack?: () => void, start = 0): () => void {
  let sel = start;
  const paint = () => buttons.forEach((b, i) => b.classList.toggle('sel', i === sel));
  buttons.forEach((b, i) => b.addEventListener('mouseenter', () => { sel = i; paint(); }));
  paint();
  return ctx.input.onMenu((m: MenuInput) => {
    if (m === 'up' || m === 'down') {
      const dir = m === 'up' ? -1 : 1;
      for (let k = 0; k < buttons.length; k++) {
        sel = (sel + dir + buttons.length) % buttons.length;
        if (!buttons[sel].disabled) break;
      }
      paint();
      ctx.audio.sfx('uiMove');
    } else if (m === 'confirm') {
      if (!buttons[sel].disabled) { ctx.audio.sfx('uiSelect'); buttons[sel].click(); }
    } else if (m === 'back' && onBack) {
      ctx.audio.sfx('uiBack');
      onBack();
    }
  });
}

function btn(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = h('button', { disabled }, label);
  b.addEventListener('click', () => { if (!b.disabled) onClick(); });
  return b;
}

function mount(ctx: AppCtx, el: HTMLElement, offs: (() => void)[]): ScreenHandle {
  ctx.ui.append(el);
  return { dispose: () => { offs.forEach((o) => o()); el.remove(); } };
}

// ------------------------------------------------------------------ title

export function titleScreen(ctx: AppCtx, next: () => void): ScreenHandle {
  ctx.stage.setMode('title');
  const el = h('div', { class: 'screen' },
    h('div', { class: 'logo' }, shout('POP.POP.', 'slam'), shout('PISTOLA', 'slam'), h('div', { class: 'sub' }, 'A QUICK-DRAW DUEL AT HIGH NOON')),
    h('div', { class: 'hint', style: 'position:static;margin-top:calc(var(--u)*10)' }, h('span', { class: 'blinker' }, 'PRESS ANY KEY')),
  );
  let done = false;
  const go = () => { if (done) return; done = true; ctx.audio.unlock(); ctx.audio.music('title'); ctx.audio.sfx('uiSelect'); next(); };
  const onKey = () => go();
  window.addEventListener('keydown', onKey);
  el.addEventListener('pointerdown', go);
  const offPad = ctx.input.onMenu(() => go());
  const offGame = ctx.input.onGame(() => go());
  return mount(ctx, el, [() => window.removeEventListener('keydown', onKey), offPad, offGame]);
}

// ------------------------------------------------------------------ main menu

export interface MainMenuActions { cpu(): void; local(): void; online(): void; settings(): void; howto(): void }

export function mainMenu(ctx: AppCtx, a: MainMenuActions, start = 0): ScreenHandle {
  ctx.stage.setMode('title');
  ctx.audio.music('title');
  const buttons = [
    btn('VS CPU', a.cpu), btn('LOCAL VERSUS', a.local), btn('ONLINE', a.online), btn('SETTINGS', a.settings), btn('HOW TO PLAY', a.howto),
  ];
  const el = h('div', { class: 'screen' },
    h('div', { class: 'logo' }, shout('POP.POP.'), shout('PISTOLA')),
    h('div', { class: 'menu' }, ...buttons),
    h('div', { class: 'hint' }, '↑ ↓ + ENTER  ·  ESC BACK  ·  GAMEPADS WORK TOO'),
  );
  return mount(ctx, el, [navMenu(ctx, buttons, undefined, start)]);
}

export function difficultyMenu(ctx: AppCtx, pick: (d: Difficulty) => void, back: () => void): ScreenHandle {
  const buttons = [btn('EASY: A SLEEPY DEPUTY', () => pick('easy')), btn('NORMAL: A HIRED GUN', () => pick('normal')), btn('HARD: THE STRANGER', () => pick('hard')), btn('BACK', back)];
  const el = h('div', { class: 'screen dim' }, h('div', { class: 'title-label' }, 'PICK YOUR RIVAL'), h('div', { class: 'menu' }, ...buttons));
  return mount(ctx, el, [navMenu(ctx, buttons, back, 1)]);
}

// ------------------------------------------------------------------ character select

export const ROSTER: CharacterId[] = ['hector', 'dusty', 'mercy'];
const BLURB: Record<CharacterId, string> = {
  hector: 'REVOLVER. HIT 1, PERFECT 2. WHISKEY HEALS (X2) BUT GETS HIM DRUNK. CAN FEINT.',
  dusty: 'SAWED-OFF. 150MS SLOWER. HIT 2, PERFECT 3. WINS TRADES. CIGAR HEALS (X2).',
  mercy: 'LANTERN FLASH BLINDS, NO DAMAGE. 2 BLINDS IN A ROW = WILL OF GOD. CAN FEINT.',
};
const DISPLAY: Record<CharacterId, string> = { hector: 'BIG HAT HECTOR', dusty: "LIL' DUSTY", mercy: "SISTER SMOKIN' MERCY" };

export function portraitSvg(c: CharacterId): string {
  // tiny pixel silhouettes, 24x24
  const art: Record<CharacterId, string[]> = {
    hector: [
      '..........XXXX..........', '.........XXXXXX.........', '..XXXXXXXXXXXXXXXXXXXX..', 'XXXXXXXXXXXXXXXXXXXXXXXX',
      '.........ssssss.........', '..........s..s..........', '.......mmmmmmmmmm.......', '.....mm...ssss...mm.....',
      '...........ss...........', '.........RRRRRR.........', '........RR.ww.RR........', '.......RR..ww..RR.......',
      '.......R...ww...R.......', '......RR..bbbb..RR......', '......R....ww....R......', '.......R...ww...R.......',
      '.......RR.l..l.RR.......', '........R.l..l.R........', '..........l..l..........', '.........l....l.........',
      '.........l....l.........', '........l......l........', '.......ll......ll.......', '.......kkk....kkk.......',
    ],
    dusty: [
      '........................', '........................', '..........XXXX..........', '........XXXXXXXX........',
      '........eeee.eeee.......', '.......ssssssssss.......', '......ssssssssssss......', '......sssmmmmmmsss......',
      '.......ssssssssss.......', '.....BBBBBBBBBBBBBB.....', '....BBBBBwwwwwwBBBBB....', '...BBBBBwwwwwwwwBBBBB...',
      '...BB.BBwwwwwwwwBB.BB...', '...BB.BBbbbbbbbbBB.BB...', '...ss.BBwwwwwwwwBB.ss...', '......BBnnnnnnnnBB......',
      '.......nnnnnnnnnn.......', '.......nnnn..nnnn.......', '.......nnnn..nnnn.......', '.......kkkk..kkkk.......',
      '......*kkkk..kkkk*......', '.....*.*........*.*.....', '........................', '........................',
    ],
    mercy: [
      '..........DDDD..........', '.........DDDDDD.........', '........DDwwwwDD........', '.......DDwssssswDD......',
      '.......DDwssssswDD......', '......DDDwssssswDDD.....', '......DDDDwwwwwDDDD.....', '.....DDDDDwwwwwDDDDD....',
      '.....DDDDDDggDDDDDDD....', '....DDDDDDDggDDDDDDDD...', '....DDDDDDgggDDDDDDDD...', '....DDDDDDDgDDDDDDDDD...',
      '....DDDDDDDgDDDDYYYYD...', '...DDDDDDDDgDDDDYooYD...', '...DDDDDDDDDDDDDYooYD...', '...DDDDDDDDDDDDDYYYYD...',
      '...DDDDDDDDDDDDDDDDDD...', '..DDDDDDDDDDDDDDDDDDDD..', '..DDDDDDDDDDDDDDDDDDDD..', '..DDDDDDDDDDDDDDDDDDDD..',
      '..DDDDDDDDDDDDDDDDDDDD..', '..DDDDDDDDDDDDDDDDDDDD..', '.....kkk........kkk.....', '........................',
    ],
  };
  const col: Record<string, string> = {
    X: '#c9b48a', s: '#e7b98f', m: '#5a3a24', R: '#c8321f', w: '#d9d0bd', b: '#e8b33c', l: '#6b5a4a', k: '#3a2a1e',
    e: '#2a1d14', B: '#2f55b5', n: '#6b4a2e', '*': '#e8b33c', D: '#2a2420', g: '#e8b33c', Y: '#7a4a20', o: '#ffd36b',
  };
  let r = '';
  art[c].forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[ch]}"/>`; }));
  return `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" style="width:100%;height:100%">${r}</svg>`;
}

export interface CharSelectOpts {
  /** Which players choose here. Local versus: [0,1]. CPU/online: [0]. */
  pickers: PlayerIndex[];
  title?: string;
  /** Online: show a status line under the cards. */
  status?: () => string;
}

/**
 * Character select. Each picker moves with their left/right keys and locks with their
 * lock key. Picks stay hidden ("LOCKED") until everyone has locked in.
 */
export function charSelect(ctx: AppCtx, opts: CharSelectOpts, done: (picks: CharacterId[]) => void, back: () => void): ScreenHandle & { setStatus(s: string): void } {
  ctx.stage.setMode('title');
  const cur = opts.pickers.map((_, i) => i % ROSTER.length);
  const locked = opts.pickers.map(() => false);
  const cards = ROSTER.map((c) => {
    const card = h('div', { class: 'portrait' },
      h('div', { style: 'flex:1;width:70%;display:grid;place-items:center', html: portraitSvg(c) }),
      h('div', { class: 'nm' }, DISPLAY[c]),
      h('div', { class: 'ds' }, BLURB[c]),
    );
    return card;
  });
  const status = h('div', { class: 'status-line' });
  const help = h('div', { class: 'hint' });
  const k = ctx.settings.keys;
  if (opts.pickers.length === 2) {
    help.textContent = `P1: ${keyLabel(k[0].prompt[3])} / ${keyLabel(k[0].prompt[5])} MOVE, ${keyLabel(k[0].prompt[4])} LOCK   ·   P2: ${keyLabel(k[1].prompt[3])} / ${keyLabel(k[1].prompt[5])} MOVE, ${keyLabel(k[1].prompt[4])} LOCK   ·   PADS: D-PAD + A`;
  } else {
    help.textContent = '← → MOVE  ·  ENTER LOCK IN  ·  ESC BACK';
  }
  const el = h('div', { class: 'screen dim' }, h('div', { class: 'title-label' }, opts.title ?? 'CHOOSE YOUR DUELIST'), h('div', { class: 'picker' }, ...cards), status, help);

  const paint = () => {
    cards.forEach((card, ci) => {
      card.classList.toggle('hover', cur.some((c, pi) => c === ci && !locked[pi]));
      card.querySelectorAll('.cur').forEach((n) => n.remove());
      opts.pickers.forEach((p, pi) => {
        if (cur[pi] === ci && !locked[pi]) card.append(h('div', { class: `cur p${p + 1}` }, opts.pickers.length === 2 ? `P${p + 1}` : 'YOU'));
      });
    });
    const s = opts.pickers.map((p, pi) => (opts.pickers.length === 2 ? `P${p + 1} ` : '') + (locked[pi] ? 'LOCKED' : 'CHOOSING...')).join('    ');
    status.textContent = opts.status ? `${s}    ${opts.status()}` : s;
    // show the hovered duelist on the stage
    const a = ROSTER[cur[0]];
    const b = opts.pickers.length === 2 ? ROSTER[cur[1]] : 'hector';
    ctx.stage.setDuelists(a, b === a && opts.pickers.length === 1 ? 'dusty' : b);
  };
  let finished = false;
  const move = (pi: number, d: number) => { if (locked[pi] || finished) return; cur[pi] = (cur[pi] + d + ROSTER.length) % ROSTER.length; ctx.audio.sfx('uiMove'); paint(); };
  const lock = (pi: number) => {
    if (finished) return;
    locked[pi] = !locked[pi];
    ctx.audio.sfx(locked[pi] ? 'uiSelect' : 'uiBack');
    if (locked[pi]) ctx.audio.voice(ROSTER[cur[pi]], 'taunt');
    paint();
    if (locked.every(Boolean)) {
      finished = true;
      ctx.audio.sfx('spurs');
      setTimeout(() => done(cur.map((c) => ROSTER[c])), 450);
    }
  };
  cards.forEach((card, ci) => card.addEventListener('click', () => {
    if (opts.pickers.length !== 1) return;
    cur[0] = ci; paint(); lock(0);
  }));
  const offs: (() => void)[] = [];
  if (opts.pickers.length === 2) {
    offs.push(ctx.input.onGame((e: GameInput) => {
      if (e.kind !== 'press') return;
      const pi = e.player;
      if (e.slot === 3) move(pi, -1);
      else if (e.slot === 5) move(pi, 1);
      else if (e.slot === 4 || (e.pad && e.slot === 0)) lock(pi);
    }));
    offs.push(ctx.input.onMenu((m) => { if (m === 'back') { ctx.audio.sfx('uiBack'); back(); } }));
  } else {
    offs.push(ctx.input.onMenu((m) => {
      if (m === 'left') move(0, -1);
      else if (m === 'right') move(0, 1);
      else if (m === 'confirm') lock(0);
      else if (m === 'back') { ctx.audio.sfx('uiBack'); back(); }
    }));
  }
  paint();
  const handle = mount(ctx, el, offs);
  return { ...handle, setStatus: () => paint() };
}

// ------------------------------------------------------------------ how to play

export function howTo(ctx: AppCtx, back: () => void): ScreenHandle {
  const k = ctx.settings.keys;
  const kc = (s: string) => `<span class="kc">${s}</span>`;
  const p1 = k[0].prompt.map(keyLabel).map(kc).join(' ');
  const p2 = k[1].prompt.map(keyLabel).map(kc).join(' ');
  const act = (c: string) => (c === 'Space' ? 'SPACE' : c === 'Enter' ? 'ENTER' : keyLabel(c));
  const panel = h('div', { class: 'panel', html: `
    <h2>HOW TO PLAY</h2>
    <p>Two duelists, three hearts each. First to zero loses. Each exchange takes about 12 seconds. Your prompts always appear on your own side of the screen, framed in your colour (left red, right blue).</p>
    <h3>1 · READY</h3><p>Heal now if your duelist can (${kc(keyLabel(k[0].heal))} / ${kc(keyLabel(k[1].heal))}).</p>
    <h3>2 · NERVE (3 PROMPTS)</h3><p>A quick 3-2-1, then a prompt. The label above the tile tells you what to do:</p>
    <ul>
      <li><b>TAP</b>: press the key once, fast.</li>
      <li><b>HOLD</b>: press and keep holding until the bar fills.</li>
      <li><b>MASH</b>: hit the key ${CONFIG.nerve.mashCount} times; the counter drops.</li>
      <li><b>TIME IT</b>: press when the needle is in the gold arc.</li>
      <li><b>RELEASE</b>: press and hold, then let go when it says LET GO!</li>
      <li><b>IN ORDER</b>: press the keys left to right.</li>
      <li><b>STEADY</b>: do NOT press anything.</li>
    </ul>
    <p>Wrong, late, or slower than your rival = a <b>flinch</b>. Flinches shrink your perfect window; 3 flinches and there is none. The first time a prompt type shows up, you get a one-second demo.</p>
    <h3>3 · DRAW COUNTDOWN + STANDOFF</h3><p>A full 3-2-1 reveals how this draw works: <b>RING</b>, <b>WHEEL</b> or <b>SPEED TAP</b>. Then wait for the <b>church bell</b>. Crows, tumbleweeds, doors and coughs are fakes. Drawing early costs a heart while the crowd boos. Hector and Mercy can <b>feint</b> (${kc(keyLabel(k[0].feint))} / ${kc(keyLabel(k[1].feint))}): if the rival twitches within half a second they get 2 flinches; otherwise you get 1.</p>
    <h3>4 · FUEGO!</h3>
    <ul>
      <li><b>RING</b>: press your key. Faster shoots first; press as the ring hits the gold band for a perfect draw.</li>
      <li><b>WHEEL</b>: press ACTION (${kc(act(k[0].action))} / ${kc(act(k[1].action))}, pad A) while the needle is in the gold arc. The thin cream slice is perfect. Missing the arc jams you until the next sweep.</li>
      <li><b>SPEED TAP</b>: hit your key ${CONFIG.draw.speedCount} times. First to finish shoots; all taps in a tight burst is perfect.</li>
    </ul>
    <p>A wrong key jams the gun for 0.5s. Finishing within 120ms of each other is a trade.</p>
    <h3>ONE-ROUND EFFECTS</h3><p><b>Blinded</b> (Sister Mercy's lantern): 2 flinches next exchange. <b>Smoke</b> (Dusty's shotgun or cigar): your next prompts are half hidden. Both last one exchange, show a 1 ROUND tag under your hearts, and never stack.</p>
    <h3>THE DUELISTS</h3>
    <p><b>Big Hat Hector</b>: revolver, hit 1, perfect 2. Whiskey heals 1 (x2) but he's drunk: wobbly prompts and 2 flinches.</p>
    <p><b>Lil' Dusty</b>: sawed-off, draws 150ms slower, hit 2, perfect 3, wins trades (deals 2, takes 1). Cigar heals 1 (x2) but his stare-down presses never count as first.</p>
    <p><b>Sister Smokin' Mercy</b>: her lantern flash blinds (no damage) and wins trades outright. Two blinds in a row = <b>Will of God</b>: win that draw to Vaporize (instant win) or Full Heal (once).</p>
    <p><b>Last Stand</b>: at 1 heart your perfect window is wider.</p>
    <h3>CONTROLS</h3><p>P1 keys: ${p1} · P2 keys: ${p2} · Gamepads: A B X Y LB RB, LT heal, RT feint, A = action. Rebind in Settings.</p>
  ` });
  const b = btn('BACK', back);
  const el = h('div', { class: 'screen dim' }, panel, h('div', { class: 'menu' }, b));
  return mount(ctx, el, [navMenu(ctx, [b], back)]);
}

// ------------------------------------------------------------------ settings

export function settingsScreen(ctx: AppCtx, back: () => void): ScreenHandle {
  const s = ctx.settings;
  const offs: (() => void)[] = [];
  const panel = h('div', { class: 'panel' });
  const el = h('div', { class: 'screen dim' }, panel);
  let tab: 'video' | 'audio' | 'controls' = 'video';
  let capture: { p: PlayerIndex; what: 'prompt' | 'heal' | 'feint' | 'action'; slot: number; pad: boolean } | null = null;
  let stopCapture: (() => void) | null = null;

  const save = () => { ctx.saveSettings(); ctx.applySettings(); };
  const choice = <T extends string | boolean>(vals: [T, string][], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'opt' });
    for (const [v, label] of vals) {
      const b = h('button', { class: get() === v ? 'on' : '' }, label);
      b.onclick = () => { set(v); save(); ctx.audio.sfx('uiMove'); render(); };
      row.append(b);
    }
    return row;
  };
  const slider = (get: () => number, set: (v: number) => void, min = 0) => {
    const i = h('input', { type: 'range', min, max: 100, value: Math.round(get() * 100) }) as HTMLInputElement;
    i.oninput = () => { set(Number(i.value) / 100); save(); };
    i.onchange = () => ctx.audio.sfx('pop');
    return h('div', { class: 'opt' }, i);
  };

  const render = () => {
    clear(panel);
    const tabs = h('div', { class: 'opt', style: 'margin-bottom:calc(var(--u)*3)' });
    for (const [t, label] of [['video', 'VIDEO + ACCESS'], ['audio', 'AUDIO'], ['controls', 'CONTROLS']] as const) {
      const b = h('button', { class: tab === t ? 'on' : '' }, label);
      b.onclick = () => { tab = t; endCapture(); render(); };
      tabs.append(b);
    }
    panel.append(h('h2', {}, 'SETTINGS'), tabs);
    const grid = h('div', { class: 'settings-grid' });
    const row = (label: string, ctl: HTMLElement) => grid.append(h('label', {}, label), ctl);
    if (tab === 'video') {
      row('FILTER', choice<FilterMode>([['color', 'FULL COLOR'], ['noir', 'NOIR'], ['onebit', '1-BIT'], ['sepia', 'SEPIA']], () => s.filter, (v) => { s.filter = v; }));
      row('CRT SCANLINES', choice<boolean>([[true, 'ON'], [false, 'OFF']], () => s.crt, (v) => { s.crt = v; }));
      row('DITHER STRENGTH', slider(() => s.dither, (v) => { s.dither = v; }, Math.round(DITHER_MIN * 100)));
      row('REDUCE FLASHING', choice<boolean>([[true, 'ON'], [false, 'OFF']], () => s.reduceFlashing, (v) => { s.reduceFlashing = v; }));
      row('REDUCED MOTION', choice<boolean>([[true, 'ON'], [false, 'OFF']], () => s.reducedMotion, (v) => { s.reducedMotion = v; }));
      row('SCREEN SHAKE', choice<boolean>([[true, 'ON'], [false, 'OFF']], () => s.shake, (v) => { s.shake = v; }));
      panel.append(grid);
    } else if (tab === 'audio') {
      row('MASTER', slider(() => s.volume.master, (v) => { s.volume.master = v; }));
      row('MUSIC', slider(() => s.volume.music, (v) => { s.volume.music = v; }));
      row('SFX', slider(() => s.volume.sfx, (v) => { s.volume.sfx = v; }));
      row('VOICES', slider(() => s.volume.voice, (v) => { s.volume.voice = v; }));
      panel.append(grid, h('p', { style: 'margin-top:calc(var(--u)*3)' }, 'Drop your own tracks in public/audio/music/ (title, duel, win, lose .mp3/.ogg) to replace the built-in music.'));
    } else {
      const t = h('div', { class: 'bind-table' });
      t.append(h('div', {}, ''), h('div', {}, 'P1'), h('div', {}, 'P2'));
      const bindBtn = (p: PlayerIndex, what: 'prompt' | 'heal' | 'feint' | 'action', slot: number, pad: boolean) => {
        const label = pad
          ? padLabel(what === 'prompt' ? s.pads[p].prompt[slot] : s.pads[p][what])
          : keyLabel(what === 'prompt' ? s.keys[p].prompt[slot] : s.keys[p][what]);
        const waiting = capture && capture.p === p && capture.what === what && capture.slot === slot && capture.pad === pad;
        const b = h('button', { class: waiting ? 'wait' : '' }, waiting ? '...' : label);
        b.onclick = () => startCapture({ p, what, slot, pad });
        return b;
      };
      for (const pad of [false, true]) {
        t.append(h('div', { style: 'grid-column:1/-1;color:var(--gold);margin-top:calc(var(--u)*2)' }, pad ? 'GAMEPAD (PAD 1 = P1, PAD 2 = P2)' : 'KEYBOARD'));
        for (let slot = 0; slot < 6; slot++) {
          t.append(h('div', {}, `DRAW KEY ${slot + 1}`), bindBtn(0, 'prompt', slot, pad), bindBtn(1, 'prompt', slot, pad));
        }
        t.append(h('div', {}, 'HEAL'), bindBtn(0, 'heal', 0, pad), bindBtn(1, 'heal', 0, pad));
        t.append(h('div', {}, 'FEINT'), bindBtn(0, 'feint', 0, pad), bindBtn(1, 'feint', 0, pad));
        t.append(h('div', {}, 'ACTION (WHEEL)'), bindBtn(0, 'action', 0, pad), bindBtn(1, 'action', 0, pad));
      }
      const reset = h('button', { class: 'btn', style: 'margin-top:calc(var(--u)*3)' }, 'RESET TO DEFAULTS');
      reset.onclick = () => { s.keys = structuredClone(DEFAULT_KEYS); s.pads = structuredClone(DEFAULT_PADS); save(); ctx.audio.sfx('uiBack'); render(); };
      panel.append(h('p', {}, capture ? (capture.pad ? 'PRESS A GAMEPAD BUTTON (ESC CANCELS)' : 'PRESS A KEY (ESC CANCELS)') : 'CLICK A BINDING, THEN PRESS THE NEW KEY OR BUTTON.'), t, reset);
    }
    const b = h('button', { class: 'btn', style: 'margin-top:calc(var(--u)*4);display:block' }, 'BACK');
    b.onclick = () => { endCapture(); back(); };
    panel.append(b);
  };

  const assign = (val: string | number) => {
    if (!capture) return;
    const c = capture;
    if (c.pad) {
      const b = s.pads[c.p];
      if (c.what === 'prompt') b.prompt[c.slot] = val as number; else b[c.what] = val as number;
    } else {
      // Swap if the key is already used elsewhere, so nothing ends up double-bound.
      const code = val as string;
      for (const pb of s.keys) {
        const i = pb.prompt.indexOf(code);
        const old = c.what === 'prompt' ? s.keys[c.p].prompt[c.slot] : s.keys[c.p][c.what];
        if (i >= 0) pb.prompt[i] = old;
        if (pb.heal === code) pb.heal = old;
        if (pb.feint === code) pb.feint = old;
        if (pb.action === code) pb.action = old;
      }
      const b = s.keys[c.p];
      if (c.what === 'prompt') b.prompt[c.slot] = code; else b[c.what] = code;
    }
    save();
    ctx.audio.sfx('uiSelect');
    endCapture();
    render();
  };
  const startCapture = (c: NonNullable<typeof capture>) => {
    endCapture();
    capture = c;
    const offKey = ctx.input.onRawKey((e) => {
      if (e.code === 'Escape') { endCapture(); render(); return; }
      if (!c.pad) assign(e.code);
    });
    const offPad = ctx.input.onRawPad(({ pad, button }) => { if (c.pad && pad === c.p) assign(button); else if (c.pad && pad === 0) assign(button); });
    stopCapture = () => { offKey(); offPad(); };
    render();
  };
  const endCapture = () => { stopCapture?.(); stopCapture = null; capture = null; };

  offs.push(ctx.input.onMenu((m) => { if (m === 'back' && !capture) { ctx.audio.sfx('uiBack'); back(); } }));
  offs.push(() => endCapture());
  render();
  return mount(ctx, el, offs);
}

void CONFIG;
