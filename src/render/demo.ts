// Standalone preview of the Stage. Keys: 1-0 poses (far), shift+digit poses (near), Q-P fx, F filter, C chars, etc.
import { Stage, fitCanvas } from './index';
import type { CharacterId, Pose, FxKind, FakeKind, FilterMode, ScreenSide } from '../types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const stage = new Stage(canvas);
fitCanvas(canvas);
addEventListener('resize', () => fitCanvas(canvas));

const chars: CharacterId[] = ['hector', 'dusty', 'mercy'];
const poses: Pose[] = ['idle', 'ready', 'draw', 'fire', 'hit', 'dead', 'heal', 'win', 'blinded', 'jam'];
const fxs: FxKind[] = ['muzzle', 'shotgunBlast', 'smokePuff', 'dust', 'hatFly', 'lanternFlash', 'cigarSmoke', 'whiskey', 'vaporize', 'heal', 'sparks'];
const fakes: FakeKind[] = ['crow', 'tumbleweed', 'door', 'cough'];
const filters: FilterMode[] = ['color', 'noir', 'onebit', 'sepia'];
let ci = 0, cj = 1, fi = 0, push = 0, side: ScreenSide = 'far', fxi = 0, fki = 0, charge = 0, drunk = false, cloud = false, title = false;
const state = () => (hud.textContent = `near=${chars[ci]} far=${chars[cj]} side=${side} filter=${filters[fi]} push=${push}\n0-9 pose | x fx(${fxs[fxi]}) z next fx | v fake(${fakes[fki]}) | b bell | f filter | c/n chars | s side | p push | h halo | d drunk | k cloud | m slowmo | t title | w wash | g flash`);
state();

const q = new URLSearchParams(location.search);
if (q.get('near')) ci = chars.indexOf(q.get('near') as CharacterId);
if (q.get('far')) cj = chars.indexOf(q.get('far') as CharacterId);
stage.setDuelists(chars[ci], chars[cj]);
if (q.get('filter')) stage.setPost({ filter: q.get('filter') as FilterMode });
if (q.get('pose')) { stage.setPose('far', q.get('pose') as Pose); stage.setPose('near', (q.get('npose') ?? q.get('pose')) as Pose); }
if (q.get('title')) stage.setMode('title');
if (q.get('halo')) stage.setHalo('far', Number(q.get('halo')));
if (q.get('cloud')) stage.setSmokeCloud(true);

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (/^[0-9]$/.test(k)) stage.setPose(side, poses[Number(k)]);
  if (k === 'x') { stage.fx(fxs[fxi], side); if (fxs[fxi] === 'muzzle' || fxs[fxi] === 'shotgunBlast') stage.setPose(side, 'fire'); }
  if (k === 'z') fxi = (fxi + 1) % fxs.length;
  if (k === 'v') { stage.fake(fakes[fki]); fki = (fki + 1) % fakes.length; }
  if (k === 'b') stage.ringBell();
  if (k === 'f') { fi = (fi + 1) % filters.length; stage.setPost({ filter: filters[fi] }); }
  if (k === 'c') { ci = (ci + 1) % 3; stage.setDuelists(chars[ci], chars[cj]); }
  if (k === 'n') { cj = (cj + 1) % 3; stage.setDuelists(chars[ci], chars[cj]); }
  if (k === 's') side = side === 'far' ? 'near' : 'far';
  if (k === 'p') { push = (push + 1) % 4; stage.setPush(push); }
  if (k === 'h') { charge = (charge + 1) % 3; stage.setHalo(side, charge); }
  if (k === 'd') { drunk = !drunk; stage.setDrunk(side, drunk); }
  if (k === 'k') { cloud = !cloud; stage.setSmokeCloud(cloud); }
  if (k === 'm') { stage.punch(); stage.slowmo(0.2, 1500); }
  if (k === 't') { title = !title; stage.setMode(title ? 'title' : 'duel'); }
  if (k === 'w') { stage.setPost({ washLeft: 0.9 }); setTimeout(() => stage.setPost({ washLeft: 0 }), 900); }
  if (k === 'g') { stage.setPost({ flash: 1 }); setTimeout(() => stage.setPost({ flash: 0 }), 80); }
  state();
});

let last = performance.now();
const loop = (now: number) => {
  stage.frame((now - last) / 1000);
  last = now;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
(window as unknown as { stage: Stage }).stage = stage;
