/**
 * Ren 2D-fysik for Galoppen-bordet. Ingen afhængighed af Three.js eller DOM,
 * så den kan enhedstestes. Enheder: meter, sekunder.
 */
import {
  BALL_HOMES,
  BALL_R,
  FIELD,
  HAND_LIMIT_Y,
  HOLE_R,
  HOLES,
  LAUNCH_LINE_Y,
  RIM_R,
  type Hole,
} from './layout';

export type BallState = 'resting' | 'held' | 'rolling' | 'sinking' | 'returning';

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: BallState;
  /** Kastet og endnu ikke afgjort (point eller tilbage i nedre bane). */
  inPlay: boolean;
  /** Tid i nuværende sinking/returning-fase. */
  t: number;
  /** Hullet kuglen er sunket i (under sinking). */
  hole: Hole | null;
}

export interface PhysicsParams {
  /** Hældningens acceleration ned mod spilleren (m/s²). */
  slope: number;
  /** Rullemodstand på banen (m/s²). */
  rollFriction: number;
  /** Ekstra bremsning i den flade nedre bane (m/s²). */
  trayFriction: number;
  /** Ekstra bremsning når kuglen ruller hen over gummilisten (m/s²). */
  rimFriction: number;
  /** Hvor kraftigt hullet trækker en kugle, der er over åbningen (m/s²). */
  holePull: number;
  /** Kuglen suges ned, hvis den er tættere på centrum end dette ... */
  captureRadius: number;
  /** ... og langsommere end dette (m/s). */
  captureSpeed: number;
  wallRestitution: number;
  ballRestitution: number;
  maxThrowSpeed: number;
  sinkTime: number;
  returnTime: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  slope: 0.3,
  rollFriction: 0.1,
  trayFriction: 1.6,
  rimFriction: 0.5,
  holePull: 4,
  captureRadius: HOLE_R * 0.75,
  captureSpeed: 1.0,
  wallRestitution: 0.55,
  ballRestitution: 0.9,
  maxThrowSpeed: 6,
  sinkTime: 0.45,
  returnTime: 1.4,
};

export type PhysicsEvent =
  | { type: 'score'; ball: Ball; hole: Hole; points: number }
  | { type: 'miss'; ball: Ball }
  | { type: 'wall'; ball: Ball; speed: number }
  | { type: 'collide'; a: Ball; b: Ball; speed: number }
  | { type: 'home'; ball: Ball };

export interface World {
  balls: Ball[];
  params: PhysicsParams;
}

export function createWorld(params: Partial<PhysicsParams> = {}): World {
  return {
    params: { ...DEFAULT_PARAMS, ...params },
    balls: BALL_HOMES.map((h, id) => ({
      id,
      x: h.x,
      y: h.y,
      vx: 0,
      vy: 0,
      state: 'resting' as BallState,
      inPlay: false,
      t: 0,
      hole: null,
    })),
  };
}

const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);
const onTable = (b: Ball) => b.state === 'resting' || b.state === 'rolling' || b.state === 'held';

/* ------------------------------------------------------------------ hånd */

/** Kan hånden være på dette punkt? (nedre bane + en tredjedel op) */
export function inHandZone(y: number): boolean {
  return y <= HAND_LIMIT_Y;
}

/** Find den kugle hånden kan samle op nær (x, y), eller null. */
export function pickBall(world: World, x: number, y: number, reach = 0.45): Ball | null {
  if (!inHandZone(y)) return null;
  let best: Ball | null = null;
  let bestD = reach;
  for (const b of world.balls) {
    if (b.state !== 'resting' && !(b.state === 'rolling' && b.y < HAND_LIMIT_Y)) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  if (best) {
    best.state = 'held';
    best.vx = best.vy = 0;
    best.inPlay = false;
  }
  return best;
}

/** Flyt den holdte kugle. Holdes inden for bordet og hånd-zonen. */
export function moveHeld(world: World, ball: Ball, x: number, y: number): void {
  if (ball.state !== 'held') return;
  ball.x = clamp(x, FIELD.xMin + BALL_R, FIELD.xMax - BALL_R);
  ball.y = clamp(y, FIELD.yMin + BALL_R, HAND_LIMIT_Y);
  // Skub andre kugler væk, så hånden ikke kan presse kugler ind i hinanden.
  for (const o of world.balls) {
    if (o === ball || !onTable(o)) continue;
    const dx = o.x - ball.x;
    const dy = o.y - ball.y;
    const d = Math.hypot(dx, dy);
    if (d < 2 * BALL_R && d > 1e-9) {
      const push = 2 * BALL_R - d;
      o.x += (dx / d) * push;
      o.y += (dy / d) * push;
      if (o.state === 'resting') o.state = 'rolling';
    }
  }
}

/** Slip kuglen med en given hastighed (m/s). */
export function releaseBall(world: World, ball: Ball, vx: number, vy: number): void {
  if (ball.state !== 'held') return;
  const s = Math.hypot(vx, vy);
  const max = world.params.maxThrowSpeed;
  const k = s > max ? max / s : 1;
  ball.vx = vx * k;
  ball.vy = vy * k;
  ball.state = 'rolling';
  ball.inPlay = ball.vy > 0.2;
}

/* ------------------------------------------------------------------ simulering */

const FIXED_DT = 1 / 240;

/** Kør simuleringen dt sekunder frem i faste små skridt. */
export function step(world: World, dt: number): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  let left = Math.min(dt, 0.1); // undgå store spring efter en pause
  while (left > 1e-9) {
    const h = Math.min(FIXED_DT, left);
    substep(world, h, events);
    left -= h;
  }
  return events;
}

function substep(world: World, h: number, events: PhysicsEvent[]): void {
  const p = world.params;

  for (const b of world.balls) {
    if (b.state === 'sinking') {
      b.t += h;
      if (b.t >= p.sinkTime) {
        b.state = 'returning';
        b.t = 0;
      }
      continue;
    }
    if (b.state === 'returning') {
      b.t += h;
      if (b.t >= p.returnTime) placeHome(world, b, events);
      continue;
    }
    if (b.state !== 'rolling') continue;

    integrate(b, h, p);
    collideWalls(b, p, events);
    if (checkCapture(b, p, events)) continue;
    settle(b, events);
  }

  collideBalls(world, p, events);
}

function integrate(b: Ball, h: number, p: PhysicsParams): void {
  const inTray = b.y < LAUNCH_LINE_Y;
  let ax = 0;
  let ay = inTray ? 0 : -p.slope;

  // Hullerne: træk mod centrum, når kuglen er over åbningen; gummilisten bremser.
  let extraFriction = inTray ? p.trayFriction : 0;
  for (const hole of HOLES) {
    const dx = hole.x - b.x;
    const dy = hole.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < HOLE_R && d > 1e-6) {
      ax += (dx / d) * p.holePull;
      ay += (dy / d) * p.holePull;
    } else if (d < RIM_R + BALL_R * 0.3) {
      extraFriction += p.rimFriction;
    }
  }

  b.vx += ax * h;
  b.vy += ay * h;

  // Rullemodstand modsat bevægelsen (kan ikke vende retningen).
  // Gummilisten bremser kun en kugle i fart; den må ikke kunne holde den fast på skråningen.
  const s = speedOf(b);
  if (!inTray && s < 0.15) extraFriction = 0;
  if (s > 1e-9) {
    const dec = (p.rollFriction + extraFriction) * h;
    const k = s > dec ? (s - dec) / s : 0;
    b.vx *= k;
    b.vy *= k;
  }

  b.x += b.vx * h;
  b.y += b.vy * h;
}

function collideWalls(b: Ball, p: PhysicsParams, events: PhysicsEvent[]): void {
  const e = p.wallRestitution;
  const minX = FIELD.xMin + BALL_R;
  const maxX = FIELD.xMax - BALL_R;
  const minY = FIELD.yMin + BALL_R;
  const maxY = FIELD.yMax - BALL_R;
  if (b.x < minX && b.vx < 0) {
    events.push({ type: 'wall', ball: b, speed: -b.vx });
    b.x = minX;
    b.vx = -b.vx * e;
  } else if (b.x > maxX && b.vx > 0) {
    events.push({ type: 'wall', ball: b, speed: b.vx });
    b.x = maxX;
    b.vx = -b.vx * e;
  }
  if (b.y < minY && b.vy < 0) {
    events.push({ type: 'wall', ball: b, speed: -b.vy });
    b.y = minY;
    b.vy = -b.vy * e;
  } else if (b.y > maxY && b.vy > 0) {
    events.push({ type: 'wall', ball: b, speed: b.vy });
    b.y = maxY;
    b.vy = -b.vy * e;
  }
}

function checkCapture(b: Ball, p: PhysicsParams, events: PhysicsEvent[]): boolean {
  const s = speedOf(b);
  if (s >= p.captureSpeed) return false;
  for (const hole of HOLES) {
    if (Math.hypot(hole.x - b.x, hole.y - b.y) < p.captureRadius) {
      b.state = 'sinking';
      b.t = 0;
      b.hole = hole;
      b.x = hole.x;
      b.y = hole.y;
      b.vx = b.vy = 0;
      b.inPlay = false;
      events.push({ type: 'score', ball: b, hole, points: hole.points });
      return true;
    }
  }
  return false;
}

/** En kugle, der er rullet tilbage i nedre bane og ligger stille. */
function settle(b: Ball, events: PhysicsEvent[]): void {
  if (b.y < LAUNCH_LINE_Y && speedOf(b) < 0.02) {
    b.vx = b.vy = 0;
    b.state = 'resting';
    if (b.inPlay) {
      b.inPlay = false;
      events.push({ type: 'miss', ball: b });
    }
  }
}

function collideBalls(world: World, p: PhysicsParams, events: PhysicsEvent[]): void {
  const bs = world.balls;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      if (!onTable(a) || !onTable(b)) continue;
      if (a.state === 'held' || b.state === 'held') continue; // håndteres i moveHeld
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 2 * BALL_R || d < 1e-9) continue;
      const nx = dx / d;
      const ny = dy / d;
      // Skil dem ad.
      const overlap = 2 * BALL_R - d;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;
      // Lige store masser: udveksl hastigheden langs normalen.
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const jImp = ((1 + p.ballRestitution) * rel) / 2;
      a.vx -= jImp * nx;
      a.vy -= jImp * ny;
      b.vx += jImp * nx;
      b.vy += jImp * ny;
      if (a.state === 'resting') a.state = 'rolling';
      if (b.state === 'resting') b.state = 'rolling';
      events.push({ type: 'collide', a, b, speed: rel });
    }
  }
}

function placeHome(world: World, b: Ball, events: PhysicsEvent[]): void {
  const home = BALL_HOMES[b.id % BALL_HOMES.length];
  let x = home.x;
  // Ligger der allerede en kugle på startpladsen, så læg den ved siden af.
  for (const o of world.balls) {
    if (o !== b && onTable(o) && Math.hypot(o.x - x, o.y - home.y) < 2 * BALL_R) {
      x = home.x + (home.x < 0 ? 1 : -1) * 2.2 * BALL_R;
    }
  }
  b.x = x;
  b.y = home.y;
  b.vx = b.vy = 0;
  b.t = 0;
  b.hole = null;
  b.state = 'resting';
  events.push({ type: 'home', ball: b });
}

/** Hvor langt en kugle med fart v ruller op ad banen, før den vender. */
export function stoppingDistance(v: number, p: PhysicsParams = DEFAULT_PARAMS): number {
  return (v * v) / (2 * (p.slope + p.rollFriction));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
