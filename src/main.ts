import './style.css';
import { FIELD, HAND_LIMIT_Y } from './game/layout';
import {
  createWorld,
  findPickable,
  inHandZone,
  moveHeld,
  pickBall,
  releaseBall,
  step,
  type Ball,
  type PhysicsEvent,
} from './game/physics';
import {
  addPoints,
  createRace,
  formatTime,
  loadBest,
  saveBest,
  start,
  stop,
  tick,
  type KeyValueStore,
  type Race,
} from './game/race';
import { ThrowTracker } from './game/throw';
import { GameScene } from './render/scene';
import { Scoreboard } from './ui/scoreboard';
import { Sfx } from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const stage = $<HTMLElement>('stage');
const popups = $<HTMLDivElement>('popups');
const timeEl = $<HTMLSpanElement>('time');
const bestEl = $<HTMLSpanElement>('best');
const startBtn = $<HTMLButtonElement>('startBtn');
const resetBtn = $<HTMLButtonElement>('resetBtn');
const winner = $<HTMLDivElement>('winner');

function safeStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const store = safeStorage();

const world = createWorld();
const view = new GameScene(canvas);
const board = new Scoreboard($<HTMLOListElement>('lanes'), $<HTMLCanvasElement>('horses'));
const sfx = new Sfx();
const tracker = new ThrowTracker();

let race: Race = createRace();
board.build(race);

/* ---------------------------------------------------------------- UI */

function refreshButtons(): void {
  const labels: Record<Race['status'], string> = {
    ready: 'Start',
    running: 'Stop',
    paused: 'Fortsæt',
    finished: 'Start',
  };
  startBtn.textContent = labels[race.status];
  startBtn.classList.toggle('running', race.status === 'running');
}

function refreshBest(): void {
  const b = loadBest(store);
  bestEl.textContent = b == null ? '–' : formatTime(b);
}

function newRace(autoStart: boolean): void {
  race = createRace();
  board.build(race);
  winner.hidden = true;
  if (autoStart) start(race);
  refreshButtons();
}

startBtn.addEventListener('click', () => {
  sfx.unlock();
  if (race.status === 'running') stop(race);
  else if (race.status === 'finished') newRace(true);
  else start(race);
  refreshButtons();
});
resetBtn.addEventListener('click', () => newRace(false));
$<HTMLButtonElement>('againBtn').addEventListener('click', () => newRace(true));

function showWinner(): void {
  const w = race.winner!;
  const t = formatTime(race.elapsed);
  let text: string;
  if (w.human) {
    const record = saveBest(store, race.elapsed);
    refreshBest();
    $('winnerTitle').textContent = 'Du vandt! 🎉';
    text = `Din tid: ${t}.` + (record ? ' Ny rekord!' : '');
  } else {
    $('winnerTitle').textContent = `${w.name} vandt`;
    text = `${w.name} kom først i mål på ${t}. Prøv igen!`;
  }
  $('winnerText').textContent = text;
  winner.hidden = false;
  sfx.fanfare();
  refreshButtons();
}

function popup(x: number, y: number, text: string, cls: string): void {
  const p = view.toScreen(x, y, 0.2);
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  popups.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ---------------------------------------------------------------- styring */

let held: Ball | null = null;
let pointerId: number | null = null;

/**
 * Musens fart ganges med denne faktor. Uden den sender et lille ryk på 50 px
 * kuglen helt op til de røde huller, hvilket gør kastet svært at styre.
 */
const THROW_GAIN = 0.6;

function throwVelocity(now: number): { vx: number; vy: number } {
  const v = tracker.velocity(now);
  return { vx: v.vx * THROW_GAIN, vy: v.vy * THROW_GAIN };
}

function release(now: number): void {
  if (!held) return;
  const v = throwVelocity(now);
  releaseBall(world, held, v.vx, v.vy);
  held = null;
  pointerId = null;
  canvas.classList.remove('holding');
  view.setAim(null, 0, 0);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || held) return;
  sfx.unlock();
  const p = view.pickTable(e.clientX, e.clientY);
  if (!p) return;
  const b = pickBall(world, p.x, p.y);
  if (!b) return;
  held = b;
  pointerId = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* fx syntetiske events uden aktiv pointer */
  }
  canvas.classList.add('holding');
  tracker.reset();
  tracker.add(e.timeStamp, p.x, p.y);
  moveHeld(world, b, p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  const p = view.pickTable(e.clientX, e.clientY);
  // Ringen vises kun, hvor hånden kan være, og lyser op over en kugle, der kan tages.
  const onTable = !!p && Math.abs(p.x) < FIELD.xMax && p.y > FIELD.yMin && p.y < FIELD.yMax;
  const inReach = onTable && (held != null || inHandZone(p!.y));
  const canGrab = inReach && !held && !!findPickable(world, p!.x, p!.y);
  view.setCursor(inReach ? p : null, !!held || canGrab);
  canvas.classList.toggle('can-grab', canGrab);
  if (!held || e.pointerId !== pointerId || !p) return;
  // Brug alle mellemliggende musepunkter for en præcis fart.
  const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
  for (const ce of evs.length ? evs : [e]) {
    const q = view.pickTable(ce.clientX, ce.clientY);
    if (q) tracker.add(ce.timeStamp, q.x, q.y);
  }
  moveHeld(world, held, p.x, p.y);
  // Hånden kan ikke nå længere op: kuglen slipper af sig selv.
  if (p.y > HAND_LIMIT_Y + 0.05) release(e.timeStamp);
});

const endHold = (e: PointerEvent) => {
  if (e.pointerId === pointerId) release(e.timeStamp);
};
canvas.addEventListener('pointerup', endHold);
canvas.addEventListener('pointercancel', endHold);
canvas.addEventListener('pointerleave', () => {
  if (!held) view.setCursor(null, false);
});

/* ---------------------------------------------------------------- løkke */

function handle(events: PhysicsEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'score': {
        sfx.score(ev.points);
        view.flashHole(ev.hole.id);
        popup(ev.hole.x, ev.hole.y, `+${ev.points}`, `p${ev.points}`);
        if (addPoints(race, 0, ev.points)) showWinner();
        break;
      }
      case 'miss':
        sfx.miss();
        popup(ev.ball.x, ev.ball.y + 0.4, '0', 'miss');
        break;
      case 'wall':
        sfx.thud(ev.speed);
        break;
      case 'collide':
        sfx.clack(ev.speed);
        break;
    }
  }
}

let last = performance.now();
let lastShownTime = '';

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  handle(step(world, dt));

  const wasRunning = race.status === 'running';
  tick(race, dt * 1000);
  if (wasRunning && race.status === 'finished') showWinner();
  board.update(race);

  const t = formatTime(race.elapsed);
  if (t !== lastShownTime) {
    timeEl.textContent = t;
    lastShownTime = t;
  }

  if (held) {
    const v = throwVelocity(now);
    view.setAim(held, v.vx, v.vy);
  }

  view.update(world, dt, !!held);
  view.render();
  board.frame(dt);
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- start */

const ro = new ResizeObserver(() => {
  view.resize();
  board.resize();
});
ro.observe(stage);
ro.observe($('horses'));

// Kun under udvikling: adgang til spillets tilstand fra konsollen.
if (import.meta.env.DEV) Object.assign(window, { __galoppen: { world, view, get race() { return race; } } });

refreshBest();
refreshButtons();
const models = `${import.meta.env.BASE_URL}models/`;
view
  .loadModels(models)
  .then(() => $('loading').classList.add('done'))
  .catch((err) => {
    console.error(err);
    $('loading').textContent = 'Kunne ikke indlæse bordet.';
  });
board.loadHorse(models + 'horse.glb').catch((err) => console.error(err));
view.resize();
requestAnimationFrame(frame);
