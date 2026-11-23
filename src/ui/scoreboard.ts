import type { Race, Racer } from '../game/race';

const SHIRTS = ['#ffd34d', '#4fc3ff', '#ff6b8b', '#b98cff'];
const COATS = ['#7a4a26', '#3b2a1e', '#a8683a', '#efe6d6'];

/** En galoperende hest med jockey, vendt mod venstre (mod mål). */
function horseSvg(shirt: string, coat: string): string {
  const dark = coat === '#efe6d6' ? '#bdb2a0' : 'rgba(0,0,0,0.25)';
  return `
<svg viewBox="0 0 72 46" aria-hidden="true">
  <g class="body-bob">
    <g fill="${coat}" stroke="${dark}" stroke-width="0.6">
      <rect class="leg a" x="20" y="25" width="3.2" height="15" rx="1.5"/>
      <rect class="leg b" x="25" y="25" width="3.2" height="15" rx="1.5"/>
      <rect class="leg b" x="44" y="25" width="3.2" height="15" rx="1.5"/>
      <rect class="leg a" x="49" y="25" width="3.2" height="15" rx="1.5"/>
      <path d="M53 20 C 60 18, 66 24, 67 33 C 63 28, 58 25, 54 25 Z" fill="${dark}"/>
      <ellipse cx="37" cy="23" rx="18" ry="8.5"/>
      <path d="M24 21 L 14 8 L 20 5 L 30 17 Z"/>
      <path d="M8 11 C 8 7, 13 4, 19 5 L 20 11 C 16 13, 10 14, 8 11 Z"/>
      <path d="M17 5 L 19 0.5 L 21 5 Z"/>
    </g>
    <path d="M15 7 C 18 4, 22 6, 26 12" fill="none" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="11" cy="9" r="0.9" fill="#111"/>
    <path d="M30 15 L 36 8 L 41 11 L 38 17 Z" fill="${shirt}" stroke="rgba(0,0,0,0.3)" stroke-width="0.6"/>
    <circle cx="35" cy="5.5" r="3.4" fill="${shirt}" stroke="rgba(0,0,0,0.3)" stroke-width="0.6"/>
    <path d="M31.6 5.2 A3.4 3.4 0 0 1 38.4 5.2 Z" fill="#fff" opacity="0.6"/>
    <path d="M33 11 L 25 14" stroke="${shirt}" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;
}

interface LaneEls {
  track: HTMLDivElement;
  horse: HTMLDivElement;
  score: HTMLSpanElement;
  lastScore: number;
  stopGallop?: number;
}

export class Scoreboard {
  private lanes = new Map<number, LaneEls>();

  constructor(private root: HTMLOListElement) {}

  build(race: Race): void {
    this.root.innerHTML = '';
    this.lanes.clear();
    race.racers.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'lane' + (r.human ? ' human' : '');
      li.innerHTML = `
        <div class="tag" style="--shirt:${SHIRTS[i % SHIRTS.length]}"><span class="name">${r.name}</span><span class="score">0</span></div>
        <div class="track"><div class="horse">${horseSvg(SHIRTS[i % SHIRTS.length], COATS[i % COATS.length])}</div></div>`;
      this.root.appendChild(li);
      this.lanes.set(r.id, {
        track: li.querySelector('.track')!,
        horse: li.querySelector('.horse')!,
        score: li.querySelector('.score')!,
        lastScore: 0,
      });
    });
    // Placér hestene ved start uden animation, og slå den til bagefter.
    this.root.classList.remove('ready');
    this.update(race);
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('ready')));
  }

  update(race: Race): void {
    for (const r of race.racers) this.updateLane(r, race.target);
  }

  private updateLane(r: Racer, target: number): void {
    const el = this.lanes.get(r.id);
    if (!el) return;
    const laneW = el.track.clientWidth;
    const horseW = el.horse.offsetWidth || 72;
    const finish = 6; // næsen ved mållinjen
    const startX = laneW - horseW - 6;
    const frac = Math.min(1, r.score / target);
    el.horse.style.left = `${startX - (startX - finish) * frac}px`;

    if (r.score !== el.lastScore) {
      el.score.textContent = String(r.score);
      el.score.classList.remove('bump');
      void el.score.offsetWidth; // genstart animationen
      el.score.classList.add('bump');
      el.horse.classList.add('galloping');
      clearTimeout(el.stopGallop);
      el.stopGallop = window.setTimeout(() => el.horse.classList.remove('galloping'), 950);
      el.lastScore = r.score;
    }
  }
}
