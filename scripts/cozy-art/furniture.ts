/**
 * Cozy furniture sprites. Only the PNGs change: every manifest, id, file name,
 * size and footprint stays as shipped, so saved layouts keep resolving.
 *
 * Shared legend (each sprite may add its own letters):
 *   O outline  L wood light  M wood mid  D wood dark  X wood deep  S soft shadow (translucent)
 *   C cream  c cream shade
 */

import type { Palette } from './canvas';
import { assertRect, Canvas } from './canvas';

const BASE: Palette = {
  O: '#3b2412',
  L: '#e0a86a',
  M: '#b8783f',
  D: '#9a6233',
  X: '#7a4b2b',
  S: '#00000033',
  C: '#f1dfbd',
  c: '#e0c79a',
};

export type SpriteSet = Record<string, Canvas>;

function make(
  out: SpriteSet,
  file: string,
  w: number,
  h: number,
  rows: readonly string[],
  extra: Palette = {},
  top = 0,
): void {
  // `rows` describe the sprite from row `top` down; rows above are transparent.
  const c = new Canvas(w, h);
  assertRect(file, rows, w, h - top);
  c.stamp(rows, { ...BASE, ...extra }, 0, top);
  out[file] = c;
}

function rect(c: Canvas, x: number, y: number, w: number, h: number, hex: string): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      c.set(xx, yy, hex);
    }
  }
}

/** Outlined box: 1 px outline, flat fill. */
function box(c: Canvas, x: number, y: number, w: number, h: number, fill: string, line: string): void {
  rect(c, x, y, w, h, line);
  rect(c, x + 1, y + 1, w - 2, h - 2, fill);
}

// ---------------------------------------------------------------------------
// Desks (flat parts drawn with rects, details stamped on top)
// ---------------------------------------------------------------------------

function deskFront(): Canvas {
  const c = new Canvas(48, 32);
  // soft shadow under the whole desk
  rect(c, 3, 27, 42, 5, '#00000033');
  // top surface: light edge, wood body, a darker working band, front lip
  box(c, 2, 11, 44, 15, '#b8783f', '#3b2412');
  rect(c, 3, 12, 42, 2, '#e0a86a');
  rect(c, 4, 18, 40, 3, '#9a6233');
  rect(c, 3, 23, 42, 2, '#9a6233');
  // grain ticks
  for (let x = 7; x < 44; x += 9) {
    c.set(x, 15, '#9a6233');
    c.set(x + 3, 16, '#e0a86a');
  }
  // legs
  for (const lx of [3, 41]) {
    rect(c, lx, 26, 4, 6, '#3b2412');
    rect(c, lx + 1, 26, 2, 5, '#7a4b2b');
  }
  return c;
}

function deskSide(): Canvas {
  const c = new Canvas(16, 64);
  // long top seen from the side, rows 11..58
  box(c, 0, 11, 16, 48, '#b8783f', '#3b2412');
  rect(c, 1, 12, 2, 46, '#e0a86a');
  rect(c, 12, 12, 3, 46, '#9a6233');
  for (let y = 16; y < 56; y += 9) {
    c.set(6, y, '#9a6233');
    c.set(8, y + 3, '#e0a86a');
  }
  rect(c, 1, 55, 14, 3, '#7a4b2b');
  return c;
}

// ---------------------------------------------------------------------------
// PCs: 16x32, screen faces the viewer
// ---------------------------------------------------------------------------

const PC_PAL: Palette = {
  o: '#2a2a33',
  M: '#e3e0d8',
  m: '#b9b4a8',
  K: '#f4efe4',
  k: '#cfc8b8',
  l: '#6dffb5',
  s: '#232a36',
  g: '#6dffb5',
  a: '#ffd166',
  b: '#7fc4ff',
  r: '#3a4252',
};

/** Frame with an 8x6 screen interior filled from `screen` (rows of 8 chars). */
function pcFront(screen: readonly string[], led: boolean): string[] {
  const rows = [
    '...oooooooooo...',
    '..oMMMMMMMMMMo..',
    '.oMmmmmmmmmmmMo.',
    '.oMm' + screen[0] + 'mMo.',
    '.oMm' + screen[1] + 'mMo.',
    '.oMm' + screen[2] + 'mMo.',
    '.oMm' + screen[3] + 'mMo.',
    '.oMm' + screen[4] + 'mMo.',
    '.oMm' + screen[5] + 'mMo.',
    '.oMmmmmmmmmmmMo.',
    led ? '.oMMMMMMMMMlMMo.' : '.oMMMMMMMMMMMMo.',
    '..oooooooooooo..',
    '......oMMo......',
    '.....oMMMMo.....',
    '....oMMMMMMo....',
    '....oooooooo....',
    '................',
    '................',
    '.ooooooooooo.oo.',
    '.oKkKkKkKkKo.oMo',
    '.okKkKkKkKko.ooo',
    '.ooooooooooo....',
  ];
  return rows;
}

const SCREEN_OFF = ['rssssssr', 'srsssssr', 'ssrsssss', 'sssrssss', 'ssssssss', 'ssssssss'];
const SCREEN_ON = [
  ['ggggsgss', 'ssgggsss', 'ggsssggs', 'sssssssb', 'gggsgsss', 'gsssssss'],
  ['gggsssss', 'ssggggss', 'sssgsggs', 'bbbbsssa', 'ggsggsss', 'ssgsssss'],
  ['ggsgggss', 'sssgsssg', 'ggggsssg', 'sssssabs', 'gsgggsss', 'gggsssss'],
];

function pcBack(): string[] {
  return [
    '..oooooooooooo..',
    '.oMMMMMMMMMMMMo.',
    '.oMMMMMMMMMMMMo.',
    '.oMMMmmmmmmMMMo.',
    '.oMMMmmmmmmMMMo.',
    '.oMMMMMMMMMMMMo.',
    '.oMMMMMMMMMMMMo.',
    '.oMMMMMMMMMMMMo.',
    '.oooooooooooooo.',
    '.....oMMMMo.....',
    '....oMMMMMMo....',
    '...oooooooooo...',
    '................',
    '................',
    '.ooooooooooo.oo.',
    '.oKkKkKkKkKo.oMo',
    '.ooooooooooo.ooo',
  ];
}

/** Side view, screen facing left (the art is mirrored at runtime for the other side). */
function pcSide(): string[] {
  return [
    '......oooooo....',
    '.....osMMMMMo...',
    '.....osMMMMMo...',
    '.....osMMMMMMo..',
    '.....osMMMMMMo..',
    '.....osMMMMMMo..',
    '.....osMMMMMMo..',
    '.....osMMMMMo...',
    '.....osMMMMMo...',
    '......oMMMMo....',
    '......oooooo....',
    '.......oMMo.....',
    '.......oMMo.....',
    '....oooooooooo..',
    '....oMMMMMMMMo..',
    '....oooooooooo..',
    '................',
    '.oooooooo.......',
    '.oKkKkKko.......',
    '.oooooooo.......',
  ];
}

export function buildPcs(out: SpriteSet): void {
  make(out, 'PC/PC_FRONT_OFF.png', 16, 32, padRows(pcFront(SCREEN_OFF, false), 32), PC_PAL);
  SCREEN_ON.forEach((scr, i) => {
    make(out, `PC/PC_FRONT_ON_${i + 1}.png`, 16, 32, padRows(pcFront(scr, true), 32), PC_PAL);
  });
  make(out, 'PC/PC_BACK.png', 16, 32, padRows(pcBack(), 26), PC_PAL, 6);
  make(out, 'PC/PC_SIDE.png', 16, 32, padRows(pcSide(), 29), PC_PAL, 3);
}

/** Pad a 16-wide map with transparent rows at the bottom up to `total` rows. */
function padRows(rows: string[], total: number): string[] {
  return rows.concat(Array.from({ length: total - rows.length }, () => '.'.repeat(16)));
}

// ---------------------------------------------------------------------------
// Chairs
// ---------------------------------------------------------------------------

const CHAIR_PAL: Palette = { C: '#f4e6c6', c: '#dcc79c' };

const WOODEN_CHAIR_FRONT = [
  '...OOOOOOOOOO...',
  '..OLLLLLLLLLLO..',
  '..OMMMMMMMMMMO..',
  '..OOOOOOOOOOOO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OOOOOOOOOOOO..',
  '..OCCCCCCCCCCO..',
  '..OCCCCCCCCCCO..',
  '..OCCCCCCCCCCO..',
  '..OCCCCCCCCCCO..',
  '..OccccccccccO..',
  '..OOOOOOOOOOOO..',
  '..OXOSSSSSSOXO..',
  '..OXOSSSSSSOXO..',
  '..OXOSSSSSSOXO..',
  '..OOOSSSSSSOOO..',
  '...SSSSSSSSSS...',
  '................',
  '................',
];

const WOODEN_CHAIR_BACK = [
  '...OOOOOOOOOO...',
  '..OLLLLLLLLLLO..',
  '..OMO.OLLO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OMO.OMMO.OMO..',
  '..OOOOOOOOOOOO..',
  '..ODDDDDDDDDDO..',
  '..OXXXXXXXXXXO..',
  '..OOOOOOOOOOOO..',
  '..OXOSSSSSSOXO..',
  '..OXOSSSSSSOXO..',
  '..OXOSSSSSSOXO..',
  '..OOOSSSSSSOOO..',
  '...SSSSSSSSSS...',
  '................',
];

const WOODEN_CHAIR_SIDE = [
  '.OOO............',
  '.OLO............',
  '.OMO............',
  '.OMO............',
  '.OMO............',
  '.OMO............',
  '.OMO............',
  '.OMO............',
  '.OMOOOOOOOOO....',
  '.OXOCCCCCCCO....',
  '.OXOCCCCCCCO....',
  '.OXOCCCCCCcO....',
  '.OXOccccccco....',
  '.OXOOOOOOOOO....',
  '.OXOSSSSSOXO....',
  '.OXOSSSSSOXO....',
  '.OXOSSSSSOXO....',
  '.OOOSSSSSOOO....',
  '..SSSSSSSSSS....',
  '................',
  '................',
  '................',
];

const ARMCHAIR_PAL: Palette = {
  R: '#c0563f',
  r: '#d9745a',
  N: '#8f3a2a',
  C: '#c0563f',
};

const CUSHION_FRONT = [
  '...OOOOOOOOOO...',
  '..ORRRRRRRRRRO..',
  '..ORrrrrrrrrRO..',
  '..ORRRRRRRRRRO..',
  '.OORRRRRRRRRROO.',
  '.ORORRRRRRRRORO.',
  '.ORORRRRRRRRORO.',
  '.ORORrrrrrrRORO.',
  '.ORORRRRRRRRORO.',
  '.ORORRRRRRRRORO.',
  '.ORNNNNNNNNNNRO.',
  '.OOOOOOOOOOOOOO.',
  '..OXO......OXO..',
  '..OXO......OXO..',
  '..SSSSSSSSSSSS..',
  '...SSSSSSSSSS...',
];

const CUSHION_BACK = [
  '................',
  '................',
  '................',
  '................',
  '..OOOOOOOOOOOO..',
  '.ORRRRRRRRRRRRO.',
  '.ORrrrrrrrrrrRO.',
  '.ORRRRRRRRRRRRO.',
  '.ORRRRRRRRRRRRO.',
  '.ORRRRRRRRRRRRO.',
  '.ORNNNNNNNNNNRO.',
  '.OOOOOOOOOOOOOO.',
  '..OXO......OXO..',
  '..OXO......OXO..',
  '..SSSSSSSSSSSS..',
  '...SSSSSSSSSS...',
];

const CUSHION_SIDE = [
  '.OOOO...........',
  'ORRRRO..........',
  'ORrRRO..........',
  'ORRRROOOOOOO....',
  'ORRRRRRRRRRRO...',
  'ORRRRRRRRRrRO...',
  'ORRRRRRRRRRRO...',
  'ORRRRNNNNNNNO...',
  'OOOOOOOOOOOOO...',
  '.OXO.....OXO....',
  '.OXO.....OXO....',
  '.OXO.....OXO....',
  '.OXO.....OXO....',
  '.SSSSSSSSSSS....',
  '..SSSSSSSSS.....',
  '................',
];

export function buildChairs(out: SpriteSet): void {
  make(out, 'WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png', 16, 32, WOODEN_CHAIR_FRONT, CHAIR_PAL, 9);
  make(out, 'WOODEN_CHAIR/WOODEN_CHAIR_BACK.png', 16, 32, WOODEN_CHAIR_BACK, CHAIR_PAL, 15);
  make(out, 'WOODEN_CHAIR/WOODEN_CHAIR_SIDE.png', 16, 32, WOODEN_CHAIR_SIDE, CHAIR_PAL, 10);
  make(out, 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png', 16, 16, CUSHION_FRONT, ARMCHAIR_PAL);
  make(out, 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png', 16, 16, CUSHION_BACK, ARMCHAIR_PAL);
  make(out, 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_SIDE.png', 16, 16, CUSHION_SIDE, ARMCHAIR_PAL);
}

export function buildDesks(out: SpriteSet): void {
  out['DESK/DESK_FRONT.png'] = deskFront();
  out['DESK/DESK_SIDE.png'] = deskSide();
}

export { box, make, rect };
