import { describe, expect, it } from 'vitest';
import { BALL_R, HAND_LIMIT_Y, HOLES, LAUNCH_LINE_Y, RIM_R } from '../src/game/layout';
import {
  ballLift,
  createWorld,
  moveHeld,
  pickBall,
  releaseBall,
  step,
  stoppingDistance,
  type PhysicsEvent,
  type World,
} from '../src/game/physics';

function run(world: World, seconds: number): PhysicsEvent[] {
  const ev: PhysicsEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) ev.push(...step(world, 1 / 60));
  return ev;
}

/** Placer kugle 0 et sted på bordet med en given fart. */
function launch(world: World, x: number, y: number, vx: number, vy: number) {
  const b = world.balls[0];
  Object.assign(b, { x, y, vx, vy, state: 'rolling', inPlay: true });
  return b;
}

describe('layout', () => {
  it('har 16 huller: 7 gule, 7 blå, 2 røde', () => {
    expect(HOLES).toHaveLength(16);
    const count = (c: string) => HOLES.filter((h) => h.color === c).length;
    expect([count('yellow'), count('blue'), count('red')]).toEqual([7, 7, 2]);
  });

  it('er spejlet om midterlinjen', () => {
    for (const h of HOLES) {
      const mirror = HOLES.find((o) => Math.abs(o.x + h.x) < 1e-9 && Math.abs(o.y - h.y) < 1e-9);
      expect(mirror?.color).toBe(h.color);
    }
  });

  it('har ens afstand mellem nabohullerne langs V-benene', () => {
    // De to røde ligger tættere (som i Blender-filen); resten har samme diagonale afstand.
    const vHoles = HOLES.filter((h) => h.color !== 'red');
    const nearest = vHoles.map((h) =>
      Math.min(...vHoles.filter((o) => o !== h).map((o) => Math.hypot(o.x - h.x, o.y - h.y))),
    );
    for (const d of nearest) expect(d).toBeCloseTo(0.48, 2);
  });
});

describe('hånd og kast', () => {
  it('kan kun samle kugler op i hånd-zonen', () => {
    const w = createWorld();
    expect(pickBall(w, w.balls[0].x, HAND_LIMIT_Y + 0.5)).toBeNull();
    expect(pickBall(w, w.balls[0].x, w.balls[0].y)?.id).toBe(0);
  });

  it('holder kuglen under hånd-grænsen', () => {
    const w = createWorld();
    const b = pickBall(w, w.balls[0].x, w.balls[0].y)!;
    moveHeld(w, b, 0, 3);
    expect(b.y).toBeLessThanOrEqual(HAND_LIMIT_Y);
  });

  it('begrænser kastets fart', () => {
    const w = createWorld();
    const b = pickBall(w, w.balls[0].x, w.balls[0].y)!;
    releaseBall(w, b, 0, 100);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(w.params.maxThrowSpeed);
    expect(b.inPlay).toBe(true);
  });
});

describe('bevægelse', () => {
  it('ruller tilbage til nedre bane og giver 0 point', () => {
    const w = createWorld();
    launch(w, 1.2, -2, 0, 2); // ved siden af hullerne
    const ev = run(w, 20);
    const b = w.balls[0];
    expect(b.state).toBe('resting');
    expect(b.y).toBeLessThan(LAUNCH_LINE_Y);
    expect(ev.some((e) => e.type === 'miss')).toBe(true);
    expect(ev.some((e) => e.type === 'score')).toBe(false);
  });

  it('når cirka den forventede højde', () => {
    const w = createWorld();
    launch(w, 1.25, -2, 0, 2);
    let maxY = -Infinity;
    for (let i = 0; i < 600; i++) {
      step(w, 1 / 60);
      maxY = Math.max(maxY, w.balls[0].y);
    }
    expect(maxY + 2).toBeCloseTo(stoppingDistance(2), 1);
  });

  it('preller af bandet', () => {
    const w = createWorld();
    const b = launch(w, 1.2, 0, 2, 0);
    const ev = run(w, 0.5);
    expect(ev.some((e) => e.type === 'wall')).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(b.x).toBeLessThanOrEqual(1.5 - BALL_R + 1e-9);
  });

  it('to kugler støder sammen og bevarer impulsen', () => {
    const w = createWorld({ slope: 0, rollFriction: 0 });
    const [a, b] = w.balls;
    Object.assign(a, { x: -0.5, y: 0, vx: 1, vy: 0, state: 'rolling' });
    Object.assign(b, { x: 0.5, y: 0, vx: 0, vy: 0, state: 'rolling' });
    const ev = run(w, 1);
    expect(ev.some((e) => e.type === 'collide')).toBe(true);
    expect(a.vx + b.vx).toBeCloseTo(1, 5);
    expect(b.vx).toBeGreaterThan(a.vx);
  });
});

describe('huller', () => {
  const red = HOLES.find((h) => h.color === 'red')!;
  const yellow = HOLES.find((h) => h.id === 'Hole_Yellow_07')!;

  it('en langsom, præcis kugle suges ned og giver point', () => {
    const w = createWorld();
    launch(w, red.x, red.y - 0.25, 0, 0.6);
    const ev = run(w, 1);
    const score = ev.find((e) => e.type === 'score');
    expect(score && score.type === 'score' && score.points).toBe(3);
  });

  it('en hurtig kugle ruller hen over hullet', () => {
    const w = createWorld();
    launch(w, yellow.x, yellow.y - 0.4, 0, 3);
    const ev = run(w, 0.3);
    expect(ev.some((e) => e.type === 'score')).toBe(false);
    expect(w.balls[0].y).toBeGreaterThan(yellow.y);
  });

  it('gummilisten afbøjer en kugle, der rammer den på siden', () => {
    const w = createWorld();
    const outer = HOLES.find((h) => h.id === 'Hole_Yellow_02')!;
    const b = launch(w, outer.x + 0.25, outer.y - 0.4, 0, 1.2);
    const ev = run(w, 0.6);
    expect(ev.some((e) => e.type === 'score')).toBe(false);
    expect(b.x - (outer.x + 0.25)).toBeGreaterThan(0.05); // skubbet væk fra hullet
  });

  it('en meget langsom kugle kan ikke komme op over gummilisten', () => {
    const w = createWorld({ slope: 0 });
    const b = launch(w, yellow.x, yellow.y - 0.35, 0, 0.4);
    const ev = run(w, 2);
    expect(ev.some((e) => e.type === 'score')).toBe(false);
    expect(b.y).toBeLessThan(yellow.y - RIM_R);
  });

  it('en kugle midt over hullet suges ned, selv med god fart', () => {
    const w = createWorld();
    launch(w, yellow.x, yellow.y - 0.4, 0, 1.5);
    const ev = run(w, 1);
    const s = ev.find((e) => e.type === 'score');
    expect(s && s.type === 'score' && s.hole.id).toBe(yellow.id);
  });

  it('kuglen synker ned, mens den er over hullet', () => {
    const w = createWorld();
    const b = launch(w, yellow.x, yellow.y - 0.12, 0, 2.5);
    step(w, 0.05);
    expect(b.drop).toBeGreaterThan(0);
    expect(ballLift(b)).toBeLessThan(0);
  });

  it('kuglen ruller tilbage til sin startplads efter point', () => {
    const w = createWorld();
    const b = launch(w, red.x, red.y - 0.25, 0, 0.6);
    const ev = run(w, 4);
    expect(ev.some((e) => e.type === 'home')).toBe(true);
    expect(b.state).toBe('resting');
    expect(b.y).toBeLessThan(LAUNCH_LINE_Y);
  });
});
