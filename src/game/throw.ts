/** Kastets hastighed beregnes ud fra håndens bevægelse de sidste 160 ms. */

export interface Sample {
  t: number; // ms
  x: number;
  y: number;
}

export const THROW_WINDOW_MS = 160;

export class ThrowTracker {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  add(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y });
    // Behold lidt mere end vinduet, så vi altid har et startpunkt.
    const cutoff = t - THROW_WINDOW_MS * 2;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Hastighed i enheder pr. sekund. */
  velocity(now: number): { vx: number; vy: number } {
    return estimateVelocity(this.samples, now);
  }
}

/**
 * Mindste kvadraters hældning af x(t) og y(t) for prøverne i vinduet.
 * Mere robust end (sidste - første), når musen hakker.
 */
export function estimateVelocity(
  samples: readonly Sample[],
  now: number,
  windowMs = THROW_WINDOW_MS,
): { vx: number; vy: number } {
  const win = samples.filter((s) => s.t >= now - windowMs && s.t <= now);
  if (win.length < 2) return { vx: 0, vy: 0 };
  const n = win.length;
  let mt = 0;
  let mx = 0;
  let my = 0;
  for (const s of win) {
    mt += s.t;
    mx += s.x;
    my += s.y;
  }
  mt /= n;
  mx /= n;
  my /= n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const s of win) {
    const dt = s.t - mt;
    stt += dt * dt;
    stx += dt * (s.x - mx);
    sty += dt * (s.y - my);
  }
  if (stt < 1e-9) return { vx: 0, vy: 0 };
  // pr. ms -> pr. sekund
  return { vx: (stx / stt) * 1000, vy: (sty / stt) * 1000 };
}
