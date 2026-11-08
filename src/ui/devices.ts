import type { PlayerIndex } from '../types';
import type { AppCtx } from '../game/ctx';
import type { Device } from '../settings';
import { keyLabel } from '../input/labels';
import { h } from './dom';
import { navMenu, type ScreenHandle } from './screens';

const ICON_KEYS = '<svg viewBox="0 0 16 9" shape-rendering="crispEdges"><path d="M0 0h16v9H0z" fill="currentColor"/><path d="M1 1h2v2H1zm3 0h2v2H4zm3 0h2v2H7zm3 0h2v2h-2zm3 0h2v2h-2zM2 4h2v2H2zm3 0h2v2H5zm3 0h2v2H8zm3 0h2v2h-2zM4 7h8v1H4z" fill="#1d140e"/></svg>';
const ICON_PAD = '<svg viewBox="0 0 16 9" shape-rendering="crispEdges"><path d="M2 1h12v1h1v4h1v3h-4V7H4v2H0V6h1V2h1z" fill="currentColor"/><path d="M3 3h1V2h1v1h1v1H5v1H4V4H3zm8 0h1v1h-1zm2 0h1v1h-1zm-1-1h1v1h-1zm0 2h1v1h-1z" fill="#1d140e"/></svg>';

function padsConnected(): number {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads).filter(Boolean).length;
}

/**
 * One player (CPU / online): pick KEYBOARD or GAMEPAD from a menu.
 * Pads route by order again (pad 1 is you).
 */
export function deviceSelectSolo(ctx: AppCtx, done: (d: Device) => void, back: () => void): ScreenHandle {
  const mk = (d: Device, label: string, icon: string) => {
    const b = h('button', { class: 'dev-btn' }, h('span', { class: 'dev-ico', html: icon }), label);
    b.addEventListener('click', () => pick(d));
    return b;
  };
  const kb = mk('keyboard', 'KEYBOARD', ICON_KEYS);
  const gp = mk('gamepad', 'GAMEPAD', ICON_PAD);
  const note = h('div', { class: 'status-line' });
  const paint = () => {
    const n = padsConnected();
    note.textContent = n ? `GAMEPAD FOUND (${n})` : 'NO GAMEPAD SEEN YET · PLUG ONE IN AND PRESS ANY BUTTON';
  };
  paint();
  const iv = window.setInterval(paint, 500);
  let finished = false;
  const pick = (d: Device) => {
    if (finished) return;
    finished = true;
    ctx.settings.devices[0] = d;
    ctx.saveSettings();
    ctx.input.padPlayers = null;
    done(d);
  };
  const remembered = ctx.settings.devices[0];
  const start = remembered === 'gamepad' ? 1 : 0;
  const el = h('div', { class: 'screen dim' },
    h('div', { class: 'title-label' }, 'HOW ARE YOU PLAYING?'),
    h('div', { class: 'menu dev-menu' }, kb, gp),
    note,
    h('div', { class: 'hint' }, 'PROMPTS WILL SHOW THIS DEVICE\'S BUTTONS · ESC / B BACK'),
  );
  ctx.ui.append(el);
  const offs = [navMenu(ctx, [kb, gp], back, start), () => clearInterval(iv)];
  return { dispose: () => { offs.forEach((o) => o()); el.remove(); } };
}

/**
 * Local versus: each player picks for themselves.
 * Keyboard: press your LOCK key (P1 S, P2 K by default).
 * Gamepad: press A on a pad to take the first free side, ← → on that pad to switch sides,
 * B to let go. Esc goes back.
 */
export function deviceSelectLocal(ctx: AppCtx, done: (d: [Device, Device]) => void, back: () => void): ScreenHandle {
  const choice: [Device | null, Device | null] = [null, null];
  const padOf: [number | null, number | null] = [null, null];
  const k = ctx.settings.keys;
  const lockKey = (p: PlayerIndex) => keyLabel(k[p].prompt[4]);

  const cols = ([0, 1] as PlayerIndex[]).map((p) => {
    const kbRow = h('div', { class: 'dev-opt' });
    const gpRow = h('div', { class: 'dev-opt' });
    const state = h('div', { class: 'dev-state' });
    const col = h('div', { class: `dev-col p${p + 1}` }, h('div', { class: 'dev-head' }, `PLAYER ${p + 1}`), kbRow, gpRow, state);
    kbRow.addEventListener('click', () => setKeyboard(p));
    return { col, kbRow, gpRow, state };
  });

  const paint = () => {
    const n = padsConnected();
    cols.forEach((c, p) => {
      const ch = choice[p];
      c.kbRow.innerHTML = `<span class="dev-ico">${ICON_KEYS}</span>KEYBOARD<span class="kc">${lockKey(p as PlayerIndex)}</span>`;
      c.gpRow.innerHTML = `<span class="dev-ico">${ICON_PAD}</span>GAMEPAD<span class="kc">A</span>`;
      c.kbRow.classList.toggle('on', ch === 'keyboard');
      c.gpRow.classList.toggle('on', ch === 'gamepad');
      c.col.classList.toggle('locked', ch !== null);
      c.state.textContent = ch === 'keyboard' ? 'KEYBOARD ✓'
        : ch === 'gamepad' ? `GAMEPAD ${padOf[p]! + 1} ✓`
        : `PRESS ${lockKey(p as PlayerIndex)} OR A ON A PAD`;
    });
    padNote.textContent = n ? `${n} GAMEPAD${n > 1 ? 'S' : ''} FOUND` : 'NO GAMEPAD SEEN YET · PRESS ANY BUTTON ON ONE';
  };

  let finished = false;
  const check = () => {
    paint();
    if (finished || choice[0] === null || choice[1] === null) return;
    finished = true;
    ctx.audio.sfx('spurs');
    const map: (PlayerIndex | null)[] = [];
    ([0, 1] as PlayerIndex[]).forEach((p) => { if (padOf[p] !== null) map[padOf[p]!] = p; });
    ctx.input.padPlayers = map;
    ctx.settings.devices = [choice[0], choice[1]];
    ctx.saveSettings();
    setTimeout(() => done([choice[0]!, choice[1]!]), 450);
  };
  const setKeyboard = (p: PlayerIndex) => {
    if (finished) return;
    if (choice[p] === 'keyboard') { choice[p] = null; ctx.audio.sfx('uiBack'); }
    else { padOf[p] = null; choice[p] = 'keyboard'; ctx.audio.sfx('uiSelect'); }
    check();
  };
  const owner = (gi: number): PlayerIndex | null => (padOf[0] === gi ? 0 : padOf[1] === gi ? 1 : null);
  const givePad = (p: PlayerIndex, gi: number) => {
    const was = owner(gi);
    if (was !== null) { padOf[was] = null; choice[was] = null; }
    padOf[p] = gi;
    choice[p] = 'gamepad';
  };

  let padBackAt = 0;
  const offs: (() => void)[] = [];
  // keyboard: the LOCK key of each half picks keyboard for that player
  offs.push(ctx.input.onGame((e) => {
    if (e.pad || e.kind !== 'press' || e.slot !== 4) return;
    setKeyboard(e.player);
  }));
  offs.push(ctx.input.onPadButton(({ pad, button }) => {
    if (finished) return;
    const mine = owner(pad);
    if (button === 0) {
      if (mine !== null) return;
      const free = ([0, 1] as PlayerIndex[]).find((p) => choice[p] === null);
      if (free === undefined) return;
      givePad(free, pad);
      ctx.audio.sfx('uiSelect');
    } else if ((button === 14 || button === 15) && mine !== null) {
      const to: PlayerIndex = button === 14 ? 0 : 1;
      if (to === mine || choice[to] !== null) return;
      givePad(to, pad);
      ctx.audio.sfx('uiMove');
    } else if (button === 1) {
      padBackAt = performance.now();
      if (mine !== null) { padOf[mine] = null; choice[mine] = null; ctx.audio.sfx('uiBack'); }
      else { ctx.audio.sfx('uiBack'); back(); return; }
    } else return;
    check();
  }));
  offs.push(ctx.input.onMenu((m) => {
    // pad B already handled above (it also sends a menu "back")
    if (m === 'back' && performance.now() - padBackAt > 60) { ctx.audio.sfx('uiBack'); back(); }
  }));

  const padNote = h('div', { class: 'status-line' });
  const el = h('div', { class: 'screen dim' },
    h('div', { class: 'title-label' }, 'KEYBOARD OR GAMEPAD?'),
    h('div', { class: 'dev-cols' }, ...cols.map((c) => c.col)),
    padNote,
    h('div', { class: 'hint' }, `KEYBOARD: P1 ${lockKey(0)} · P2 ${lockKey(1)}   ·   GAMEPAD: A TO JOIN, ← → SWITCH SIDE, B LEAVE   ·   ESC BACK`),
  );
  ctx.ui.append(el);
  const iv = window.setInterval(paint, 500);
  offs.push(() => clearInterval(iv));
  paint();
  return { dispose: () => { offs.forEach((o) => o()); el.remove(); } };
}
