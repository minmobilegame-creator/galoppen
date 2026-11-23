/** Hestevæddeløbet: fire baner, første til målet vinder. Ren logik uden DOM. */

export const TARGET_POINTS = 20;

export interface Racer {
  id: number;
  name: string;
  human: boolean;
  score: number;
  /** Næste gang (ms i løbstid) computeren "kaster". */
  nextThrowAt: number;
  /** 0..1, hvor god computeren er. */
  skill: number;
}

export type RaceStatus = 'ready' | 'running' | 'paused' | 'finished';

export interface Race {
  racers: Racer[];
  status: RaceStatus;
  /** Løbstid i ms (tæller op, står stille ved pause). */
  elapsed: number;
  winner: Racer | null;
  target: number;
}

export type Rng = () => number;

export interface RaceEvent {
  racer: Racer;
  points: number;
}

const AI_NAMES = ['Lyn', 'Storm', 'Tordenbrag'];
const AI_SKILL = [0.55, 0.5, 0.45];

export function createRace(rng: Rng = Math.random, target = TARGET_POINTS): Race {
  const racers: Racer[] = [
    { id: 0, name: 'Dig', human: true, score: 0, nextThrowAt: Infinity, skill: 0 },
    ...AI_NAMES.map((name, i) => ({
      id: i + 1,
      name,
      human: false,
      score: 0,
      skill: AI_SKILL[i],
      nextThrowAt: aiDelay(rng),
    })),
  ];
  return { racers, status: 'ready', elapsed: 0, winner: null, target };
}

export function start(race: Race): void {
  if (race.status === 'ready' || race.status === 'paused') race.status = 'running';
}

export function stop(race: Race): void {
  if (race.status === 'running') race.status = 'paused';
}

/** Giv point. Returnerer true hvis det afgjorde løbet. */
export function addPoints(race: Race, racerId: number, points: number): boolean {
  if (race.status !== 'running') return false;
  const r = race.racers.find((x) => x.id === racerId);
  if (!r || points <= 0) return false;
  r.score = Math.min(race.target, r.score + points);
  if (r.score >= race.target) {
    race.status = 'finished';
    race.winner = r;
    return true;
  }
  return false;
}

/** Lad tiden gå. Computerspillerne kaster, når deres tid kommer. */
export function tick(race: Race, dtMs: number, rng: Rng = Math.random): RaceEvent[] {
  if (race.status !== 'running') return [];
  race.elapsed += dtMs;
  const events: RaceEvent[] = [];
  for (const r of race.racers) {
    if (r.human) continue;
    while (race.status === 'running' && race.elapsed >= r.nextThrowAt) {
      const pts = aiThrow(r.skill, rng);
      if (pts > 0) {
        events.push({ racer: r, points: pts });
        addPoints(race, r.id, pts);
      }
      r.nextThrowAt += aiDelay(rng);
    }
  }
  return events;
}

/** Tid mellem computerkast: 2,4–4,4 s (som et menneske med to kugler). */
function aiDelay(rng: Rng): number {
  return 2400 + rng() * 2000;
}

/** Point for ét computerkast. Bedre skill = færre misser og flere høje huller. */
export function aiThrow(skill: number, rng: Rng): 0 | 1 | 2 | 3 {
  const r = rng();
  const miss = 0.5 - skill * 0.3;
  const three = 0.04 + skill * 0.1;
  const two = 0.18 + skill * 0.15;
  if (r < miss) return 0;
  if (r < miss + three) return 3;
  if (r < miss + three + two) return 2;
  return 1;
}

export function ranking(race: Race): Racer[] {
  return [...race.racers].sort((a, b) => b.score - a.score || a.id - b.id);
}

/* ------------------------------------------------------------ bedste tid */

const BEST_KEY = 'galoppen.bestTimeMs';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadBest(store: KeyValueStore | null): number | null {
  try {
    const v = store?.getItem(BEST_KEY);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Gem tiden hvis den er bedre. Returnerer true ved ny rekord. */
export function saveBest(store: KeyValueStore | null, ms: number): boolean {
  const prev = loadBest(store);
  if (prev != null && prev <= ms) return false;
  try {
    store?.setItem(BEST_KEY, String(Math.round(ms)));
  } catch {
    /* privat vindue o.l. */
  }
  return true;
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
