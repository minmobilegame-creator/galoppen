import { describe, expect, it } from 'vitest';
import {
  addPoints,
  aiThrow,
  createRace,
  formatTime,
  loadBest,
  saveBest,
  start,
  stop,
  tick,
} from '../src/game/race';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('væddeløb', () => {
  it('har fire baner med spilleren øverst', () => {
    const r = createRace(seeded());
    expect(r.racers).toHaveLength(4);
    expect(r.racers[0].human).toBe(true);
  });

  it('point tæller kun, mens løbet kører', () => {
    const r = createRace(seeded());
    addPoints(r, 0, 3);
    expect(r.racers[0].score).toBe(0);
    start(r);
    addPoints(r, 0, 3);
    expect(r.racers[0].score).toBe(3);
  });

  it('første til 20 vinder, og scoren stopper ved 20', () => {
    const r = createRace(seeded());
    start(r);
    for (let i = 0; i < 6; i++) addPoints(r, 0, 3);
    expect(addPoints(r, 0, 3)).toBe(true);
    expect(r.racers[0].score).toBe(20);
    expect(r.status).toBe('finished');
    expect(r.winner?.id).toBe(0);
  });

  it('tiden står stille ved stop', () => {
    const r = createRace(seeded());
    start(r);
    tick(r, 1000, seeded());
    stop(r);
    tick(r, 5000, seeded());
    expect(r.elapsed).toBe(1000);
  });

  it('computerne bliver færdige på rimelig tid', () => {
    const rng = seeded(42);
    const r = createRace(rng);
    r.racers[0].score = 0;
    start(r);
    let t = 0;
    while (r.status === 'running' && t < 600_000) {
      tick(r, 100, rng);
      t += 100;
    }
    expect(r.winner).not.toBeNull();
    expect(r.winner?.human).toBe(false);
    expect(r.elapsed).toBeGreaterThan(30_000);
    expect(r.elapsed).toBeLessThan(150_000);
  });

  it('computerkast giver 0–3 point', () => {
    const rng = seeded(7);
    for (let i = 0; i < 200; i++) expect([0, 1, 2, 3]).toContain(aiThrow(0.5, rng));
  });
});

describe('bedste tid', () => {
  it('gemmer kun en bedre tid', () => {
    const s = new MemStore();
    expect(loadBest(s)).toBeNull();
    expect(saveBest(s, 60_000)).toBe(true);
    expect(saveBest(s, 70_000)).toBe(false);
    expect(saveBest(s, 50_000)).toBe(true);
    expect(loadBest(s)).toBe(50_000);
  });

  it('formaterer tid som m:ss.s', () => {
    expect(formatTime(65_432)).toBe('1:05.4');
  });
});
