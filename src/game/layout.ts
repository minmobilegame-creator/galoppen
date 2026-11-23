/**
 * Bordets geometri. Alle mål er i meter i bordets eget 2D-koordinatsystem,
 * aflæst fra GalopPlayfieldBlender.blend (1 m ≈ 100 px i den oprindelige spec).
 *
 *   x: venstre (-) til højre (+), set fra spillerens ende
 *   y: fra spillerens ende (-4) op mod pointfeltet (+4)
 */

export type HoleColor = 'yellow' | 'blue' | 'red';

export interface Hole {
  id: string; // samme navn som objektet i Blender, fx "Hole_Yellow_01"
  color: HoleColor;
  points: 1 | 2 | 3;
  x: number;
  y: number;
}

export const FIELD = { xMin: -1.5, xMax: 1.5, yMin: -4, yMax: 4 } as const;

/** Grænsen mellem den lyse nedre bane og den grønne bane. */
export const LAUNCH_LINE_Y = -2.8;

/** Hånden virker i nedre bane og en tredjedel op ad resten af banen. */
export const HAND_LIMIT_Y = LAUNCH_LINE_Y + (FIELD.yMax - LAUNCH_LINE_Y) / 3;

export const BALL_R = 0.15;
export const HOLE_R = 0.16;
/** Gummilisten (ca. 5 px) ligger fra HOLE_R ud til RIM_R. */
export const RIM_R = 0.205;

/** Det mørkegrønne V: spids nederst, siderne går ud til bordkanten. */
export const V_SHAPE = { apex: { x: 0, y: 1.35 }, left: { x: -1.5, y: 3.0 }, right: { x: 1.5, y: 3.0 } } as const;

/** Startpladserne for de to kugler i nedre bane. */
export const BALL_HOMES = [
  { x: -0.55, y: -3.4 },
  { x: 0.55, y: -3.4 },
] as const;

const POINTS: Record<HoleColor, 1 | 2 | 3> = { yellow: 1, blue: 2, red: 3 };

function hole(color: HoleColor, n: number, x: number, y: number): Hole {
  const name = color[0].toUpperCase() + color.slice(1);
  return { id: `Hole_${name}_${String(n).padStart(2, '0')}`, color, points: POINTS[color], x, y };
}

/** To indlejrede V'er (gult yderst, blåt indenfor) og to røde i midten. */
export const HOLES: readonly Hole[] = [
  hole('yellow', 7, 0, 1.85),
  hole('yellow', 5, -0.32, 2.21),
  hole('yellow', 6, 0.32, 2.21),
  hole('yellow', 3, -0.64, 2.57),
  hole('yellow', 4, 0.64, 2.57),
  hole('yellow', 1, -0.96, 2.93),
  hole('yellow', 2, 0.96, 2.93),
  hole('blue', 7, 0, 2.57),
  hole('blue', 5, -0.32, 2.93),
  hole('blue', 6, 0.32, 2.93),
  hole('blue', 3, -0.64, 3.29),
  hole('blue', 4, 0.64, 3.29),
  hole('blue', 1, -0.96, 3.65),
  hole('blue', 2, 0.96, 3.65),
  hole('red', 2, 0, 3.29),
  hole('red', 1, 0, 3.65),
];
