/**
 * Floors, walls and carpets at density 2 (2 art px per world px).
 *
 * Floors and carpets are luminance only: the app colorizes them at runtime
 * (floors from a 50% gray, carpets by splitting their darkest and brightest
 * pixel into a main and an accent color), so the look comes from pattern.
 * Walls are authored warm (cream wallpaper over a wood baseboard) but are also
 * colorized when a layout gives them a color, so the contrast steps matter more than the hue.
 */

import { Canvas, toHex } from './canvas';
import { mix, noise } from './hd';

function gray(v: number): string {
  return toHex(v, v, v);
}

// ---------------------------------------------------------------------------
// Floors: 32x32 (one world tile)
// ---------------------------------------------------------------------------

const FLOOR = 32;

type FloorFn = (x: number, y: number) => number;

/** Interior tone with a faint speckle, so large tiles do not read as flat gray. */
function speckled(base: number, x: number, y: number, seed: number): number {
  const n = noise(x, y, seed);
  if (n > 0.95) {
    return base + 8;
  }
  if (n < 0.04) {
    return base - 8;
  }
  return base;
}

/**
 * Oak boards 8 art px tall with staggered end joints and long grain streaks in three tones.
 * The default floor stays soft: every tone sits within 16 luminance levels.
 */
function oak(x: number, y: number): number {
  const GROOVE = 0x9d;
  const BASE = 0xa9;
  const row = Math.floor(y / 8);
  const ly = y % 8;
  if (ly === 0) {
    return GROOVE;
  }
  const jx = (row * 13 + 5) % FLOOR;
  if (x === jx) {
    return GROOVE;
  }
  if (ly === 1 || x === (jx + 1) % FLOOR) {
    return BASE + 4;
  }
  if (ly === 7) {
    return BASE - 4;
  }
  // streaks run along the board: segment by x so they read as grain, not dots
  const seg = Math.floor(((x - jx + FLOOR) % FLOOR) / 6);
  const n = noise(seg + row * 11, ly, 3);
  if (n > 0.8) {
    return BASE - 5;
  }
  if (n < 0.12) {
    return BASE + 3;
  }
  return BASE;
}

/** Square tiles `size` px with a 1 px grout line and a soft bevel inside each tile. */
function gridTile(size: number, grout: number, base: number, seed: number): FloorFn {
  return (x, y) => {
    const lx = x % size;
    const ly = y % size;
    if (lx === 0 || ly === 0) {
      return grout;
    }
    if (lx === 1 || ly === 1) {
      return base + 7;
    }
    if (lx === size - 1 || ly === size - 1) {
      return base - 7;
    }
    return speckled(base, x, y, seed);
  };
}

/** Boards 8 px tall with joints at alternating columns, `joint` as the line tone. */
function jointBoards(joint: number, seed: number): FloorFn {
  return (x, y) => {
    const row = Math.floor(y / 8);
    const ly = y % 8;
    const jx = row % 2 === 0 ? 15 : 31;
    if (ly === 0 || x === jx) {
      return joint;
    }
    if (ly === 1) {
      return 0xb0;
    }
    if (ly === 7) {
      return 0x9f;
    }
    const seg = Math.floor(x / 5);
    const n = noise(seg + row * 7, ly, seed);
    return n > 0.84 ? 0xb0 : n < 0.12 ? 0x9e : 0xa7;
  };
}

function checker(size: number, light: number, dark: number): FloorFn {
  return (x, y) => {
    const odd = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 1;
    const lx = x % size;
    const ly = y % size;
    if (odd) {
      // dark squares: a faint lit edge on the top-left
      return lx === 0 || ly === 0 ? dark + 10 : dark;
    }
    // light squares: a bevel highlight top-left, a soft shade bottom-right
    if (lx === 0 || ly === 0) {
      return light - 8;
    }
    if (lx === size - 1 || ly === size - 1) {
      return light - 14;
    }
    return light;
  };
}

const FLOORS: FloorFn[] = [
  // floor_0: oak planks (the default floor)
  oak,
  // floor_1: cream tile, light grout
  gridTile(32, 0xe4, 0xa7, 2),
  // floor_2: tile, dark grout
  gridTile(32, 0x6a, 0xa7, 3),
  // floor_3: four tiles per square, dark grout
  gridTile(16, 0x6a, 0xa7, 4),
  // floor_4: four tiles per square, light grout
  gridTile(16, 0xe4, 0xa7, 5),
  // floor_5: boards with light joints
  jointBoards(0xe0, 6),
  // floor_6: boards with dark joints
  jointBoards(0x6a, 7),
  // floor_7: checker, 8 px squares
  checker(8, 0xe6, 0x3c),
  // floor_8: checker, 16 px squares
  checker(16, 0xe6, 0x3c),
];

export function buildFloors(): Record<string, Canvas> {
  const out: Record<string, Canvas> = {};
  FLOORS.forEach((fn, i) => {
    const c = new Canvas(FLOOR, FLOOR);
    for (let y = 0; y < FLOOR; y++) {
      for (let x = 0; x < FLOOR; x++) {
        c.set(x, y, gray(Math.max(0, Math.min(255, fn(x, y)))));
      }
    }
    out[`floors/floor_${i}.png`] = c;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Walls: 4x4 grid of 32x64 pieces, piece N at col N % 4, row floor(N / 4).
// Bitmask: N=1, E=2, S=4, W=8 (a set bit means the neighbor is also a wall).
// ---------------------------------------------------------------------------

const PIECE_W = 32;
const PIECE_H = 64;

type WallRole = 'a' | 'b' | 'c';

/**
 * Which part of the wall a world pixel (16x32 grid) belongs to.
 *   a: outline, b: top of the wall (cap), c: wallpapered face
 * Rows 0..7 are the cap, rows 8..30 the face (or more cap when a wall continues
 * south), row 31 the bottom outline.
 */
function wallRole(mask: number, x: number, y: number): WallRole {
  const n = (mask & 1) !== 0;
  const e = (mask & 2) !== 0;
  const s = (mask & 4) !== 0;
  const w = (mask & 8) !== 0;
  const left = x === 0;
  const right = x === 15;

  // Piece 14 (walls to E, S, W) keeps a short stretch of face low in the piece.
  if (mask === 14) {
    if (y === 0) {
      return 'a';
    }
    if (y < 8) {
      return 'b';
    }
    if (y < 16) {
      return left || right ? 'a' : 'b';
    }
    if (y < 30) {
      return 'c';
    }
    return left || right ? 'a' : 'c';
  }

  if (y === 0) {
    if (!n) {
      return 'a';
    }
    return left || right ? 'a' : 'b';
  }
  if (y < 8) {
    return (left && !w) || (right && !e) ? 'a' : 'b';
  }
  if (s) {
    return left || right ? 'a' : 'b';
  }
  if (y === 31) {
    return 'a';
  }
  if ((left && !w) || (right && !e)) {
    return 'a';
  }
  return 'c';
}

/** The art rows (inside a 64-row piece) that carry the baseboard: the six above the bottom outline. */
const WALL_BASEBOARD_ROWS = { first: 56, last: 61 } as const;

const WALL = {
  outline: '#4a3020',
  capLight: '#f8ecd2',
  capHi: '#f3e4c4',
  cap: '#e6cd9f',
  capLow: '#dcc08e',
  paper: '#f1dfbd',
  paperStripe: '#ead4ab',
  paperStripeHi: '#f6e8cc',
  paperDot: '#d9b988',
  leaf: '#c9b07c',
  railTop: '#e2c896',
  rail: '#d9c196',
  skirtTop: '#d9a06a',
  skirt: '#b77b4b',
  skirtLow: '#9c6538',
  /** The wood line where the wall meets the floor. Walls without a layout color show it raw. */
  baseboard: '#6b4128',
  baseLow: '#56331f',
  shadow: '#d9c196',
};

/** Color of an art pixel in its role: the legacy role grid picked the part, art coords pick the detail. */
function wallFill(role: 'b' | 'c', ax: number, ay: number, mask: number): string {
  if (role === 'b') {
    if (ay === 2) {
      return WALL.capLight;
    }
    if (ay === 3) {
      return WALL.capHi;
    }
    if ((mask & 4) === 0 && ay === 15) {
      return WALL.shadow;
    }
    if ((mask & 4) === 0 && ay === 14) {
      return WALL.capLow;
    }
    return WALL.cap;
  }
  if (ay >= WALL_BASEBOARD_ROWS.first && ay <= WALL_BASEBOARD_ROWS.last) {
    return WALL.baseboard;
  }
  if (ay >= 50) {
    return ay === 50 ? WALL.skirtTop : ay === 55 ? WALL.skirtLow : WALL.skirt;
  }
  if (ay === 48) {
    return WALL.railTop;
  }
  if (ay === 49) {
    return WALL.rail;
  }
  if (ay === 16) {
    // the face starts in the cap's shade
    return WALL.paperStripe;
  }
  // wallpaper: a narrow stripe pair every 16 px and a small dot between them, staggered
  const sx = ax % 16;
  if (sx === 12) {
    return WALL.paperStripeHi;
  }
  if (sx === 13 || sx === 14) {
    return WALL.paperStripe;
  }
  const fy = (ay + (Math.floor(ax / 16) % 2) * 8) % 16;
  if ((sx === 5 || sx === 6) && (fy === 7 || fy === 8)) {
    return sx === 6 && fy === 8 ? WALL.leaf : WALL.paperDot;
  }
  return WALL.paper;
}

export function buildWalls(): Record<string, Canvas> {
  const c = new Canvas(PIECE_W * 4, PIECE_H * 4);
  for (let mask = 0; mask < 16; mask++) {
    const ox = (mask % 4) * PIECE_W;
    const oy = Math.floor(mask / 4) * PIECE_H;
    const roleAt = (ax: number, ay: number): WallRole | null =>
      ax < 0 || ay < 0 || ax >= PIECE_W || ay >= PIECE_H
        ? null
        : wallRole(mask, Math.floor(ax / 2), Math.floor(ay / 2));
    for (let ay = 0; ay < PIECE_H; ay++) {
      for (let ax = 0; ax < PIECE_W; ax++) {
        const role = roleAt(ax, ay);
        if (role === 'a') {
          // A 2 px outline: the half touching the wall body is a bevel, a mix of the
          // outline and that body, so the edge reads as one crisp dark line.
          let inner: string | null = null;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const r = roleAt(ax + dx, ay + dy);
            if (r === 'b' || r === 'c') {
              inner = mix(WALL.outline, wallFill(r, ax + dx, ay + dy, mask), 0.45);
              break;
            }
          }
          c.set(ox + ax, oy + ay, inner ?? WALL.outline);
        } else if (role !== null) {
          c.set(ox + ax, oy + ay, wallFill(role, ax, ay, mask));
        }
      }
    }
  }
  return { 'walls/wall_0.png': c };
}

// ---------------------------------------------------------------------------
// Carpets: 4x4 marching-squares pieces of 32x32, case N at col N % 4, row floor(N / 4).
// Case bits: NW=1, NE=2, SE=4, SW=8 (which tiles around the junction hold carpet).
// Exactly two gray values per variant: the app maps darkest -> main color, brightest -> accent.
// ---------------------------------------------------------------------------

const PIECE = 32;
const MAIN = 0x64;
const ACCENT = 0xc4;

/** A tile's carpet reaches `reach` px into the junction piece (16 = exactly the tile, more = overhang). */
function covered(msCase: number, reach: number, x: number, y: number): boolean {
  // Outside the piece, assume the carpet continues (neighboring pieces carry on the same shape).
  const cx = Math.max(0, Math.min(PIECE - 1, x));
  const cy = Math.max(0, Math.min(PIECE - 1, y));
  const lo = PIECE - reach;
  return (
    ((msCase & 1) !== 0 && cx < reach && cy < reach) ||
    ((msCase & 2) !== 0 && cx >= lo && cy < reach) ||
    ((msCase & 4) !== 0 && cx >= lo && cy >= lo) ||
    ((msCase & 8) !== 0 && cx < reach && cy >= lo)
  );
}

/** Steps from a covered pixel to the nearest uncovered one along `axes` (1 = on the rim), capped at max + 1. */
function edgeDistance(
  msCase: number,
  reach: number,
  x: number,
  y: number,
  max: number,
  axes: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
): number {
  let best = max + 1;
  for (const [dx, dy] of axes) {
    for (let k = 1; k < best; k++) {
      if (!covered(msCase, reach, x + dx * k, y + dy * k)) {
        best = k;
        break;
      }
    }
  }
  return best;
}

/** Distance from the rim of the double border line (2 px) and the plain rug's thin inner line. */
const RUG_BORDER = [3, 4];
const RUG_INNER_LINE_DISTANCE = 9;

/** Per variant: how far the rug overhangs its tiles, and the interior pattern (piece coords, period 32). */
const CARPETS: Array<{
  reach: number;
  plain: boolean;
  pattern: (x: number, y: number) => boolean;
}> = [
  // 0: plain rug: double border, a thin inner line and tassels on the short edges
  { reach: 24, plain: true, pattern: () => false },
  // 1: argyle diamonds
  {
    reach: 20,
    plain: false,
    pattern: (x, y) => Math.abs((x % 16) - 8) + Math.abs((y % 16) - 8) === 6,
  },
  // 2: polka dots, 4 px rounded
  {
    reach: 16,
    plain: false,
    pattern: (x, y) => {
      const dx = (x % 16) - 7.5;
      const dy = (y % 16) - 7.5;
      return dx * dx + dy * dy <= 4.6;
    },
  },
];

export function buildCarpets(): Record<string, Canvas> {
  const out: Record<string, Canvas> = {};
  CARPETS.forEach(({ reach, plain, pattern }, v) => {
    const c = new Canvas(PIECE * 4, PIECE * 4);
    for (let msCase = 1; msCase < 16; msCase++) {
      const ox = (msCase % 4) * PIECE;
      const oy = Math.floor(msCase / 4) * PIECE;
      for (let y = 0; y < PIECE; y++) {
        for (let x = 0; x < PIECE; x++) {
          if (!covered(msCase, reach, x, y)) {
            continue;
          }
          const d = edgeDistance(msCase, reach, x, y, RUG_INNER_LINE_DISTANCE);
          let accent = RUG_BORDER.includes(d) || (d > RUG_BORDER[1] + 1 && pattern(x, y));
          if (plain) {
            accent = RUG_BORDER.includes(d) || d === RUG_INNER_LINE_DISTANCE;
            // tassels: 2 px ticks on the north and south rims, joined to the border line
            const vd = edgeDistance(msCase, reach, x, y, 4, [
              [0, 1],
              [0, -1],
            ]);
            const hd = edgeDistance(msCase, reach, x, y, 6, [
              [1, 0],
              [-1, 0],
            ]);
            if (vd <= 2 && hd > 5 && x % 4 === 1) {
              accent = true;
            }
          }
          c.set(ox + x, oy + y, gray(accent ? ACCENT : MAIN));
        }
      }
    }
    out[`carpets/carpet_${v}.png`] = c;
  });
  return out;
}
