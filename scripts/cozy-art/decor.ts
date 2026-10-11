/** Cozy plants, small props, sofas, shelves and wall decor at density 2. Same rules as furniture.ts. */

import type { Canvas } from './canvas';
import { shade } from './canvas';
import type { SpriteSet } from './furniture';
import { Art, noise, pillow, WOOD, woodGrain } from './hd';

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

const LEAF = { v: '#24572f', g: '#3f8f4a', G: '#5fb85a', l: '#8fd67a', line: '#173a20' };

/**
 * A leafy crown built from overlapping clusters, back to front. Each cluster is a dark
 * ball with lighter balls offset toward the top-left light.
 */
function crown(a: Art, clusters: Array<[number, number, number]>, tones = LEAF): void {
  const sorted = [...clusters].sort((p, q) => p[1] - q[1]);
  for (const [cx, cy, r] of sorted) {
    a.oval(cx, cy, r, r * 0.9, tones.v);
    a.oval(cx - 0.6, cy - 0.8, r - 1, (r - 1) * 0.9, tones.g);
    if (r >= 4) {
      a.oval(cx - 1.2, cy - 1.6, r - 2.4, (r - 2.4) * 0.9, tones.G);
    }
    if (r >= 5) {
      a.oval(cx - 1.8, cy - 2.4, Math.max(1.2, r - 4.2), Math.max(1, (r - 4.2) * 0.8), tones.l);
    }
    // a leaf vein: one dark tick on the shaded side
    a.px(Math.round(cx + r * 0.3), Math.round(cy + r * 0.25), tones.v);
  }
}

/** Clusters filling a dome around (cx, cy), deterministic per seed. */
function dome(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  seed: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * (i + 0.5 * noise(i, seed, 41))) / n;
    const rad = 0.45 + 0.5 * noise(i, seed, 42);
    const x = cx + Math.cos(ang) * (rx - 5) * rad;
    const y = cy + Math.sin(ang) * (ry - 5) * rad;
    out.push([x, y, 4 + Math.floor(noise(i, seed, 43) * 3)]);
  }
  // the top and the front-most balls
  out.push([cx, cy - ry * 0.45, 6]);
  out.push([cx - rx * 0.4, cy + ry * 0.2, 6]);
  out.push([cx + rx * 0.4, cy + ry * 0.25, 6]);
  out.push([cx, cy + ry * 0.4, 6]);
  return out;
}

const TERRACOTTA = {
  rim: '#e08a5a',
  body: '#c0643a',
  dark: '#9a4a28',
  line: '#5a2a14',
  lit: '#e9a074',
};
const CREAMPOT = {
  rim: '#fff4dc',
  body: '#f1dfbd',
  dark: '#d4bb90',
  line: '#6b5030',
  lit: '#fffaf0',
};
const BROWNPOT = {
  rim: '#8b7a54',
  body: '#725a3f',
  dark: '#513b29',
  line: '#2a1a10',
  lit: '#9a8862',
};

/** A tapered pot: a lip, a body narrowing to the foot, lit left, shaded right, soil on top. */
function pot(
  a: Art,
  cx: number,
  top: number,
  lipW: number,
  footW: number,
  h: number,
  c: typeof TERRACOTTA,
  soil = true,
): void {
  const lipH = Math.max(3, Math.round(h * 0.22));
  // lip
  a.rect(cx - lipW / 2, top, lipW, lipH, c.line);
  a.rect(cx - lipW / 2 + 1, top + 1, lipW - 2, lipH - 2, c.rim);
  a.rect(cx - lipW / 2 + 1, top + lipH - 2, lipW - 2, 1, c.body);
  if (soil) {
    a.rect(cx - lipW / 2 + 2, top + 1, lipW - 4, 1, '#3a2416');
  }
  // body
  const bodyTop = top + lipH;
  const bodyH = h - lipH;
  const topW = lipW - 4;
  for (let y = 0; y < bodyH; y++) {
    const w = Math.round(topW + ((footW - topW) * y) / Math.max(1, bodyH - 1));
    const x0 = Math.round(cx - w / 2);
    a.rect(x0, bodyTop + y, w, 1, c.line);
    if (y < bodyH - 1) {
      a.rect(x0 + 1, bodyTop + y, w - 2, 1, c.body);
      a.rect(x0 + 2, bodyTop + y, 2, 1, c.lit);
      a.rect(x0 + w - 4, bodyTop + y, 3, 1, c.dark);
    }
  }
  // shade right under the lip
  a.rect(Math.round(cx - topW / 2) + 1, bodyTop, topW - 2, 1, c.dark);
}

function plant(variant: 1 | 2): Canvas {
  const a = new Art(32, 64);
  // stems from the soil into the crown
  a.line(15, 41, 13, 30, '#4f7a3a');
  a.line(17, 41, 19, 31, '#3f6a2e');
  crown(a, dome(16, 20, 14, 16, 13, variant));
  a.outline(0.5, 0.4, [0, 0, 32, 40]);
  if (variant === 2) {
    // pink blooms with a yellow heart
    for (const [x, y] of [
      [7, 9],
      [22, 12],
      [12, 19],
      [24, 23],
      [8, 25],
      [17, 6],
    ]) {
      a.rect(x - 1, y, 3, 1, '#ff8fab');
      a.rect(x, y - 1, 1, 3, '#ff8fab');
      a.px(x - 1, y - 1, '#ffb3c6');
      a.px(x, y, '#ffd166');
      a.px(x + 1, y + 1, '#d65d7f');
    }
    pot(a, 16, 40, 26, 18, 22, CREAMPOT);
    a.rect(9, 50, 14, 2, '#6b9ad6');
    a.rect(9, 50, 14, 1, '#8fb8e6');
  } else {
    pot(a, 16, 40, 26, 18, 22, TERRACOTTA);
  }
  return a.c;
}

function largePlant(): Canvas {
  const a = new Art(64, 96);
  for (const [x0, x1] of [
    [30, 22],
    [34, 44],
    [32, 32],
  ]) {
    a.line(x0, 68, x1, 40, '#3f6a2e');
  }
  crown(a, [
    ...dome(32, 30, 18, 18, 10, 7),
    ...dome(14, 44, 14, 16, 9, 8),
    ...dome(50, 44, 14, 16, 9, 9),
  ]);
  a.outline(0.5, 0.4, [0, 0, 64, 66]);
  pot(a, 32, 66, 48, 34, 28, TERRACOTTA);
  // a band around the pot
  a.rect(17, 80, 30, 1, '#9a4a28');
  a.rect(17, 81, 30, 1, '#e08a5a');
  return a.c;
}

/** A saguaro in a clay pot, with ribs, spines and a bloom on top. */
function cactus(): Canvas {
  const a = new Art(32, 64);
  const body = '#5f8f4a';
  const dark = '#3f6a3a';
  const lit = '#89b061';
  const column = (x: number, y: number, w: number, h: number): void => {
    pillow(a, x, y, w, h, body, {
      light: lit,
      dark,
      line: '#24402a',
      round: Math.floor(w / 2) - 1,
    });
    // ribs
    for (let rx = x + 3; rx < x + w - 2; rx += 3) {
      a.rect(rx, y + 3, 1, h - 6, dark);
    }
    // spines
    for (let sy = y + 4; sy < y + h - 3; sy += 4) {
      a.px(x + 1, sy, '#e8f0c0');
      a.px(x + w - 2, sy + 2, '#e8f0c0');
    }
  };
  // arms: an elbow piece then the upright
  column(3, 16, 8, 16);
  pillow(a, 6, 28, 10, 6, body, { light: lit, dark, line: '#24402a', round: 2 });
  column(21, 10, 8, 14);
  pillow(a, 16, 20, 10, 6, body, { light: lit, dark, line: '#24402a', round: 2 });
  column(11, 4, 10, 42);
  // bloom
  a.oval(16, 4, 3, 2.2, '#ff8fab');
  a.px(16, 3, '#ffd166');
  a.px(14, 3, '#ffb3c6');
  pot(a, 16, 44, 24, 18, 18, BROWNPOT);
  return a.c;
}

/** A trailing pothos in a small hanging pot, 32x64 (a wall item). */
function hangingPlant(): Canvas {
  const a = new Art(32, 64);
  // hanger cords
  a.line(16, 0, 9, 6, '#8b7a54');
  a.line(16, 0, 23, 6, '#8b7a54');
  a.px(16, 0, '#513b29');
  // vines: chains of leaves swaying down, back strands first
  const strands: Array<[number, number, number, number]> = [
    [10, 12, 52, 1],
    [22, 12, 46, 2],
    [15, 14, 62, 3],
    [7, 12, 36, 4],
    [25, 12, 30, 5],
  ];
  for (const [sx, sy, ey, seed] of strands) {
    for (let y = sy; y <= ey; y++) {
      const x = sx + Math.round(2 * Math.sin((y + seed * 5) / 6));
      a.px(x, y, '#3f6a2e');
    }
    for (let y = sy + 3; y <= ey; y += 4) {
      const x = sx + Math.round(2 * Math.sin((y + seed * 5) / 6));
      const side = ((y / 4) | 0) % 2 === 0 ? -1 : 1;
      const lx = x + side * 2;
      a.oval(lx + 0.5, y + 0.5, 2.4, 1.8, LEAF.g);
      a.px(lx - (side > 0 ? 1 : 0), y, LEAF.l);
      a.px(lx + side, y + 1, LEAF.v);
    }
  }
  a.outline(0.55, 0.4);
  pot(a, 16, 5, 18, 12, 10, BROWNPOT);
  // leaves spilling over the rim
  crown(a, [
    [10, 7, 4],
    [21, 7, 4],
    [15, 5, 4],
  ]);
  return a.c;
}

function emptyPot(): Canvas {
  const a = new Art(32, 32);
  pot(a, 16, 6, 24, 16, 24, BROWNPOT);
  // the soil shows inside the lip
  a.rect(7, 7, 18, 3, '#3a2416');
  a.rect(8, 7, 16, 1, '#2a180c');
  return a.c;
}

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------

/** A slatted wood wastebasket with a crumpled note on top. */
function bin(): Canvas {
  const a = new Art(32, 32);
  const top = 6;
  const h = 24;
  for (let y = 0; y < h; y++) {
    const w = Math.round(20 - (4 * y) / (h - 1));
    const x0 = Math.round(16 - w / 2);
    a.rect(x0, top + y, w, 1, WOOD.edge);
    if (y < h - 1) {
      for (let x = x0 + 1; x < x0 + w - 1; x++) {
        const k = (x - x0) % 4;
        a.px(x, top + y, k === 0 ? WOOD.X : k === 1 ? WOOD.L : x > 16 ? WOOD.D : WOOD.M);
      }
    }
  }
  // paper ball peeking out
  a.oval(17, 6, 4, 3, '#fff4dc');
  a.px(16, 5, '#e6d6b8');
  a.px(18, 6, '#e6d6b8');
  a.px(15, 4, '#ffffff');
  // rim
  a.rect(5, 6, 22, 3, WOOD.edge);
  a.rect(6, 7, 20, 1, WOOD.L);
  // bands
  a.rect(7, 14, 18, 1, WOOD.X);
  a.rect(8, 24, 16, 1, WOOD.X);
  return a.c;
}

/** A mug of coffee with steam, sitting at the top right of its tile. */
function coffee(): Canvas {
  const a = new Art(32, 32);
  // steam
  for (const [x, y, c] of [
    [21, 0, '#ffffff66'],
    [20, 1, '#ffffff88'],
    [21, 2, '#ffffff66'],
    [25, 1, '#ffffff55'],
    [24, 2, '#ffffff77'],
  ] as Array<[number, number, string]>) {
    a.px(x, y, c);
  }
  // handle
  a.rect(27, 6, 4, 6, '#5a4a3a');
  a.rect(28, 7, 2, 4, '#e9e0d0');
  a.clear(28, 8);
  a.clear(28, 9);
  // body
  pillow(a, 17, 4, 12, 10, '#f6efe2', {
    light: '#ffffff',
    dark: '#d8ccb8',
    line: '#5a4a3a',
    round: 1,
  });
  // coffee surface
  a.rect(18, 5, 10, 2, '#8a4b2a');
  a.rect(19, 5, 4, 1, '#a8643a');
  // a red stripe
  a.rect(18, 10, 10, 1, '#c0563f');
  return a.c;
}

// ---------------------------------------------------------------------------
// Sofa
// ---------------------------------------------------------------------------

const SOFA = { base: '#4f8f86', light: '#6fb0a6', dark: '#366a63', line: '#1f3d39' };

function sofaPart(a: Art, x: number, y: number, w: number, h: number, round = 3): void {
  pillow(a, x, y, w, h, SOFA.base, { light: SOFA.light, dark: SOFA.dark, line: SOFA.line, round });
}

function sofaFeet(a: Art, xs: number[], y: number): void {
  for (const x of xs) {
    a.rect(x, y, 4, 2, WOOD.edge);
    a.rect(x + 1, y, 2, 1, WOOD.D);
  }
}

function sofaFront(): Canvas {
  const a = new Art(64, 32);
  sofaFeet(a, [4, 56], 28);
  sofaPart(a, 4, 0, 56, 18);
  for (const x of [17, 31, 45]) {
    a.px(x, 8, SOFA.dark);
    a.px(x, 9, shade(SOFA.dark, 0.2));
  }
  // two seat cushions
  sofaPart(a, 8, 15, 25, 13, 2);
  sofaPart(a, 31, 15, 25, 13, 2);
  // arms
  sofaPart(a, 0, 10, 10, 18, 3);
  sofaPart(a, 54, 10, 10, 18, 3);
  return a.c;
}

function sofaBack(): Canvas {
  const a = new Art(64, 32);
  sofaFeet(a, [4, 56], 28);
  sofaPart(a, 0, 4, 64, 24, 3);
  a.rect(3, 20, 58, 1, SOFA.dark);
  a.rect(32, 7, 1, 12, shade(SOFA.base, -0.12));
  return a.c;
}

function sofaSide(): Canvas {
  // faces right: backrest on the left, seat to the right
  const a = new Art(32, 64);
  sofaFeet(a, [2, 20], 60);
  sofaPart(a, 6, 10, 20, 50, 2);
  a.rect(8, 34, 16, 1, SOFA.line);
  a.rect(8, 35, 16, 1, SOFA.light);
  sofaPart(a, 0, 2, 10, 58, 3);
  return a.c;
}

// ---------------------------------------------------------------------------
// Bookshelves
// ---------------------------------------------------------------------------

const BOOKS = [
  '#c0563f',
  '#3d6fd1',
  '#48a46f',
  '#e0c15a',
  '#7a5ad1',
  '#d65d73',
  '#5ec2d6',
  '#8a5a32',
];

/** One shelf of books inside x..x+w, standing on row `floorY`, up to `maxH` tall. */
function bookRow(a: Art, x: number, floorY: number, w: number, maxH: number, seed: number): void {
  let cx = x;
  let i = seed;
  while (cx < x + w) {
    const bw = 3 + Math.floor(noise(i, seed, 51) * 3);
    const bh = maxH - Math.floor(noise(i, seed, 52) * 4);
    if (cx + bw > x + w) {
      break;
    }
    const col = BOOKS[i % BOOKS.length];
    const y0 = floorY - bh + 1;
    a.rect(cx, y0, bw, bh, shade(col, -0.55));
    a.rect(cx + 1, y0 + 1, bw - 1, bh - 1, col);
    a.rect(cx + 1, y0 + 1, 1, bh - 1, shade(col, 0.25));
    // spine bands
    a.rect(cx + 1, y0 + 3, bw - 1, 1, shade(col, -0.25));
    a.rect(cx + 1, floorY - 3, bw - 1, 1, shade(col, -0.25));
    if (bw >= 4) {
      a.px(cx + 2, y0 + 5, '#f1dfbd');
    }
    cx += bw;
    i += 3;
    // a gap now and then
    if (noise(i, seed, 53) > 0.82) {
      cx += 2;
    }
  }
}

function shelfFrame(a: Art, y: number, h: number, shelves: number[]): void {
  a.rect(0, y, 64, h, WOOD.edge);
  woodGrain(a, 1, y + 1, 62, 4, 31, 8);
  a.rect(1, y + 1, 62, 1, WOOD.rim);
  a.rect(3, y + 5, 58, h - 7, '#4a2e1a');
  a.rect(3, y + 5, 58, 2, '#2e1c10');
  // side panels
  a.rect(1, y + 5, 2, h - 6, WOOD.L);
  a.rect(61, y + 5, 2, h - 6, WOOD.D);
  for (const sy of shelves) {
    a.rect(3, sy, 58, 2, WOOD.M);
    a.rect(3, sy, 58, 1, WOOD.L);
    a.rect(3, sy + 2, 58, 1, '#2e1c10');
  }
  a.rect(1, y + h - 2, 62, 1, WOOD.X);
}

function bookshelf(): Canvas {
  const a = new Art(64, 32);
  shelfFrame(a, 12, 20, [29]);
  bookRow(a, 5, 28, 46, 13, 1);
  // a little succulent at the end of the row
  a.rect(53, 24, 6, 5, '#c0643a');
  a.rect(53, 24, 6, 1, '#e08a5a');
  a.oval(56, 22, 3, 2.4, '#5fb85a');
  a.px(55, 21, '#8fd67a');
  return a.c;
}

function doubleBookshelf(): Canvas {
  const a = new Art(64, 64);
  shelfFrame(a, 12, 36, [29, 45]);
  bookRow(a, 5, 28, 54, 13, 2);
  bookRow(a, 5, 44, 40, 13, 5);
  // a lying stack and a globe-ish trinket
  for (const [k, col] of ['#3d6fd1', '#e0c15a', '#c0563f'].entries()) {
    a.rect(47, 42 - k * 3, 12, 3, shade(col, -0.55));
    a.rect(48, 43 - k * 3, 10, 1, col);
    a.rect(48, 42 - k * 3, 10, 1, shade(col, 0.2));
  }
  return a.c;
}

// ---------------------------------------------------------------------------
// Wall decor
// ---------------------------------------------------------------------------

function clock(): Canvas {
  const a = new Art(32, 64);
  a.oval(16, 32, 12, 11, '#3b2412');
  a.oval(16, 32, 11, 10, WOOD.M);
  a.oval(15.5, 31.5, 10, 9, WOOD.L);
  a.oval(16, 32, 9, 8, '#3b2412');
  a.oval(16, 32, 8, 7, '#fff4dc');
  a.oval(17, 33, 7, 6, '#fff4dc');
  // ticks at 12, 3, 6, 9 and the quarter-hour dots
  a.rect(15, 26, 2, 2, '#3b2412');
  a.rect(15, 37, 2, 2, '#3b2412');
  a.rect(9, 32, 2, 1, '#3b2412');
  a.rect(21, 32, 2, 1, '#3b2412');
  for (const [x, y] of [
    [12, 28],
    [20, 28],
    [12, 36],
    [20, 36],
  ]) {
    a.px(x, y, '#b8783f');
  }
  // hands: ten past ten
  a.line(16, 32, 16, 28, '#2a1a12');
  a.line(16, 32, 19, 30, '#2a1a12');
  a.px(16, 32, '#c0563f');
  // glass glint
  a.px(12, 27, '#ffffff');
  a.px(11, 28, '#ffffffaa');
  return a.c;
}

function whiteboard(): Canvas {
  const a = new Art(64, 64);
  a.rect(4, 16, 56, 32, '#6b4128');
  a.rect(5, 17, 54, 30, '#b8bcc4');
  a.rect(6, 18, 52, 28, '#fbf7ee');
  a.rect(6, 18, 52, 1, '#ffffff');
  a.rect(57, 19, 1, 27, '#e8e2d4');
  // scribbles: text lines, a box chart, an arrow and two sticky notes
  a.rect(10, 22, 18, 1, '#3d6fd1');
  a.rect(10, 25, 12, 1, '#3d6fd1');
  a.rect(10, 28, 22, 1, '#c0563f');
  a.rect(10, 31, 14, 1, '#3d6fd1');
  a.rect(10, 36, 9, 1, '#3d6fd1');
  a.box(38, 21, 12, 9, '#fbf7ee', '#48a46f');
  a.rect(40, 26, 2, 3, '#48a46f');
  a.rect(43, 24, 2, 5, '#48a46f');
  a.rect(46, 23, 2, 6, '#48a46f');
  a.line(28, 38, 36, 34, '#7a5ad1');
  a.px(35, 33, '#7a5ad1');
  a.px(36, 35, '#7a5ad1');
  a.rect(40, 34, 7, 7, '#ffd166');
  a.rect(40, 34, 7, 1, '#ffe39a');
  a.rect(48, 35, 7, 7, '#ff8fab');
  a.rect(48, 35, 7, 1, '#ffb3c6');
  // marker tray with markers
  a.rect(10, 47, 44, 2, '#8a5a32');
  a.rect(10, 47, 44, 1, '#b8783f');
  a.rect(16, 45, 6, 2, '#c0563f');
  a.rect(24, 45, 6, 2, '#3d6fd1');
  a.rect(34, 45, 5, 2, '#f1dfbd');
  return a.c;
}

/** A wood picture frame with a lit top-left bevel. */
function frame(a: Art, x: number, y: number, w: number, h: number): void {
  a.rect(x, y, w, h, '#3b2412');
  a.rect(x + 1, y + 1, w - 2, h - 2, WOOD.M);
  a.rect(x + 1, y + 1, w - 2, 1, WOOD.L);
  a.rect(x + 1, y + 1, 1, h - 2, WOOD.L);
  a.rect(x + 1, y + h - 2, w - 2, 1, WOOD.D);
  a.rect(x + w - 2, y + 1, 1, h - 2, WOOD.D);
  a.rect(x + 3, y + 3, w - 6, h - 6, '#3b2412');
}

/** Rolling hills across x0..x1 under baseline `base`. */
function hills(
  a: Art,
  x0: number,
  x1: number,
  base: number,
  amp: number,
  k: number,
  col: string,
  top: string,
  bottom = base,
): void {
  for (let x = x0; x < x1; x++) {
    const hh = amp + Math.round(amp * 0.6 * Math.sin(x / k) + Math.cos(x / (k * 1.6)));
    a.rect(x, base - hh, 1, bottom - base + hh, col);
    a.px(x, base - hh, top);
  }
}

function smallPainting(variant: 1 | 2): Canvas {
  const a = new Art(32, 64);
  frame(a, 4, 24, 24, 28);
  const [x, y, w, h] = [8, 28, 16, 20];
  if (variant === 1) {
    a.rect(x, y, w, h, '#8fb8de');
    a.rect(x, y, w, 4, '#7aa8d4');
    a.rect(x + 9, y + 3, 4, 4, '#fff1b8');
    a.px(x + 9, y + 3, '#8fb8de');
    hills(a, x, x + w, y + 15, 5, 2.4, '#6b9a52', '#8fbf6a', y + h);
    hills(a, x, x + w, y + h, 4, 1.7, '#4f8a45', '#6b9a52');
  } else {
    a.rect(x, y, w, h, '#f6e3bd');
    a.rect(x + 7, y + 9, 2, 10, '#4f8a45');
    a.oval(x + 5, y + 14, 3, 1.6, '#5fb85a');
    a.oval(x + 8, y + 7, 5, 4.5, '#ff8fab');
    a.oval(x + 7.5, y + 6.5, 3.5, 3, '#ffb3c6');
    a.oval(x + 8, y + 7, 1.6, 1.6, '#ffd166');
    a.rect(x, y + h - 3, w, 3, '#e8d0a0');
  }
  a.rect(x, y, w, 1, '#ffffff44');
  return a.c;
}

function largePainting(): Canvas {
  const a = new Art(64, 64);
  frame(a, 4, 24, 56, 28);
  const [x, y, w, h] = [8, 28, 48, 20];
  a.rect(x, y, w, 7, '#6a8fd8');
  a.rect(x, y + 7, w, 4, '#a993cf');
  a.rect(x, y + 11, w, 4, '#f7a26b');
  a.rect(x, y + 15, w, 5, '#ffd58a');
  a.oval(x + 36, y + 13, 4, 4, '#fff1b8');
  hills(a, x, x + w, y + 17, 4, 4.5, '#3f7a3a', '#5a9a4a', y + h);
  hills(a, x, x + w, y + h, 3, 2.6, '#2f6a32', '#4f8a45');
  a.rect(x, y, w, 1, '#ffffff44');
  return a.c;
}

// ---------------------------------------------------------------------------
// Light fixtures: window, floor lamp, fairy lights
// ---------------------------------------------------------------------------

/** Wall window, 2x2 tiles: wood frame, daylight sky, far hills, a cross mullion and a sill. */
function windowPane(): Canvas {
  const a = new Art(64, 64);
  a.rect(2, 6, 60, 52, '#3b2412');
  a.rect(3, 7, 58, 50, '#8a5a32');
  a.rect(3, 7, 58, 1, '#c18a52');
  a.rect(3, 7, 1, 50, '#c18a52');
  // glass: sky bands lighter toward the horizon
  const [gx, gy, gw, gh] = [6, 10, 52, 44];
  a.rect(gx, gy, gw, gh, '#8fc4ea');
  a.rect(gx, gy, gw, 12, '#7fb6e2');
  a.rect(gx, gy + 24, gw, 12, '#b8dcf2');
  a.oval(46, 19, 3.5, 3.5, '#fff1b8');
  a.oval(46, 19, 2, 2, '#ffffff');
  // clouds
  a.oval(16, 22, 6, 2.2, '#ffffff');
  a.oval(20, 20, 4, 2, '#ffffff');
  a.oval(36, 30, 4, 1.4, '#eef7fc');
  hills(a, gx, gx + gw, gy + 38, 7, 7, '#6b9a52', '#8fbf6a', gy + gh);
  hills(a, gx, gx + gw, gy + gh, 4, 4.6, '#4f8a45', '#6b9a52');
  // a tree on the far hill
  a.rect(18, 37, 1, 5, '#5a3a22');
  a.oval(18.5, 35, 2.5, 3, '#3f7a3a');
  // cross mullion
  a.rect(30, gy, 4, gh, '#7a4b2b');
  a.rect(gx, 30, gw, 4, '#7a4b2b');
  a.rect(30, gy, 1, gh, '#9b6338');
  a.rect(gx, 30, gw, 1, '#9b6338');
  // glass sheen
  a.line(9, 26, 15, 13, '#ffffff55');
  a.line(37, 26, 43, 13, '#ffffff55');
  a.line(9, 28, 17, 13, '#ffffff33');
  // sill
  a.rect(0, 56, 64, 6, '#3b2412');
  a.rect(1, 57, 62, 4, '#9b6338');
  a.rect(1, 57, 62, 1, '#c18a52');
  a.rect(1, 60, 62, 1, '#7a4b2b');
  return a.c;
}

/** Floor lamp, 1x2 tiles: warm pleated shade on a thin pole over a round base. */
function floorLamp(): Canvas {
  const a = new Art(32, 64);
  // shade: a trapezoid, pleats, a lit band near the bottom
  for (let y = 0; y < 14; y++) {
    const w = 14 + Math.round((12 * y) / 13);
    const x0 = 16 - w / 2;
    a.rect(x0, 4 + y, w, 1, '#6b4a20');
    if (y > 0 && y < 13) {
      a.rect(x0 + 1, 4 + y, w - 2, 1, y > 9 ? '#fff1b8' : '#e8c27a');
      for (let px = x0 + 3; px < x0 + w - 2; px += 4) {
        a.px(px, 4 + y, y > 9 ? '#ffe39a' : '#d9ac62');
      }
      a.px(x0 + 1, 4 + y, '#f6dc9e');
    }
  }
  // bulb glow under the shade
  a.rect(11, 18, 10, 1, '#fff1b8');
  a.rect(13, 19, 6, 1, '#fff1b8aa');
  // pole
  a.rect(15, 19, 3, 35, '#3b2412');
  a.rect(15, 19, 1, 35, '#7a4b2b');
  a.rect(16, 19, 1, 35, '#5a3a22');
  // base
  pillow(a, 7, 53, 18, 6, '#7a4b2b', {
    light: '#9b6338',
    dark: '#5a3a22',
    line: '#3b2412',
    round: 2,
  });
  return a.c;
}

/** Fairy lights, 4x1 tiles: a sagging wire with warm bulbs every 16 px. */
function fairyLights(): Canvas {
  const a = new Art(128, 32);
  const BULBS = ['#ffd166', '#ff8fab', '#8fd67a', '#8fc4ea'];
  const sag = (x: number): number => 2 + Math.round(8 * Math.sin((Math.PI * x) / 127));
  for (let x = 0; x < 128; x++) {
    a.px(x, sag(x), '#4a3020');
  }
  a.rect(0, 1, 2, 3, '#4a3020');
  a.rect(126, 1, 2, 3, '#4a3020');
  for (let i = 0; i < 8; i++) {
    const x = 6 + i * 16;
    const y = sag(x) + 1;
    const col = BULBS[i % BULBS.length];
    a.rect(x, y, 3, 2, '#5a4a3a');
    a.rect(x, y + 2, 3, 4, col);
    a.rect(x + 1, y + 6, 1, 1, col);
    a.px(x, y + 2, '#ffffffcc');
    a.px(x + 2, y + 5, shade(col, -0.25));
  }
  return a.c;
}

// ---------------------------------------------------------------------------

export function buildDecor(out: SpriteSet): void {
  out['PLANT/PLANT.png'] = plant(1);
  out['PLANT_2/PLANT_2.png'] = plant(2);
  out['LARGE_PLANT/LARGE_PLANT.png'] = largePlant();
  out['CACTUS/CACTUS.png'] = cactus();
  out['HANGING_PLANT/HANGING_PLANT.png'] = hangingPlant();
  out['POT/POT.png'] = emptyPot();
  out['BIN/BIN.png'] = bin();
  out['COFFEE/COFFEE.png'] = coffee();
  out['SOFA/SOFA_FRONT.png'] = sofaFront();
  out['SOFA/SOFA_BACK.png'] = sofaBack();
  out['SOFA/SOFA_SIDE.png'] = sofaSide();
  out['BOOKSHELF/BOOKSHELF.png'] = bookshelf();
  out['DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png'] = doubleBookshelf();
  out['CLOCK/CLOCK.png'] = clock();
  out['WHITEBOARD/WHITEBOARD.png'] = whiteboard();
  out['SMALL_PAINTING/SMALL_PAINTING.png'] = smallPainting(1);
  out['SMALL_PAINTING_2/SMALL_PAINTING_2.png'] = smallPainting(2);
  out['LARGE_PAINTING/LARGE_PAINTING.png'] = largePainting();
  out['WINDOW/WINDOW.png'] = windowPane();
  out['FLOOR_LAMP/FLOOR_LAMP.png'] = floorLamp();
  out['FAIRY_LIGHTS/FAIRY_LIGHTS.png'] = fairyLights();
}
