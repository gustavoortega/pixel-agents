/** Cozy plants, small props, sofas, shelves and wall decor. Same rules as furniture.ts. */

import type { Palette } from './canvas';
import { Canvas, mirror } from './canvas';
import type { SpriteSet } from './furniture';
import { box, make, rect } from './furniture';

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

const LEAF: Palette = {
  v: '#2d6a38',
  g: '#3f8f4a',
  G: '#5fb85a',
  l: '#8fd67a',
  P: '#c0643a',
  p: '#9a4a28',
  q: '#e08a5a',
  z: '#5a3a22',
};

/** Left half of a leafy crown (8 cols, 19 rows), mirrored to 16 wide. */
const CROWN_HALF = [
  '.......v',
  '.....vvG',
  '....vGGl',
  '..vvGGlG',
  '.vGGGGGG',
  '.vGlGGGg',
  'vGGGGgGG',
  'vGlGGGGG',
  'vGGGGGgG',
  '.vGGgGGG',
  '.vGGGGGg',
  '..vGGgGG',
  '..vvGGGG',
  '...vgGGG',
  '....vvGg',
  '.....vvg',
  '.......g',
  '.......g',
  '.......g',
];

const CROWN = mirror(CROWN_HALF);

const POT_TERRACOTTA = [
  '..OOOOOOOOOOOO..',
  '..OqqqqqqqqqqO..',
  '..OPPPPPPPPPPO..',
  '..OOOOOOOOOOOO..',
  '...OPPPPPPPPO...',
  '...OPqPPPPPPO...',
  '...OPqPPPPPpO...',
  '...OPPPPPPPpO...',
  '...OPPPPPPppO...',
  '....OPPPPppO....',
  '....OOOOOOOO....',
  '....SSSSSSSS....',
];

const POT_CREAM = POT_TERRACOTTA.map((r) => r);

function plant(variant: 1 | 2): Canvas {
  const c = new Canvas(16, 32);
  c.stamp(CROWN, LEAF, 0, 0);
  if (variant === 2) {
    // a flowering plant: pink blooms with a yellow heart
    for (const [x, y] of [
      [3, 4],
      [11, 6],
      [6, 9],
      [12, 11],
      [4, 12],
    ]) {
      c.set(x, y, '#ff8fab');
      c.set(x + 1, y, '#ff8fab');
      c.set(x, y + 1, '#ff8fab');
      c.set(x + 1, y + 1, '#ffd166');
    }
    c.stamp(
      POT_CREAM,
      { ...LEAF, O: '#3b2412', q: '#fff4dc', P: '#f1dfbd', p: '#d4bb90', S: '#00000033' },
      0,
      19,
    );
    // blue stripe on the pot
    rect(c, 4, 25, 8, 1, '#6b9ad6');
  } else {
    c.stamp(POT_TERRACOTTA, { ...LEAF, O: '#3b2412', S: '#00000033' }, 0, 19);
  }
  return c;
}

function largePlant(): Canvas {
  const c = new Canvas(32, 48);
  const pal = { ...LEAF };
  c.stamp(CROWN, pal, 8, 7);
  c.stamp(CROWN, pal, 0, 13);
  c.stamp(CROWN, pal, 16, 13);
  // wide pot, rows 33..46
  box(c, 4, 33, 24, 4, '#c0643a', '#3b2412');
  rect(c, 5, 34, 22, 1, '#e08a5a');
  box(c, 6, 37, 20, 9, '#c0643a', '#3b2412');
  rect(c, 8, 38, 2, 6, '#e08a5a');
  rect(c, 22, 39, 3, 6, '#9a4a28');
  rect(c, 7, 46, 18, 1, '#3b2412');
  rect(c, 8, 47, 16, 1, '#00000033');
  return c;
}

// ---------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------

const BIN = [
  '...OOOOOOOOOO...',
  '...OXWXXXXWXO...',
  '...OLLLLLLLLO...',
  '...OMMMMMMMMO...',
  '...OMDMMMMDMO...',
  '...OMDMMMMDMO...',
  '...OMDMMMMDMO...',
  '...OMDMMMMDMO...',
  '....OMMMMMMO....',
  '....OMDMMDMO....',
  '....OMDMMDMO....',
  '....OMMMMMMO....',
  '....OOOOOOOO....',
];

const MUG = ['.w..w...', '.oooo...', 'oWccWo..', 'oWWWWoo.', 'oWWWWo.o', 'oWWWWoo.', '.oooo...'];

// ---------------------------------------------------------------------------
// Sofa
// ---------------------------------------------------------------------------

const SOFA = { T: '#4f8f86', t: '#6fb0a6', n: '#366a63', O: '#2a1a12' };

function sofaFront(): Canvas {
  const c = new Canvas(32, 16);
  box(c, 2, 0, 28, 9, SOFA.T, SOFA.O);
  rect(c, 3, 1, 26, 1, SOFA.t);
  for (const x of [8, 15, 22]) {
    c.set(x, 4, SOFA.n);
    c.set(x, 5, SOFA.n);
  }
  box(c, 0, 5, 5, 9, SOFA.T, SOFA.O);
  box(c, 27, 5, 5, 9, SOFA.T, SOFA.O);
  rect(c, 1, 6, 1, 6, SOFA.t);
  rect(c, 28, 6, 1, 6, SOFA.t);
  box(c, 4, 8, 24, 6, SOFA.t, SOFA.O);
  rect(c, 15, 9, 1, 4, SOFA.O);
  rect(c, 5, 12, 22, 1, SOFA.T);
  rect(c, 2, 14, 2, 1, '#7a4b2b');
  rect(c, 28, 14, 2, 1, '#7a4b2b');
  rect(c, 2, 15, 28, 1, '#00000033');
  return c;
}

function sofaBack(): Canvas {
  const c = new Canvas(32, 16);
  box(c, 0, 2, 32, 12, SOFA.T, SOFA.O);
  rect(c, 1, 3, 30, 1, SOFA.t);
  rect(c, 2, 10, 28, 1, SOFA.n);
  rect(c, 15, 4, 1, 6, SOFA.O);
  rect(c, 2, 14, 2, 1, '#7a4b2b');
  rect(c, 28, 14, 2, 1, '#7a4b2b');
  rect(c, 2, 15, 28, 1, '#00000033');
  return c;
}

function sofaSide(): Canvas {
  // faces right: backrest on the left, seat to the right
  const c = new Canvas(16, 32);
  box(c, 0, 1, 5, 29, SOFA.T, SOFA.O);
  rect(c, 1, 2, 1, 26, SOFA.t);
  box(c, 4, 5, 9, 25, SOFA.t, SOFA.O);
  rect(c, 5, 17, 7, 1, SOFA.O);
  rect(c, 5, 27, 7, 1, SOFA.T);
  rect(c, 1, 30, 2, 1, '#7a4b2b');
  rect(c, 10, 30, 2, 1, '#7a4b2b');
  rect(c, 1, 31, 12, 1, '#00000033');
  return c;
}

// ---------------------------------------------------------------------------
// Bookshelves
// ---------------------------------------------------------------------------

const BOOKS = ['#c0563f', '#3d6fd1', '#48a46f', '#e0c15a', '#7a5ad1', '#d65d73', '#5ec2d6', '#8a5a32'];

/** One shelf of books inside x..x+w, standing on row `floorY`, up to `maxH` tall. */
function bookRow(c: Canvas, x: number, floorY: number, w: number, maxH: number, seed: number): void {
  let cx = x;
  let i = seed;
  while (cx < x + w) {
    const bw = 2 + ((i * 7) % 2);
    const bh = maxH - ((i * 5) % 3);
    if (cx + bw > x + w) {
      break;
    }
    rect(c, cx, floorY - bh + 1, bw, bh, '#3b2412');
    rect(c, cx + 1, floorY - bh + 2, bw - 1, bh - 2, BOOKS[i % BOOKS.length]);
    c.set(cx + 1, floorY - bh + 2, '#ffffff55');
    cx += bw;
    i += 3;
  }
}

function bookshelf(): Canvas {
  const c = new Canvas(32, 16);
  box(c, 0, 6, 32, 10, '#b8783f', '#3b2412');
  rect(c, 1, 7, 30, 1, '#e0a86a');
  rect(c, 1, 8, 30, 7, '#5a3a22');
  bookRow(c, 2, 14, 28, 6, 1);
  rect(c, 1, 15, 30, 1, '#9a6233');
  return c;
}

function doubleBookshelf(): Canvas {
  const c = new Canvas(32, 32);
  box(c, 0, 6, 32, 18, '#b8783f', '#3b2412');
  rect(c, 1, 7, 30, 1, '#e0a86a');
  rect(c, 1, 8, 30, 15, '#5a3a22');
  bookRow(c, 2, 14, 28, 6, 2);
  rect(c, 1, 15, 30, 1, '#9a6233');
  bookRow(c, 2, 22, 28, 6, 5);
  rect(c, 1, 23, 30, 1, '#9a6233');
  return c;
}

// ---------------------------------------------------------------------------
// Wall decor
// ---------------------------------------------------------------------------

function clock(): Canvas {
  const c = new Canvas(16, 32);
  const rows = [
    '..oooooooo..',
    '.oWWMWWWWWo.',
    'oWWWWOWWWWWo',
    'oWWWWOWWWWWo',
    'oMWWWOOOWWMo',
    'oWWWWWWWWWWo',
    'oWWWWWWWWWWo',
    'oWWWWMWWWWWo',
    '.oWWWWWWWWo.',
    '..oooooooo..',
  ];
  c.stamp(rows, { o: '#3b2412', W: '#fff4dc', M: '#b8783f', O: '#2a1a12' }, 2, 11);
  return c;
}

function whiteboard(): Canvas {
  const c = new Canvas(32, 32);
  box(c, 2, 8, 28, 16, '#fbf7ee', '#6b4128');
  rect(c, 3, 9, 26, 1, '#ffffff');
  // scribbles
  rect(c, 5, 11, 10, 1, '#3d6fd1');
  rect(c, 5, 13, 7, 1, '#3d6fd1');
  rect(c, 5, 15, 12, 1, '#c0563f');
  rect(c, 20, 11, 6, 4, '#48a46f');
  rect(c, 21, 12, 4, 2, '#fbf7ee');
  rect(c, 19, 17, 8, 1, '#7a5ad1');
  rect(c, 5, 18, 5, 1, '#3d6fd1');
  // marker tray
  rect(c, 6, 23, 20, 1, '#8a5a32');
  rect(c, 9, 22, 3, 1, '#c0563f');
  rect(c, 13, 22, 3, 1, '#3d6fd1');
  return c;
}

function smallPainting(variant: 1 | 2): Canvas {
  const c = new Canvas(16, 32);
  box(c, 2, 12, 12, 14, '#b8783f', '#3b2412');
  rect(c, 3, 13, 10, 12, variant === 1 ? '#8fb8de' : '#f6e3bd');
  if (variant === 1) {
    rect(c, 3, 19, 10, 6, '#6b9a52');
    rect(c, 3, 21, 10, 4, '#4f8a45');
    rect(c, 9, 14, 3, 3, '#fff1b8');
    rect(c, 5, 17, 4, 2, '#6b9a52');
  } else {
    rect(c, 5, 14, 6, 6, '#ff8fab');
    rect(c, 7, 16, 2, 2, '#ffd166');
    rect(c, 7, 20, 2, 4, '#5fb85a');
    rect(c, 5, 22, 3, 1, '#5fb85a');
  }
  rect(c, 3, 13, 10, 1, '#ffffff33');
  return c;
}

function largePainting(): Canvas {
  const c = new Canvas(32, 32);
  box(c, 2, 12, 28, 14, '#b8783f', '#3b2412');
  rect(c, 3, 13, 26, 5, '#6a8fd8');
  rect(c, 3, 18, 26, 4, '#f7a26b');
  rect(c, 3, 22, 26, 3, '#ffd58a');
  rect(c, 21, 17, 4, 4, '#fff1b8');
  // hills
  for (let x = 3; x < 29; x++) {
    const h = 3 + Math.round(2 * Math.sin(x / 3.2) + Math.cos(x / 5.1));
    rect(c, x, 25 - h, 1, h, x % 9 < 4 ? '#4f8a45' : '#3f7a3a');
  }
  rect(c, 3, 13, 26, 1, '#ffffff33');
  return c;
}


// ---------------------------------------------------------------------------
// Light fixtures: window, floor lamp, fairy lights
// ---------------------------------------------------------------------------

/** Wall window, 2x2 tiles: wood frame, daylight sky, far hills, a cross mullion and a sill. */
function windowPane(): Canvas {
  const c = new Canvas(32, 32);
  box(c, 1, 3, 30, 26, '#8a5a32', '#3b2412');
  rect(c, 3, 5, 26, 22, '#8fc4ea');
  // sky bands, lighter toward the horizon
  rect(c, 3, 5, 26, 6, '#7fb6e2');
  rect(c, 3, 17, 26, 6, '#b8dcf2');
  // sun glint and a cloud
  rect(c, 22, 8, 3, 3, '#fff1b8');
  rect(c, 6, 10, 6, 2, '#ffffff');
  rect(c, 8, 9, 4, 1, '#ffffff');
  // ground, then two tones of hills
  rect(c, 3, 23, 26, 4, '#6b9a52');
  for (let x = 3; x < 29; x++) {
    const far = 4 + Math.round(2 * Math.sin(x / 3.6) + Math.cos(x / 5.3));
    rect(c, x, 23 - far, 1, far, '#6b9a52');
    const near = 2 + Math.round(Math.sin(x / 2.4 + 1));
    rect(c, x, 27 - near, 1, near, '#4f8a45');
  }
  // cross mullion
  rect(c, 15, 5, 2, 22, '#7a4b2b');
  rect(c, 3, 15, 26, 2, '#7a4b2b');
  rect(c, 15, 5, 1, 22, '#9b6338');
  rect(c, 3, 15, 26, 1, '#9b6338');
  // glass sheen
  rect(c, 4, 6, 1, 8, '#ffffff66');
  rect(c, 18, 6, 1, 8, '#ffffff66');
  // frame highlight and sill
  rect(c, 2, 4, 28, 1, '#c18a52');
  box(c, 0, 28, 32, 3, '#9b6338', '#3b2412');
  rect(c, 1, 29, 30, 1, '#c18a52');
  rect(c, 1, 31, 30, 1, '#00000033');
  return c;
}

/** Floor lamp, 1x2 tiles: warm shade on a thin pole over a round base. */
function floorLamp(): Canvas {
  const c = new Canvas(16, 32);
  const shade = [
    '...OOOOOOOO...',
    '..OyyyyyyyyO..',
    '..OyYYYYYYyO..',
    '.OyYYYYYYYYyO.',
    '.OyYYYYYYYYyO.',
    '.OyYYYYYYYYyO.',
    '.OOOOOOOOOOOO.',
  ];
  c.stamp(shade, { O: '#3b2412', y: '#e8c27a', Y: '#fff1b8' }, 1, 2);
  // bulb glow under the shade
  rect(c, 6, 9, 4, 1, '#fff1b8');
  // pole
  rect(c, 7, 10, 2, 17, '#3b2412');
  rect(c, 7, 10, 1, 17, '#7a4b2b');
  // base
  box(c, 3, 27, 10, 3, '#7a4b2b', '#3b2412');
  rect(c, 4, 28, 8, 1, '#9b6338');
  rect(c, 3, 30, 10, 1, '#00000033');
  return c;
}

/** Fairy lights, 4x1 tiles: a sagging wire with warm bulbs every 8 px. */
function fairyLights(): Canvas {
  const c = new Canvas(64, 16);
  const BULBS = ['#ffd166', '#ff8fab', '#8fd67a', '#8fc4ea'];
  const sag = (x: number): number => 1 + Math.round(4 * Math.sin((Math.PI * x) / 63));
  for (let x = 0; x < 64; x++) {
    c.set(x, sag(x), '#4a3020');
  }
  for (let i = 0; i < 8; i++) {
    const x = 3 + i * 8;
    const y = sag(x) + 1;
    const col = BULBS[i % BULBS.length];
    rect(c, x, y, 2, 3, col);
    c.set(x, y, '#ffffffaa');
    rect(c, x, y + 3, 2, 1, '#00000033');
  }
  return c;
}

// ---------------------------------------------------------------------------

export function buildDecor(out: SpriteSet): void {
  out['PLANT/PLANT.png'] = plant(1);
  out['PLANT_2/PLANT_2.png'] = plant(2);
  out['LARGE_PLANT/LARGE_PLANT.png'] = largePlant();
  make(out, 'BIN/BIN.png', 16, 16, ['................', '................', ...BIN.slice(0, 13), '.'.repeat(16)].slice(0, 16), { W: '#fff4dc' }, 0);
  make(out, 'COFFEE/COFFEE.png', 16, 16, [
    ...MUG.map((r) => '........' + r),
    ...Array.from({ length: 9 }, () => '.'.repeat(16)),
  ], { W: '#f6efe2', c: '#8a4b2a', o: '#3b2412', w: '#ffffffaa' });
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
