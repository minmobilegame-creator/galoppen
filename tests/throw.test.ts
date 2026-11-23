import { describe, expect, it } from 'vitest';
import { estimateVelocity, ThrowTracker } from '../src/game/throw';

describe('kastets hastighed', () => {
  it('finder den præcise fart ved jævn bevægelse', () => {
    const s = Array.from({ length: 10 }, (_, i) => ({ t: i * 16, x: i * 0.016, y: -i * 0.032 }));
    const v = estimateVelocity(s, 144);
    expect(v.vx).toBeCloseTo(1, 6);
    expect(v.vy).toBeCloseTo(-2, 6);
  });

  it('bruger kun de sidste 160 ms', () => {
    const t = new ThrowTracker();
    // først en langsom bevægelse, så stilstand i 200 ms
    for (let i = 0; i <= 10; i++) t.add(i * 16, i * 0.1, 0);
    for (let i = 1; i <= 13; i++) t.add(160 + i * 16, 1, 0);
    expect(t.velocity(160 + 13 * 16).vx).toBeCloseTo(0, 6);
  });

  it('giver 0 med for få prøver', () => {
    expect(estimateVelocity([{ t: 0, x: 0, y: 0 }], 0)).toEqual({ vx: 0, vy: 0 });
  });
});
