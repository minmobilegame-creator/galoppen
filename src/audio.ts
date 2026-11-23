/** Små syntetiske lyde med Web Audio. Startes først ved brugerens første klik. */
export class Sfx {
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  clack(speed: number): void {
    this.tone(1800, 0.05, 'triangle', Math.min(0.25, 0.05 + speed * 0.08));
  }

  thud(speed: number): void {
    if (speed < 0.15) return;
    this.tone(140, 0.12, 'sine', Math.min(0.35, speed * 0.15), 0, 70);
  }

  score(points: number): void {
    const notes = [523, 659, 784, 1047].slice(0, points + 1);
    notes.forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.18, i * 0.08));
  }

  miss(): void {
    this.tone(330, 0.25, 'sine', 0.08, 0, 220);
  }

  fanfare(): void {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 'square', 0.07, i * 0.12));
  }
}
