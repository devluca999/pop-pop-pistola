import './style.css';
import { Stage, fitCanvas } from './render';
import { audio } from './audio';
import { Input } from './input';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { AppCtx } from './game/ctx';
import { Duel, type DuelSetup } from './game/duel';
import type { CharacterId } from './types';
import type { Difficulty } from './rules';
import {
  titleScreen, mainMenu, difficultyMenu, charSelect, howTo, settingsScreen, navMenu, ROSTER, type ScreenHandle,
} from './ui/screens';
import { h } from './ui/dom';
import { onlineConfigured, openRoom, makeRoomCode, normalizeCode, type Room } from './net/online';
import type { NetMsg } from './net/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const crt = document.getElementById('crt') as HTMLElement;

let settings: Settings = loadSettings();
const stage = new Stage(canvas);
const input = new Input(() => settings);

const ctx: AppCtx = {
  stage, audio, input, ui,
  get settings() { return settings; },
  saveSettings: () => saveSettings(settings),
  applySettings,
};

function applySettings() {
  stage.setPost({ filter: settings.filter, dither: settings.dither });
  stage.setOptions({ shake: settings.shake, reducedMotion: settings.reducedMotion, reduceFlashing: settings.reduceFlashing });
  audio.setVolumes(settings.volume);
  crt.classList.toggle('on', settings.crt);
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
}

function layout() {
  fitCanvas(canvas);
  const r = canvas.getBoundingClientRect();
  for (const el of [ui, crt]) {
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }
  document.documentElement.style.setProperty('--u', `${r.width / 320}px`);
}
window.addEventListener('resize', layout);

// ------------------------------------------------------------------ screen flow

let screen: ScreenHandle | null = null;
let duel: Duel | null = null;
let menuIndex = 0;
const show = (s: ScreenHandle | null) => { screen?.dispose(); screen = s; };

function toTitle() { show(titleScreen(ctx, toMenu)); }

function toMenu() {
  duel?.dispose();
  duel = null;
  show(mainMenu(ctx, {
    cpu: () => { menuIndex = 0; toDifficulty(); },
    local: () => { menuIndex = 1; toLocalSelect(); },
    online: () => { menuIndex = 2; toOnline(); },
    settings: () => { menuIndex = 3; show(settingsScreen(ctx, toMenu)); },
    howto: () => { menuIndex = 4; show(howTo(ctx, toMenu)); },
  }, menuIndex));
}

function toDifficulty() {
  show(difficultyMenu(ctx, (d) => toCpuSelect(d), toMenu));
}

function toCpuSelect(d: Difficulty) {
  show(charSelect(ctx, { pickers: [0] }, ([mine]) => {
    const cpu = ROSTER[Math.floor(Math.random() * ROSTER.length)];
    startDuel({ mode: 'cpu', characters: [mine, cpu], difficulty: d, localView: 0 }, () => toCpuSelect(d));
  }, toDifficulty));
}

function toLocalSelect() {
  show(charSelect(ctx, { pickers: [0, 1] }, ([a, b]) => {
    startDuel({ mode: 'local', characters: [a, b], localView: 0 }, toLocalSelect);
  }, toMenu));
}

function startDuel(setup: DuelSetup, rematch: () => void, onMenu: () => void = toMenu) {
  show(null);
  duel = new Duel(ctx, setup, (e) => {
    duel = null;
    if (e.kind === 'rematch') rematch(); else onMenu();
  });
}

// ------------------------------------------------------------------ online

function toOnline() {
  if (!onlineConfigured()) {
    const b = h('button', {}, 'BACK');
    b.onclick = toMenu;
    const el = h('div', { class: 'screen dim' },
      h('div', { class: 'title-label' }, 'ONLINE'),
      h('div', { class: 'panel', html: '<h2>Online unavailable: no server configured</h2><p>This build has no Supabase project attached. Vs CPU and Local Versus work fine.</p><p>To turn online on, set <span class="kc">VITE_SUPABASE_URL</span> and <span class="kc">VITE_SUPABASE_ANON_KEY</span> and rebuild.</p>' }),
      h('div', { class: 'menu' }, b));
    ui.append(el);
    const off = navMenu(ctx, [b], toMenu);
    show({ dispose: () => { off(); el.remove(); } });
    return;
  }
  const host = h('button', {}, 'HOST A DUEL');
  const join = h('button', {}, 'JOIN WITH A CODE');
  const back = h('button', {}, 'BACK');
  host.onclick = () => lobby('host');
  join.onclick = () => joinPrompt();
  back.onclick = toMenu;
  const el = h('div', { class: 'screen dim' }, h('div', { class: 'title-label' }, 'ONLINE'), h('div', { class: 'menu' }, host, join, back),
    h('div', { class: 'hint' }, 'Reaction times are measured on your own screen, so lag never decides the draw.'));
  ui.append(el);
  const off = navMenu(ctx, [host, join, back], toMenu);
  show({ dispose: () => { off(); el.remove(); } });
}

function joinPrompt() {
  const field = h('input', { class: 'code-input', placeholder: 'DUSK-42', maxlength: 10, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const go = h('button', {}, 'JOIN');
  const back = h('button', {}, 'BACK');
  go.onclick = () => { const c = normalizeCode(field.value); if (c.length >= 4) lobby('guest', c); };
  back.onclick = toOnline;
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') go.click();
    if (e.key === 'Escape') back.click();
  });
  const el = h('div', { class: 'screen dim' }, h('div', { class: 'title-label' }, 'ENTER THE ROOM CODE'), field, h('div', { class: 'menu' }, go, back));
  ui.append(el);
  show({ dispose: () => el.remove() });
  setTimeout(() => field.focus(), 50);
}

function lobby(role: 'host' | 'guest', code = makeRoomCode()) {
  const status = h('div', { class: 'status-line' }, 'Riding to the server...');
  const back = h('button', {}, 'CANCEL');
  let room: Room | null = null;
  let cancelled = false;
  let timer = 0;
  const cancel = () => { cancelled = true; clearTimeout(timer); room?.leave(); toOnline(); };
  back.onclick = cancel;
  const el = h('div', { class: 'screen dim' },
    h('div', { class: 'title-label' }, role === 'host' ? 'YOUR ROOM CODE' : 'JOINING'),
    h('div', { class: 'room-code' }, code),
    status, h('div', { class: 'menu' }, back),
    h('div', { class: 'hint' }, role === 'host' ? 'Send the code to your rival. They pick ONLINE → JOIN.' : ''));
  ui.append(el);
  const off = navMenu(ctx, [back], cancel);
  show({ dispose: () => { off(); el.remove(); } });

  openRoom(code, role).then((r) => {
    if (cancelled) { r.leave(); return; }
    room = r;
    status.textContent = role === 'host' ? 'Waiting for a rival to walk in...' : 'Looking for the host...';
    if (role === 'guest') timer = window.setTimeout(() => { if (r.status !== 'ready') status.textContent = `Nobody is hosting ${code}. Check the code.`; }, 8000);
    const check = (s: string) => {
      if (s === 'ready') { clearTimeout(timer); onlineSelect(r); }
      if (s === 'full') status.textContent = 'That room is full.';
    };
    r.onStatus(check);
    check(r.status);
  }).catch((e: Error) => {
    status.textContent = e.message || 'Could not reach the server.';
  });
}

function onlineSelect(room: Room) {
  let mine: CharacterId | null = null;
  let theirs: CharacterId | null = null;
  let started = false;
  const offs: (() => void)[] = [];
  const statusText = () => (theirs ? 'RIVAL LOCKED' : 'RIVAL CHOOSING...');
  const tryStart = () => {
    if (started || !mine || !theirs || room.role !== 'host') return;
    started = true;
    const chars: [CharacterId, CharacterId] = [mine, theirs];
    room.send({ type: 'start', characters: chars });
    begin(chars);
  };
  const begin = (chars: [CharacterId, CharacterId]) => {
    started = true;
    offs.forEach((o) => o());
    startDuel(
      { mode: 'online', characters: chars, localView: room.role === 'host' ? 0 : 1, net: room, isHost: room.role === 'host' },
      () => onlineSelect(room),
      () => { room.leave(); toMenu(); },
    );
  };
  offs.push(room.on((m: NetMsg) => {
    if (m.type === 'pick') { theirs = m.character; sel.setStatus(''); tryStart(); }
    if (m.type === 'start' && room.role === 'guest') begin(room.role === 'guest' ? m.characters : m.characters);
    if (m.type === 'bye') { offs.forEach((o) => o()); toast('YOUR RIVAL LEFT'); room.leave(); toOnline(); }
  }));
  offs.push(room.onStatus((s) => {
    if (s === 'lost' && !started) { offs.forEach((o) => o()); toast('CONNECTION LOST'); room.leave(); toOnline(); }
  }));
  const sel = charSelect(ctx, { pickers: [0], title: `ONLINE · ${room.code}`, status: statusText }, ([c]) => {
    mine = c;
    room.send({ type: 'pick', character: c });
    tryStart();
  }, () => { offs.forEach((o) => o()); room.leave(); toOnline(); });
  show({ dispose: () => sel.dispose() });
}

function toast(text: string) {
  const el = h('div', { class: 'toast' }, text);
  ui.append(el);
  setTimeout(() => el.remove(), 2500);
}

// ------------------------------------------------------------------ loop

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    if (!duel) input.poll();
    duel?.frame(now);
    stage.frame(dt);
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(loop);
}

applySettings();
layout();
toTitle();
requestAnimationFrame(loop);
// Unlock audio on the first gesture anywhere.
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { once: false });
window.addEventListener('keydown', unlock, { once: false });

// Dev-only hook for automated play-testing.
if (import.meta.env.DEV) (window as unknown as { __pp: unknown }).__pp = { get duel() { return duel; }, settings: () => settings };
