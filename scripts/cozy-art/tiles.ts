/**
 * Floors, walls and carpets.
 *
 * Floors and carpets are luminance only: the app colorizes them at runtime
 * (floors from a 50% gray, carpets by splitting their darkest and brightest
 * pixel into a main and an accent color), so the look comes from pattern.
 * Walls are authored warm (cream wallpaper over a wood baseboard) but are also
 * colorized when a layout gives them a color, so the contrast steps matter more than the hue.
 */

import { Canvas, toHex } from './canvas';

function gray(v: number): string {
  return toHex(v, v, v);
}

/** Deterministic per-pixel noise in 0..1, no randomness involved. */
function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------
// Floors: 16x16
// ---------------------------------------------------------------------------

type FloorFn = (x: number, y: number) => number;

/** Interior tone with a faint speckle, so large tiles do not read as flat gray. */
function speckled(base: number, x: number, y: number, seed: number): number {
  const n = noise(x, y, seed);
  if (n > 0.93) {
    return base + 9;
  }
  if (n < 0.06) {
    return base - 9;
  }
  return base;
}

/** Horizontal wood boards `h` rows tall with staggered end joints and a little grain. */
function boards(h: number, groove: number, base: number, joint: number, seed: number): FloorFn {
  return (x, y) => {
    const row = Math.floor(y / h);
    const ly = y % h;
    if (ly === 0) {
      return groove;
    }
    const jx = (row * 5 + 3) % 16;
    if (x === jx) {
      return groove;
    }
    const n = noise(x + row * 7, y, seed);
    if (ly === 1) {
      return base + 6;
    }
    if (n > 0.9) {
      return base + joint;
    }
    if (n < 0.12) {
      return base - joint;
    }
    return base;
  };
}

function gridTile(size: number, grout: number, base: number, seed: number): FloorFn {
  return (x, y) => (x % size === 0 || y % size === 0 ? grout : speckled(base, x, y, seed));
}

function checker(size: number, light: number, dark: number): FloorFn {
  return (x, y) => {
    const odd = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 1;
    const lx = x % size;
    const ly = y % size;
    const v = odd ? dark : light;
    // a one-pixel bevel highlight on the light squares
    return !odd && (lx === 0 || ly === 0) ? v - 6 : v;
  };
}

const FLOORS: FloorFn[] = [
  // floor_0: wood planks (the default floor)
  boards(4, 0x91, 0xa9, 8, 1),
  // floor_1: cream tile, light grout
  gridTile(16, 0xe4, 0xa7, 2),
  // floor_2: tile, dark grout
  gridTile(16, 0x6a, 0xa7, 3),
  // floor_3: four tiles per square, dark grout
  gridTile(8, 0x6a, 0xa7, 4),
  // floor_4: four tiles per square, light grout
  gridTile(8, 0xe4, 0xa7, 5),
  // floor_5: boards with light joints
  (x, y) => {
    const row = Math.floor(y / 4);
    const ly = y % 4;
    const jx = (row % 2 === 0 ? 7 : 15) % 16;
    if (ly === 0 || (x === jx && ly !== 0)) {
      return 0xe0;
    }
    const n = noise(x + row * 3, y, 6);
    return n > 0.88 ? 0xb0 : n < 0.1 ? 0x9e : 0xa7;
  },
  // floor_6: boards with dark joints
  (x, y) => {
    const row = Math.floor(y / 4);
    const ly = y % 4;
    const jx = (row % 2 === 0 ? 7 : 15) % 16;
    if (ly === 0 || x === jx) {
      return 0x6a;
    }
    const n = noise(x + row * 3, y, 7);
    return n > 0.88 ? 0xb0 : n < 0.1 ? 0x9e : 0xa7;
  },
  // floor_7: checker, 4 px squares
  checker(4, 0xe6, 0x3c),
  // floor_8: checker, 8 px squares
  checker(8, 0xe6, 0x3c),
];

export function buildFloors(): Record<string, Canvas> {
  const out: Record<string, Canvas> = {};
  FLOORS.forEach((fn, i) => {
    const c = new Canvas(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        c.set(x, y, gray(Math.max(0, Math.min(255, fn(x, y)))));
      }
    }
    out[`floors/floor_${i}.png`] = c;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Walls: 4x4 grid of 16x32 pieces, piece N at col N % 4, row floor(N / 4).
// Bitmask: N=1, E=2, S=4, W=8 (a set bit means the neighbor is also a wall).
// ---------------------------------------------------------------------------

type WallRole = 'a' | 'b' | 'c';

/**
 * Which part of the wall a pixel belongs to.
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

const WALL = {
  outline: '#4a3020',
  capLight: '#f3e4c4',
  cap: '#e6cd9f',
  paper: '#f1dfbd',
  paperStripe: '#e9d2a8',
  paperDot: '#d9b988',
  skirtTop: '#c98f5a',
  skirt: '#b77b4b',
  skirtDark: '#9b6338',
  shadow: '#d9c196',
};

function wallPixel(role: WallRole, y: number, x: number, mask: number): string {
  if (role === 'a') {
    return WALL.outline;
  }
  if (role === 'b') {
    return y === 1 ? WALL.capLight : y === 7 && (mask & 4) === 0 ? WALL.shadow : WALL.cap;
  }
  // face: wallpaper with soft stripes and tiny flowers, wood baseboard on the last rows
  if (y >= 25 && y <= 29) {
    return y === 25 ? WALL.skirtTop : y === 29 ? WALL.skirtDark : WALL.skirt;
  }
  if (y === 24) {
    return WALL.shadow;
  }
  if (x % 8 >= 6) {
    return WALL.paperStripe;
  }
  if (x % 8 === 3 && y % 8 === 4) {
    return WALL.paperDot;
  }
  return WALL.paper;
}

export function buildWalls(): Record<string, Canvas> {
  const c = new Canvas(64, 128);
  for (let mask = 0; mask < 16; mask++) {
    const ox = (mask % 4) * 16;
    const oy = Math.floor(mask / 4) * 32;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 16; x++) {
        c.set(ox + x, oy + y, wallPixel(wallRole(mask, x, y), y, x, mask));
      }
    }
  }
  return { 'walls/wall_0.png': c };
}

// ---------------------------------------------------------------------------
// Carpets: 4x4 marching-squares pieces of 16x16, case N at col N % 4, row floor(N / 4).
// Case bits: NW=1, NE=2, SE=4, SW=8 (which tiles around the junction hold carpet).
// Exactly two gray values per variant: the app maps darkest -> main color, brightest -> accent.
// ---------------------------------------------------------------------------

const MAIN = 0x64;
const ACCENT = 0xc4;

/** A tile's carpet reaches `reach` px into the junction piece (8 = exactly the tile, more = overhang). */
function covered(msCase: number, reach: number, x: number, y: number): boolean {
  // Outside the piece, assume the carpet continues (neighboring pieces carry on the same shape).
  const cx = Math.max(0, Math.min(15, x));
  const cy = Math.max(0, Math.min(15, y));
  const lo = 16 - reach;
  return (
    ((msCase & 1) !== 0 && cx < reach && cy < reach) ||
    ((msCase & 2) !== 0 && cx >= lo && cy < reach) ||
    ((msCase & 4) !== 0 && cx >= lo && cy >= lo) ||
    ((msCase & 8) !== 0 && cx < reach && cy >= lo)
  );
}

/** Border line: a covered pixel with carpet right next to it and none two steps away. */
function isBorder(msCase: number, reach: number, x: number, y: number): boolean {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  return dirs.some(
    ([dx, dy]) =>
      covered(msCase, reach, x + dx, y + dy) && !covered(msCase, reach, x + 2 * dx, y + 2 * dy),
  );
}

/** Per variant: how far the rug overhangs its tiles, and the interior pattern. */
const CARPETS: Array<{ reach: number; pattern: (x: number, y: number) => boolean }> = [
  // 0: plain weave, one accent thread crossing every 4 px
  { reach: 12, pattern: (x, y) => x % 4 === 0 && y % 4 === 0 },
  // 1: argyle diamonds
  { reach: 10, pattern: (x, y) => Math.abs((x % 8) - 4) + Math.abs((y % 8) - 4) === 3 },
  // 2: polka dots
  { reach: 8, pattern: (x, y) => (x % 8 === 3 || x % 8 === 4) && (y % 8 === 3 || y % 8 === 4) },
];

export function buildCarpets(): Record<string, Canvas> {
  const out: Record<string, Canvas> = {};
  CARPETS.forEach(({ reach, pattern }, v) => {
    const c = new Canvas(64, 64);
    for (let msCase = 1; msCase < 16; msCase++) {
      const ox = (msCase % 4) * 16;
      const oy = Math.floor(msCase / 4) * 16;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (!covered(msCase, reach, x, y)) {
            continue;
          }
          const accent = isBorder(msCase, reach, x, y) || pattern(x, y);
          c.set(ox + x, oy + y, gray(accent ? ACCENT : MAIN));
        }
      }
    }
    out[`carpets/carpet_${v}.png`] = c;
  });
  return out;
}
