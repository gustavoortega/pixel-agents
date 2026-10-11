/**
 * Cozy furniture sprites at density 2 (2 art px per world px). Ids, file names and
 * footprints stay as shipped: every PNG measures twice its manifest width and height, and
 * every shape sits where the 1x art had it (old coordinates x2), so seats, desk tops and
 * surface items keep lining up. No drop shadows are baked in: the engine draws them.
 */

import type { Palette } from './canvas';
import { assertRect, Canvas, shade } from './canvas';
import { Art, pillow, WOOD, woodApron, woodLeg, woodTop } from './hd';

export type SpriteSet = Record<string, Canvas>;

// ---------------------------------------------------------------------------
// Desks and tables
// ---------------------------------------------------------------------------

/** 96x64. The desk top starts on row 22: seats read the cover depth off it. */
function deskFront(): Canvas {
  const a = new Art(96, 64);
  for (const lx of [6, 82]) {
    woodLeg(a, lx, 50, 8, 14);
  }
  // top surface: three boards, 3-tone grain, a darker edge and a lit far rim
  woodTop(a, 2, 22, 92, 23, 3, { plank: 6 });
  // front edge: lit lip, apron, darker base
  woodApron(a, 2, 44, 92, 8);
  // drawer and its brass pull
  a.rect(36, 46, 24, 1, WOOD.X);
  a.rect(36, 49, 24, 1, WOOD.edge);
  a.rect(35, 46, 1, 4, WOOD.X);
  a.rect(60, 46, 1, 4, WOOD.X);
  a.rect(46, 47, 4, 1, '#f2c65a');
  a.rect(46, 48, 4, 1, '#b7862e');
  return a.c;
}

/** 32x128: the same desk turned, its long top running down the screen. */
function deskSide(): Canvas {
  const a = new Art(32, 128);
  for (const ly of [112]) {
    woodLeg(a, 3, ly, 6, 16);
    woodLeg(a, 23, ly, 6, 16);
  }
  woodTop(a, 0, 22, 32, 90, 5, { plank: 7, vertical: true });
  // the side apron shows along the right edge, the near end at the bottom
  a.rect(26, 24, 5, 86, WOOD.D);
  a.rect(26, 24, 1, 86, shade(WOOD.D, 0.12));
  a.rect(31, 23, 1, 88, WOOD.edge);
  woodApron(a, 0, 110, 32, 6);
  return a.c;
}

/** A plain wood table: top, front apron and optional legs, all in the shared grain. */
function table(
  w: number,
  h: number,
  top: { x: number; y: number; w: number; h: number },
  apronH: number,
  legs: number[],
  legW: number,
  seed: number,
  vertical = false,
): Canvas {
  const a = new Art(w, h);
  const legY = top.y + top.h + apronH - 2;
  for (const lx of legs) {
    woodLeg(a, lx, legY, legW, h - legY);
  }
  woodTop(a, top.x, top.y, top.w, top.h + 1, seed, { plank: 7, vertical });
  woodApron(a, top.x, top.y + top.h, top.w, apronH);
  return a.c;
}

export function buildDesks(out: SpriteSet): void {
  out['DESK/DESK_FRONT.png'] = deskFront();
  out['DESK/DESK_SIDE.png'] = deskSide();
  out['TABLE_FRONT/TABLE_FRONT.png'] = table(
    96,
    128,
    { x: 0, y: 22, w: 96, h: 88 },
    8,
    [4, 82],
    10,
    7,
  );
  out['SMALL_TABLE/SMALL_TABLE_FRONT.png'] = table(
    64,
    64,
    { x: 0, y: 22, w: 64, h: 34 },
    8,
    [],
    0,
    9,
  );
  out['SMALL_TABLE/SMALL_TABLE_SIDE.png'] = table(
    32,
    96,
    { x: 0, y: 20, w: 32, h: 64 },
    12,
    [],
    0,
    11,
    true,
  );
  out['COFFEE_TABLE/COFFEE_TABLE.png'] = table(
    64,
    64,
    { x: 4, y: 12, w: 56, h: 36 },
    6,
    [6, 50],
    8,
    13,
  );
}

// ---------------------------------------------------------------------------
// PCs: 32x64, a cream CRT-era monitor with a bezel, stand and screen glow
// ---------------------------------------------------------------------------

const MON_PAL: Palette = {
  o: '#5a544a',
  M: '#e8e3d6',
  m: '#c4bdae',
  d: '#a39b8a',
  K: '#fbf7ee',
  s: '#1c2530',
  x: '#c8f5d8',
  y: '#2a4a4a',
  L: '#2c8a5e',
  l: '#6dffb5',
};

/** The monitor, 32x29. The screen interior (cols 5..25, rows 4..16) is painted separately. */
const MONITOR = [
  '...oooooooooooooooooooooooooo...',
  '..oKKKKKKKKKKKKKKKKKKKKKKKKKMo..',
  '.oKMMMMMMMMMMMMMMMMMMMMMMMMMMmo.',
  '.oKMMddddddddddddddddddddddMMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxsssssssssssssssssssssyxMmo.',
  '.oKMxyyyyyyyyyyyyyyyyyyyyyyxMmo.',
  '.oKMMxxxxxxxxxxxxxxxxxxxxxxMMmo.',
  '.oKMMMMMMMMMMMMMMMMMMMMMLlMMMmo.',
  '.oMmmmmmmmmmmmmmmmmmmmmmmmmmmmo.',
  '..oooooooooooooooooooooooooooo..',
  '.............oKMmo..............',
  '.............oKMmo..............',
  '............oKMMmdo.............',
  '.........ooooooooooooo..........',
  '........oKKKKKKKKKKKKKo.........',
  '........oMMMMMMMMMMMMmo.........',
  '.........ooooooooooooo..........',
];

const KEYS_PAL: Palette = { o: '#5a544a', k: '#c4bdae', K: '#fbf7ee', m: '#a39b8a', M: '#e8e3d6' };
const KEYBOARD = [
  '.oooooooooooooooooooo.',
  'oMMMMMMMMMMMMMMMMMMMMo',
  'oMKkKkKkKkKkKkKkKkKkmo',
  'oMkKkKkKkKkKkKkKkKkKmo',
  'oMKkKkKKKKKKKKKKkKkKmo',
  'ommmmmmmmmmmmmmmmmmmmo',
  '.oooooooooooooooooooo.',
];
const MOUSE = ['.oooo.', 'oKKMmo', 'oKmMmo', 'oMMMmo', 'ommmmo', '.oooo.'];

const CODE = { g: '#6dffb5', G: '#3fbf86', a: '#ffd166', b: '#7fc4ff', s: '#1c2530' };

/** One line of code per even screen row: [indent, ...token lengths with their color]. */
type CodeLine = Array<[number, keyof typeof CODE]>;

const CODE_LINES: CodeLine[] = [
  [
    [1, 's'],
    [3, 'g'],
    [1, 'G'],
    [1, 's'],
    [6, 'g'],
    [5, 's'],
    [1, 'b'],
  ],
  [
    [3, 's'],
    [1, 'G'],
    [4, 'g'],
    [1, 's'],
    [4, 'a'],
    [1, 'G'],
  ],
  [
    [3, 's'],
    [1, 'G'],
    [2, 'g'],
    [1, 's'],
    [8, 'g'],
    [1, 'G'],
  ],
  [
    [1, 's'],
    [3, 'g'],
    [1, 'G'],
    [1, 's'],
    [4, 'b'],
  ],
  [
    [3, 's'],
    [1, 'G'],
    [3, 'g'],
    [1, 's'],
    [4, 'g'],
  ],
  [
    [1, 's'],
    [3, 'g'],
    [1, 's'],
    [1, 'g'],
    [1, 's'],
  ],
];

/** Paints the lit screen (21x13 at monitor col 5, row 4). Frames differ by a typed token and the cursor. */
function screenOn(a: Art, ox: number, oy: number, frame: number): void {
  const lines = CODE_LINES.map((l) => l.map((t) => [...t] as [number, keyof typeof CODE]));
  if (frame >= 1) {
    lines[5].push([3, 'a']);
  }
  if (frame >= 2) {
    lines[5].push([1, 's'], [2, 'b']);
  }
  const bright: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    let x = 0;
    const y = 2 + i * 2;
    for (const [len, key] of line) {
      for (let k = 0; k < len && x < 20; k++, x++) {
        if (key !== 's') {
          a.px(ox + x, oy + y, CODE[key]);
          bright.push([x, y]);
        }
      }
    }
    if (i === 5) {
      // the cursor blinks on frames 0 and 2
      if (frame !== 1 && x < 20) {
        a.rect(ox + x + 1, oy + y - 1, 1, 2, '#c8f5d8');
      }
    }
  });
  // soft glow: a dim mint halo under and beside every lit glyph pixel
  const lit = new Set(bright.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of bright) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 20 || ny > 12 || lit.has(`${nx},${ny}`)) {
        continue;
      }
      a.px(ox + nx, oy + ny, '#6dffb526');
    }
  }
  // glass glare in the top-left corner
  a.px(ox, oy, '#ffffff66');
  a.px(ox + 1, oy, '#ffffff40');
  a.px(ox, oy + 1, '#ffffff40');
}

/** The idle screen: the gray #8a8f99 family with a diagonal glare. */
function screenOff(a: Art, ox: number, oy: number): void {
  a.rect(ox, oy, 21, 13, '#8a8f99');
  a.rect(ox, oy + 11, 21, 2, '#7f848e');
  for (let k = 0; k < 9; k++) {
    a.px(ox + 2 + k, oy + 8 - k, '#9ba0a9');
    a.px(ox + 3 + k, oy + 8 - k, '#9ba0a9');
    a.px(ox + 7 + k, oy + 10 - k, '#959aa3');
  }
  a.px(ox, oy, '#b4b8c0');
  a.px(ox + 1, oy, '#a5aab3');
  a.px(ox, oy + 1, '#a5aab3');
}

function pcFront(on: boolean, frame = 0): Canvas {
  const a = new Art(32, 64);
  const pal = on ? MON_PAL : { ...MON_PAL, x: '#a3a8b1', y: '#787d87', L: '#a39b8a', l: '#c4bdae' };
  a.stamp(MONITOR, pal, 0, 0);
  if (on) {
    screenOn(a, 5, 4, frame);
  } else {
    screenOff(a, 5, 4);
  }
  a.stamp(KEYBOARD, KEYS_PAL, 1, 36);
  a.stamp(MOUSE, KEYS_PAL, 25, 37);
  return a.c;
}

/** The monitor seen from behind: a rounded cream casing with vents, the stand, the keyboard's far edge. */
function pcBack(): Canvas {
  const a = new Art(32, 64);
  pillow(a, 3, 12, 26, 18, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 3,
  });
  // raised center housing with vent slots
  pillow(a, 9, 15, 14, 11, '#ddd7c8', {
    light: '#f1ece0',
    dark: '#bdb6a6',
    line: '#a39b8a',
    round: 2,
  });
  for (let y = 18; y < 24; y += 2) {
    a.rect(11, y, 10, 1, '#a39b8a');
  }
  // stand and base
  a.rect(13, 30, 6, 4, '#5a544a');
  a.rect(14, 30, 4, 4, '#c4bdae');
  a.rect(14, 30, 1, 4, '#e8e3d6');
  pillow(a, 8, 33, 16, 4, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 1,
  });
  // keyboard far edge and mouse
  pillow(a, 2, 40, 22, 5, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 1,
  });
  a.rect(4, 42, 18, 1, '#c4bdae');
  pillow(a, 26, 40, 5, 5, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 1,
  });
  return a.c;
}

/** Side view, screen facing left (the art is mirrored at runtime for the other side). */
function pcSide(): Canvas {
  const a = new Art(32, 64);
  // casing: deeper toward the back (right)
  pillow(a, 12, 6, 15, 22, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 3,
  });
  pillow(a, 20, 9, 8, 16, '#ddd7c8', {
    light: '#ece6da',
    dark: '#bdb6a6',
    line: '#5a544a',
    round: 2,
  });
  for (let y = 12; y < 22; y += 3) {
    a.rect(22, y, 4, 1, '#a39b8a');
  }
  // the screen glass seen edge-on, with its bezel
  a.rect(10, 7, 3, 20, '#5a544a');
  a.rect(11, 8, 1, 18, '#2a4a4a');
  a.rect(12, 8, 1, 18, '#a39b8a');
  // stand and base
  a.rect(16, 28, 6, 4, '#5a544a');
  a.rect(17, 28, 4, 4, '#c4bdae');
  a.rect(17, 28, 1, 4, '#e8e3d6');
  pillow(a, 9, 32, 19, 5, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 1,
  });
  // keyboard, seen from its side
  pillow(a, 2, 40, 16, 5, '#e8e3d6', {
    light: '#fbf7ee',
    dark: '#c4bdae',
    line: '#5a544a',
    round: 1,
  });
  for (let x = 4; x < 16; x += 2) {
    a.px(x, 41, '#c4bdae');
  }
  return a.c;
}

export function buildPcs(out: SpriteSet): void {
  checkMaps();
  out['PC/PC_FRONT_OFF.png'] = pcFront(false);
  for (let i = 0; i < 3; i++) {
    out[`PC/PC_FRONT_ON_${i + 1}.png`] = pcFront(true, i);
  }
  out['PC/PC_BACK.png'] = pcBack();
  out['PC/PC_SIDE.png'] = pcSide();
}

// ---------------------------------------------------------------------------
// Chairs and stools
// ---------------------------------------------------------------------------

const CREAM = '#f4e6c6';

/** A turned wood rail: dark edge, lit top, darker underside. */
function rail(a: Art, x: number, y: number, w: number, h: number): void {
  a.rect(x + 1, y, w - 2, 1, WOOD.edge);
  a.rect(x, y + 1, w, h - 1, WOOD.edge);
  a.rect(x + 1, y + 1, w - 2, h - 2, WOOD.M);
  a.rect(x + 2, y + 1, w - 4, 1, WOOD.rim);
  a.rect(x + 1, y + 2, w - 2, 1, WOOD.L);
  a.rect(x + 1, y + h - 2, w - 2, 1, WOOD.D);
}

/** A cream seat cushion with piping and a tuft. */
function cushion(a: Art, x: number, y: number, w: number, h: number): void {
  pillow(a, x, y, w, h, CREAM, { light: '#fff6e2', dark: '#dcc79c', line: '#8a6a44', round: 2 });
  const cx = x + Math.floor(w / 2);
  a.px(cx - 1, y + Math.floor(h / 2), '#c9b183');
  a.px(cx, y + Math.floor(h / 2), '#dcc79c');
}

function woodenChairFront(): Canvas {
  const a = new Art(32, 64);
  // back legs, behind and a little in
  woodLeg(a, 8, 48, 4, 8);
  woodLeg(a, 20, 48, 4, 8);
  // backrest: posts, a center splat and the curved top rail
  for (const px of [4, 23]) {
    woodLeg(a, px, 22, 5, 16);
  }
  woodLeg(a, 13, 24, 6, 13);
  a.rect(14, 26, 1, 9, WOOD.L);
  rail(a, 4, 18, 24, 7);
  // seat: wood frame and a cream cushion
  rail(a, 4, 36, 24, 4);
  cushion(a, 4, 38, 24, 9);
  woodApron(a, 4, 46, 24, 4);
  // front legs
  woodLeg(a, 4, 49, 5, 9);
  woodLeg(a, 23, 49, 5, 9);
  return a.c;
}

function woodenChairBack(): Canvas {
  const a = new Art(32, 64);
  // legs first: the seat and backrest cover their tops
  woodLeg(a, 4, 48, 5, 10);
  woodLeg(a, 23, 48, 5, 10);
  woodLeg(a, 9, 48, 4, 7);
  woodLeg(a, 19, 48, 4, 7);
  // seat seen from behind
  woodApron(a, 4, 44, 24, 6);
  // spindles between the posts (the agent shows through the gaps)
  for (const px of [4, 23]) {
    woodLeg(a, px, 32, 5, 13);
  }
  woodLeg(a, 13, 33, 6, 11);
  a.rect(14, 34, 1, 9, WOOD.L);
  rail(a, 4, 30, 24, 5);
  return a.c;
}

function woodenChairSide(): Canvas {
  const a = new Art(32, 64);
  // legs: the back one under the backrest, the front one under the seat edge
  woodLeg(a, 3, 44, 5, 12);
  woodLeg(a, 18, 44, 5, 12);
  // seat
  cushion(a, 6, 36, 18, 7);
  woodApron(a, 3, 42, 21, 4);
  // backrest post rising on the left
  woodLeg(a, 2, 22, 6, 22);
  a.rect(2, 21, 6, 1, WOOD.edge);
  a.rect(3, 22, 4, 1, WOOD.rim);
  return a.c;
}

const ARM = { base: '#c0563f', light: '#d9745a', dark: '#8f3a2a', line: '#5a2218' };

/** The arm rests reach columns 0 and 31: they must show beside a seated agent's arms. */
function cushionedFront(): Canvas {
  const a = new Art(32, 32);
  for (const lx of [4, 23]) {
    woodLeg(a, lx, 23, 5, 6);
  }
  pillow(a, 4, 0, 24, 12, ARM.base, { light: ARM.light, dark: ARM.dark, line: ARM.line, round: 3 });
  // tufting on the backrest
  for (const tx of [10, 16, 22]) {
    a.px(tx - 1, 5, ARM.dark);
    a.px(tx - 1, 6, shade(ARM.dark, 0.2));
  }
  pillow(a, 5, 9, 22, 14, ARM.base, { light: ARM.light, dark: ARM.dark, line: ARM.line, round: 2 });
  a.rect(7, 19, 18, 1, ARM.dark);
  for (const ax of [0, 25]) {
    pillow(a, ax, 8, 7, 16, ARM.base, {
      light: ARM.light,
      dark: ARM.dark,
      line: ARM.line,
      round: 2,
    });
    a.rect(ax + 2, 9, 3, 1, '#e99a7f');
  }
  return a.c;
}

function cushionedBack(): Canvas {
  const a = new Art(32, 32);
  for (const lx of [4, 23]) {
    woodLeg(a, lx, 22, 5, 6);
  }
  pillow(a, 2, 8, 28, 16, ARM.base, { light: ARM.light, dark: ARM.dark, line: ARM.line, round: 3 });
  a.rect(5, 11, 22, 1, '#e99a7f');
  a.rect(4, 20, 24, 1, ARM.dark);
  // a seam down the back
  a.rect(16, 12, 1, 8, shade(ARM.base, -0.12));
  return a.c;
}

function cushionedSide(): Canvas {
  const a = new Art(32, 32);
  for (const lx of [3, 19]) {
    woodLeg(a, lx, 16, 5, 10);
  }
  pillow(a, 2, 6, 24, 12, ARM.base, { light: ARM.light, dark: ARM.dark, line: ARM.line, round: 2 });
  a.rect(4, 14, 20, 1, ARM.dark);
  pillow(a, 0, 0, 11, 18, ARM.base, { light: ARM.light, dark: ARM.dark, line: ARM.line, round: 3 });
  a.rect(2, 2, 2, 12, '#e99a7f');
  return a.c;
}

/** A plain wood stool, 32x32. */
function woodenBench(): Canvas {
  const a = new Art(32, 32);
  woodLeg(a, 6, 18, 5, 12);
  woodLeg(a, 21, 18, 5, 12);
  a.rect(9, 24, 14, 2, WOOD.edge);
  a.rect(10, 24, 12, 1, WOOD.D);
  woodTop(a, 4, 8, 24, 9, 17, { plank: 4 });
  woodApron(a, 4, 16, 24, 4);
  return a.c;
}

/** A round sage pouf on short legs, 32x32. */
function cushionedBench(): Canvas {
  const a = new Art(32, 32);
  woodLeg(a, 7, 22, 4, 8);
  woodLeg(a, 21, 22, 4, 8);
  pillow(a, 4, 8, 24, 16, '#6fa374', {
    light: '#88c58e',
    dark: '#487841',
    line: '#24401f',
    round: 5,
  });
  a.rect(7, 17, 18, 1, '#5c9162');
  a.px(15, 13, '#487841');
  a.px(16, 13, '#5c9162');
  return a.c;
}

export function buildChairs(out: SpriteSet): void {
  out['WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png'] = woodenChairFront();
  out['WOODEN_CHAIR/WOODEN_CHAIR_BACK.png'] = woodenChairBack();
  out['WOODEN_CHAIR/WOODEN_CHAIR_SIDE.png'] = woodenChairSide();
  out['CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png'] = cushionedFront();
  out['CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png'] = cushionedBack();
  out['CUSHIONED_CHAIR/CUSHIONED_CHAIR_SIDE.png'] = cushionedSide();
  out['WOODEN_BENCH/WOODEN_BENCH.png'] = woodenBench();
  out['CUSHIONED_BENCH/CUSHIONED_BENCH.png'] = cushionedBench();
}

/** Fail loudly when a pixel map is ragged. */
function checkMaps(): void {
  assertRect('MONITOR', MONITOR, 32, 29);
  assertRect('KEYBOARD', KEYBOARD, 22, 7);
  assertRect('MOUSE', MOUSE, 6, 6);
}
