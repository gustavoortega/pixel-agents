/**
 * ONE cozy chibi, authored as pixel maps at art density 2 (2 art px per world px), drawn into the
 * 224x256 character sheet the app loads: 7 frames x 32 px wide, 4 rows x 64 px tall.
 *
 *   rows:   0 = down, 1 = up (back view, how seated agents are seen), 2 = right (left is a runtime flip),
 *           3 = idle poses, front view only (see below)
 *   frames: 0 walk1, 1 walk2 (also idle), 2 walk3, 3 type1, 4 type2, 5 read1, 6 read2
 *   row 3:  0 sit-idle, 1 nap (head on folded arms), 2 page-turn A, 3 page-turn B, 4 nap breathing in
 *           (shoulders 1 px up), 5 sip (one hand up at the chest for the mug); column 6 is transparent
 *
 * Landmarks are the 1x sheet's rows times two (head top 6, shoulders 30, legs 44, feet on row 57), so
 * every world-px constant of the engine (sitting offset, desk cover, plates) still lines up.
 *
 * The book and the mug an idle agent holds are NOT in the sheet: they are palette-free overlays the
 * renderer draws on top, so every palette shares them. No drop shadow either: the engine draws it.
 *
 * char_0..11 are palette swaps of that single base (hair, skin, outfit).
 *
 * Map legend:
 *   O hair outline  d hair dark  h hair  H hair light  j highlight strand  b brow
 *   K skin outline  N skin deep  S skin shade  s skin  c blush  m mouth
 *   e eye dark  i iris  I iris light  w eye shine
 *   U outfit outline  u outfit dark (folds)  t outfit  T outfit light  q collar  Q collar shade
 *   n pants outline  v pants dark  p pants  P pants light  y shoe outline  z shoe  Z shoe light
 *   g book outline  k book cover  l book cover light  W book page  x text line  X page shade
 */

import { EYE_COLORS, SKIN_RAMPS } from '../../core/src/assets/skinTones';
import type { Palette } from './canvas';
import { assertRect, Canvas, shade } from './canvas';

/** Art px per world px. */
export const DENSITY = 2;
export const FRAME_W = 32;
export const FRAME_H = 64;
export const FRAMES = 7;
/** Frames in the idle row (row 3); the decoder appends them to `down` as frames 7..12. */
export const IDLE_FRAMES = 6;
export const DIRS = ['down', 'up', 'right'] as const;
export type Dir = (typeof DIRS)[number];
/** Sheet rows: one per direction plus the idle row. */
export const SHEET_ROWS = DIRS.length + 1;

// Frame rows where the layers sit.
export const HEAD_Y = 6;
export const TORSO_Y = 30;
const LEGS_Y = 44;
/** One world px of walk bob. */
const BOB = 2;

/** `content` starting at column `left`, padded with transparent pixels to the frame width. */
export function at(left: number, content: string, width = FRAME_W): string {
  const r = '.'.repeat(left) + content;
  if (r.length > width) {
    throw new Error(`row overflows ${width} px: ${r}`);
  }
  return r + '.'.repeat(width - r.length);
}

// ---------------------------------------------------------------------------
// Heads (24 rows, rows 6..29)
// ---------------------------------------------------------------------------

/** Front view: fringe parted to the right, 4x4 eyes with a top-left shine, brows, smile, blush. */
const HEAD_DOWN = [
  '..........ddddOOOOOOOO..........',
  '.......dddhHHHHHHhhhhhOOO.......',
  '.....ddhHHHjjHHHhhdhhhhhhOO.....',
  '....dhHHHjjHHHhhhhhdhhhhhhdO....',
  '...dhHHjjHHhhhhhhhhhdhhhhhhdO...',
  '...OHHjjHHhhhhHhhhhhhdhhhhhdO...',
  '..OhHjjHHhhhHhhhhhhhhhdhhhhddO..',
  '..OHHjHHhhhhhhhhhhhhhhhdhhhddO..',
  '..OHHhhhhdhhhhdhhhdhhdhhhhhddO..',
  '..OHhhhhhdhhhhdhhhdhhdhhhhhddO..',
  '..OHhdhhdSddhdSdhdSddSddhhdhdO..',
  '..OHhdhhSsSSdSsSdSsSSsSShhdhdO..',
  '..OHhdhdbbbsSsssSssssbbbdhdhdO..',
  '..OHhddSssssssssssssssssSddhdO..',
  '..OHhdSseeeesssssssseeeesSdhdO..',
  '..OHhdSsewiessssssssewiesSdhdO..',
  '..OHhdSseiIesssssssseiIesSdhdO..',
  '..OhhdSsseesssssssssseessSdhdO..',
  '...OhdScccsssssssssssscccSdhO...',
  '....OdSsssssssmssmsssssssSdO....',
  '.....OKSsssssssmmsssssssSKO.....',
  '.......KSssssssssssssssSK.......',
  '........KSSssssssssssSSK........',
  '.........KKKKNNNNNNKKKK.........',
];

/** Back of the head: crown highlight, strands falling from the crown, a ragged hem over the nape. */
const HEAD_UP = [
  '..........ddddOOOOOOOO..........',
  '.......dddhHHHHHHhhhhhOOO.......',
  '.....ddhHHHjjHHHhhdhhhhhhOO.....',
  '....dhHHHjjHHHhhhhhdhhhhhhdO....',
  '...dhHHjjHHhhhhhhhhhdhhhhhhdO...',
  '...OHHjjHHhhhhHhhhhhhdhhhhhdO...',
  '..OhHjjHHhhhHhhhhhhhhhdhhhhddO..',
  '..OHHjHHhhhhhhhhhhhhhhhdhhhddO..',
  at(2, 'OHjjjjHHhjjjjHhhjjjhhhhjhddO'),
  at(2, 'OHHjjHHhhHjjHhhhHjhhhhhhhddO'),
  at(2, 'OHHhhhdHHhhhdHhhhdhhhhdhhddO'),
  at(2, 'OHhhhhdHhhhhdHhhhhdhhhhdhddO'),
  at(2, 'OHhhhdHhhhhdHhhhhhdhhhhdhddO'),
  at(2, 'OHhhhdHhhhhdhHhhhhdhhhhhdddO'),
  at(2, 'OHhhdHhhhhhdhHhhhhhdhhhhdddO'),
  at(2, 'OHhhdHhhhhdhhHhhhhhdhhhhdddO'),
  at(2, 'OHhdHhhhhhdhhhHhhhhhdhhhdddO'),
  at(2, 'OhhdHhhhhdhhhhHhhhhhdhhddddO'),
  at(3, 'OhdHhhhhdhhhhHhhhhdhhddddO'),
  at(4, 'OdHhhhdhhhhdHhhhhdhddddO'),
  at(5, 'OdhhdhhhdhhhdhhhdhdddO'),
  at(7, 'OdOOddKNNNNKddOOdO'),
  at(13, 'KNNNNK'),
  at(13, 'KSNNSK'),
];

/** Facing right: hair over the back and top, fringe tips over the forehead, ear, profile eye, nose. */
const HEAD_RIGHT = [
  at(9, 'ddddOOOOOOO'),
  at(6, 'dddhHHHHHHhhhhOOO'),
  at(4, 'ddhHHHjjHHHhhhhhhhhOO'),
  at(3, 'dhHHjjHHHhhhhhhhhhhhhhO'),
  at(3, 'dHHjjHHhhhhhhhhhhhhhhhdO'),
  at(2, 'dhHjjHHhhhhHhhhhhhhhhhhhdO'),
  at(2, 'OHHjHHhhhhHhhhhhhhhhhhhhhdO'),
  at(2, 'OHHjHhhhhhhhhhhhhhhhhhhhddO'),
  at(2, 'OHHhhhhdhhhhhhhhhhhdhhhhhddO'),
  at(2, 'OHhhhhhdhhhhhhhhhhdhhhhdhhdO'),
  at(2, 'OHhhhhdhhhhhhhhhdhhhdhhhdhdO'),
  at(2, 'OHhhhhdhhhhhhhd' + 'hdShdSShdShdO'),
  at(2, 'OHhhhdhhhhhhhdd' + 'SsSSsSSsSSssK'),
  at(2, 'OHhhhdhhhhhhd' + 'hd' + 'K' + 'sssssbbbbssK'),
  at(2, 'OHhhdhhhhhhdh' + 'dKSK' + 'ssssseeessK'),
  at(2, 'OHhhdhhhhhdhh' + 'dKNS' + 'sssssewissK'),
  at(2, 'OHhdhhhhhdhhh' + 'dKNS' + 'ssssseiIsssK'),
  at(2, 'OHhdhhhhdhhhh' + 'dKSs' + 'sssssseessSK'),
  at(2, 'OHhdhhhhdhhhhd' + 'dK' + 'ssscccsssssK'),
  at(3, 'Ohdhhhhdhhhdd' + 'NSssscccssssmK'),
  at(4, 'OddOOddOOO' + 'KNNSssssssssmsK'),
  at(14, 'KNNSSsssssssKK'),
  at(15, 'KNNNSSssKKK'),
  at(16, 'KNNNNKK'),
];

/**
 * Napping head, resting on the folded arms: the front head leaned to one side (a shear of one column
 * every four rows), a lock of hair over the left eye, the right eye closed to a 3 px down-curve and its
 * blush showing. The arms, drawn after it, hide the mouth: the cheek lies on the sleeve.
 */
function napHead(): string[] {
  const g = HEAD_DOWN.map((r) => r.split(''));
  // close the right eye: skin, then a 3 px curve dipping in the middle
  for (let y = 14; y <= 17; y++) for (let x = 20; x <= 23; x++) g[y][x] = 's';
  g[15][20] = 'e';
  g[16][21] = 'e';
  g[15][22] = 'e';
  g[14][19] = 'S';
  // a lock of hair falls over the left eye and its blush
  for (let y = 12; y <= 18; y++) {
    for (let x = 6; x <= 11; x++) {
      if (y === 18 && (x < 7 || x > 10)) continue;
      g[y][x] = x === 6 ? 'H' : x === 9 || y === 18 ? 'd' : 'h';
    }
  }
  return g.map((row, y) => {
    const shift = Math.round((y - 12) / 4);
    const r = row.join('');
    return shift >= 0
      ? ('.'.repeat(shift) + r).slice(0, FRAME_W)
      : r.slice(-shift) + '.'.repeat(-shift);
  });
}
const NAP_HEAD = napHead();
/** Forearms folded flat on the desk, the left one over the right (rows 35..39). */
const NAP_ARMS = [
  '...UUUUUUUUUUUUUUUUUUUUUUUUUU...',
  '..UTTTTTTTTTTTtUTTTTTTTTTTtuuU..',
  '..UTtttttttttttUTttttttttttuuU..',
  '..UuuuuuuuuuuuuUuuuuuuuuuuuuuU..',
  '...UUUUUUUUUUUUUUUUUUUUUUUUUU...',
];
const NAP_ARMS_Y = 35;
const NAP_HEAD_Y = 15;

/** Long hair, front view: falls beside the face and over the shoulders (from head row 17). */
const LONG_DOWN = [
  '.OHhhd....................dhhdO.',
  '.OHhhd....................dhhdO.',
  '.OHhhd....................dhhdO.',
  '.OHhhd....................dhhdO.',
  '.OHhhhd..................dhhhdO.',
  '.OHhhhd..................dhhhdO.',
  '.OHhhhd..................dhhhdO.',
  '.OHhhhd..................dhhhdO.',
  '.OHhhhdO................OdhhhdO.',
  '.OHhhhdO................OdhhhdO.',
  '..OHhhdO................OdhhdO..',
  '..OHhhdO................OdhhdO..',
  '..OHhddO................OddhdO..',
  '...OhdO..................OdhO...',
  '....OO....................OO....',
];

/**
 * Long hair seen from behind or from the side: a curtain of clumps (lit left edge, dark seams, a
 * shadowed right edge) whose last two rows break into tips.
 */
function hairCurtain(rows: number, left: number, right: number, taper: number): string[] {
  return Array.from({ length: rows }, (_, i) => {
    const t = Math.max(0, i - (rows - taper));
    const l = left + t;
    const r = right - t;
    const row = new Array<string>(FRAME_W).fill('.');
    for (let x = l; x <= r; x++) {
      let c = 'h';
      if (x === l || x === r) c = 'O';
      else if (x === l + 1) c = 'H';
      else if (x >= r - 2) c = 'd';
      else if ((x - l + (i >> 2)) % 5 === 0) c = 'd';
      else if ((x - l + (i >> 2)) % 5 === 1) c = 'H';
      if (i === rows - 2 && (x - l) % 3 === 0 && x !== l) c = 'O';
      if (i === rows - 1) c = (x - l) % 3 === 1 ? 'O' : '.';
      row[x] = c;
    }
    return row.join('');
  });
}
const LONG_UP = hairCurtain(16, 4, 27, 4);
const LONG_RIGHT = hairCurtain(15, 3, 12, 3);
/** Frame row where the long hair starts, per view (the back curtain covers the nape). */
const LONG_Y: Record<Dir, number> = { down: HEAD_Y + 17, up: HEAD_Y + 20, right: HEAD_Y + 19 };
const LONG: Record<Dir, string[]> = { down: LONG_DOWN, up: LONG_UP, right: LONG_RIGHT };

export type HairStyle = 'short' | 'long';

export const HEADS: Readonly<Record<Dir, readonly string[]>> = {
  down: HEAD_DOWN,
  up: HEAD_UP,
  right: HEAD_RIGHT,
};

// ---------------------------------------------------------------------------
// Torsos (14 rows, rows 30..43: shirt, hem, then the pants waist). Arms are separate stamps.
// ---------------------------------------------------------------------------

const TORSO_DOWN = [
  '........UUUUqqSSSSqqUUUU........',
  '......UUTTTTqqQSSQqqtttuUU......',
  '.....UTTTTTTTqQuuQqttttttuU.....',
  at(7, 'UTTtttttuuttttttuU'),
  at(7, 'UTutttttQutttttuuU'),
  at(7, 'UtTuttttuuttttutuU'),
  at(7, 'UtttttttQutttttuuU'),
  at(7, 'UtttttttuuttttttuU'),
  at(7, 'UttTttttQuttttuttU'),
  at(7, 'UtttttttuuttttttuU'),
  at(7, 'UtttttttQutttttuuU'),
  at(7, 'UuuuuuuuuuuuuuuuuU'),
  at(8, 'nPppppppppppppvn'),
  at(8, 'nPppppppppppppvn'),
];

const TORSO_UP = [
  '........UUUUqqqqqqqqUUUU........',
  '......UUTTTTQqqqqqqQtttuUU......',
  at(5, 'UTTTTTTTTttttttttttttuU'),
  at(7, 'UTTtttttuutttttuuU'),
  at(7, 'UTuttttuttuttttuuU'),
  at(7, 'UtTuttttuuttttutuU'),
  at(7, 'UttuttttuutttttuuU'),
  at(7, 'UtttttttuuttttttuU'),
  at(7, 'UttTttttuuttttuttU'),
  at(7, 'UtttttttuuttttttuU'),
  at(7, 'UttttttTuuttttttuU'),
  at(7, 'UuuuuuuuuuuuuuuuuU'),
  at(8, 'nPppppppvvppppvn'),
  at(8, 'nPppppppvvppppvn'),
];

const TORSO_RIGHT = [
  at(10, 'UUUUUqSSSSqU'),
  at(10, 'UTTTTqQSSQqU'),
  at(10, 'UTTTttqQQqtU'),
  at(10, 'UTTtttttttuU'),
  at(10, 'UTttttttttuU'),
  at(10, 'UTtTttttttuU'),
  at(10, 'UTttttttttuU'),
  at(10, 'UTtttttttuuU'),
  at(10, 'UTTtttttttuU'),
  at(10, 'UTttttttttuU'),
  at(10, 'UTtttttttuuU'),
  at(10, 'UuuuuuuuuuuU'),
  at(10, 'nPppppppppvn'),
  at(10, 'nPppppppppvn'),
];

// ---------------------------------------------------------------------------
// Legs (rows 44..57 standing)
// ---------------------------------------------------------------------------

/** One front/back leg, 7 px wide at column x; `len` rows from LEGS_Y, the last three are the shoe. */
function frontLeg(rows: string[][], x: number, len: number, back: boolean): void {
  for (let i = 0; i < len; i++) {
    let seg: string;
    let sx = x;
    if (i < len - 3) {
      seg = back ? 'nppppvn' : 'nPpppvn';
    } else if (i === len - 3) {
      seg = back ? 'yzzzzzzy' : 'yZZzzzzy';
      sx = x - 1;
    } else if (i === len - 2) {
      seg = 'yzzzzzzy';
      sx = x - 1;
    } else {
      seg = '.yyyyyy.';
      sx = x - 1;
    }
    put(rows[i], sx, seg);
  }
}

function put(row: string[], x: number, seg: string): void {
  for (let k = 0; k < seg.length; k++) {
    if (seg[k] !== '.' && x + k >= 0 && x + k < row.length) {
      row[x + k] = seg[k];
    }
  }
}

function emptyRows(n: number): string[][] {
  return Array.from({ length: n }, () => new Array<string>(FRAME_W).fill('.'));
}

/** Front/back legs. The longer leg touches the ground (row 57); a shorter one is lifted. */
function legsFrontBack(leftLen: number, rightLen: number, back = false): string[] {
  const rows = emptyRows(14);
  frontLeg(rows, 8, leftLen, back);
  frontLeg(rows, 17, rightLen, back);
  return rows.map((r) => r.join(''));
}

/**
 * Side legs, slanted from the hip (column 13) to the foot. `far` is the leg behind (darker, one row
 * shorter for depth), `near` the one in front. Feet point right.
 */
function legsSide(farFootX: number, nearFootX: number, farLift = 0, nearLift = 0): string[] {
  const rows = emptyRows(14);
  const leg = (footX: number, len: number, far: boolean) => {
    const hipX = 13;
    const shin = len - 3;
    for (let i = 0; i < len; i++) {
      const t = shin <= 1 ? 1 : Math.min(i, shin - 1) / (shin - 1);
      const x = Math.round(hipX + (footX - hipX) * t);
      if (i < shin) {
        put(rows[i], x, far ? 'nvvppvn' : 'nPpppvn');
      } else if (i === shin) {
        put(rows[i], x, far ? 'yzzzzzzzy' : 'yZZzzzzzy');
      } else if (i === shin + 1) {
        put(rows[i], x, 'yzzzzzzzzy');
      } else {
        put(rows[i], x, '.yyyyyyyy.');
      }
    }
  };
  leg(farFootX, 13 - farLift, true);
  leg(nearFootX, 14 - nearLift, false);
  return rows.map((r) => r.join(''));
}

/** Seated lower bodies (rows 44..51): thighs toward the camera, the shoes peeking under them. */
const SEATED_DOWN = [
  at(7, 'nPpppppppppppppvn'),
  at(7, 'nPpppppvnPppppvvn'),
  at(7, 'nPpppppvnPppppvvn'),
  at(7, 'nnnnnnnnnnnnnnnnn'),
  at(6, 'yZZzzzzy.yZZzzzzy'),
  at(6, 'yzzzzzzy.yzzzzzzy'),
  at(7, 'yyyyyy...yyyyyy'),
  at(0, ''),
];
const SEATED_UP = [
  at(8, 'nPppppppvvppppvn'),
  at(8, 'nPppppppvvppppvn'),
  at(8, 'nPppppppvvppppvn'),
  at(8, 'nPppppppvvppppvn'),
  at(8, 'nnnnnnnnnnnnnnnn'),
  at(0, ''),
  at(0, ''),
  at(0, ''),
];
const SEATED_RIGHT = [
  at(10, 'nPppppppppppppn'),
  at(10, 'nPPpppppppppppvn'),
  at(10, 'nppppppppppppppvn'),
  at(10, 'nnnnnnnnnnnnnnvpvn'),
  at(20, 'nPppvn'),
  at(19, 'yZZzzzzzy'),
  at(19, 'yzzzzzzzzy'),
  at(20, 'yyyyyyyy'),
];

// ---------------------------------------------------------------------------
// Arms, hands and the book, as {rows, x, y} stamps relative to the upper-body shift
// ---------------------------------------------------------------------------

interface Stamp {
  rows: string[];
  x: number;
  y: number;
  /** A held object (the book), left out when measuring the body for the flair anchors. */
  prop?: boolean;
}

/** Front/back arm hanging at the side: `sleeve` rows of sleeve, the cuff, then a 3-row hand. */
function sideArm(left: boolean, sleeve: number, back = false): string[] {
  const rows: string[] = [];
  for (let i = 0; i < sleeve; i++) rows.push(left ? 'UTTu' : back ? 'uttU' : 'utuU');
  rows.push(left ? 'UTTU' : 'UttU');
  rows.push(left ? 'KssS' : 'SssK', left ? 'KsSK' : 'KSsK', '.KK.');
  return rows;
}
const ARM_TOP = 33;
const armL = (sleeve: number, dy = 0, back = false): Stamp => ({
  rows: sideArm(true, sleeve, back),
  x: 4,
  y: ARM_TOP + dy,
});
const armR = (sleeve: number, dy = 0, back = false): Stamp => ({
  rows: sideArm(false, sleeve, back),
  x: 24,
  y: ARM_TOP + dy,
});

/**
 * Forearms resting forward, hands together in front of the belly (front view, seated). Each half is
 * one arm; `TYPE_L`/`TYPE_R` are stamped separately so the hands can tap one at a time.
 */
const TYPE_L = [
  'UTTu........',
  'UTTtU.......',
  '.UTTtU......',
  '..UTTtUKKK..',
  '...UUUKsssK.',
  '.....KsSsSK.',
  '......KKKK..',
];
const TYPE_R = [
  '........utuU',
  '.......UutuU',
  '......UuttU.',
  '..KKKUuttU..',
  '.KsssKUUU...',
  '.KsSsSK.....',
  '..KKKK......',
];
/** Upper sleeves above the forearms (rows 33..36). */
const SLEEVE_L = ['UTTu', 'UTTu', 'UTTu', 'UTTu'];
const SLEEVE_R = ['utuU', 'utuU', 'utuU', 'utuU'];

function seatedArms(lDy: number, rDy: number, y = 37): Stamp[] {
  return [
    { rows: SLEEVE_L, x: 4, y: ARM_TOP },
    { rows: SLEEVE_R, x: 24, y: ARM_TOP },
    { rows: TYPE_L, x: 4, y: y + lDy },
    { rows: TYPE_R, x: 16, y: y + rDy },
  ];
}

/** Hands holding something at chest height: 3x4 fists. */
const FIST_L = ['KKK.', 'KssK', 'KsSK', '.KK.'];
const FIST_R = ['.KKK', 'KssK', 'KSsK', '.KK.'];

/**
 * Open book seen from the front, 20x14 (two empty rows on top for the lifted page): cream pages with
 * gray text lines, a shaded spine, the cover edge around them. Also the idle-props overlay, so the book
 * an agent reads at work and the one it reads idle are the same.
 */
const BOOK_HALF = [
  '..........',
  '..........',
  '.ggggggg..',
  'gkWWWWWWgg',
  'gkWxxxxxWX',
  'gkWWWWWWWX',
  'gkWxxxxWWX',
  'gkWWWWWWWX',
  'gkWxxxxxWX',
  'gkWWWWWWWX',
  'gkWxxWWWWX',
  'gkkWWWWWWX',
  'glllllllkg',
  '.gggggggg.',
];
export const OPEN_BOOK_A: readonly string[] = BOOK_HALF.map(
  (r) => r + r.split('').reverse().join(''),
);
/** Page-turn: the right page lifts in an arc from the spine. */
export const OPEN_BOOK_B: readonly string[] = (() => {
  const g = OPEN_BOOK_A.map((r) => r.split(''));
  const arc = [
    '..............ggg...',
    '...........gggWWWg..',
    '..........gWWWWWWg..',
    '..........gWWWWXgg..',
    '..........gXWggg....',
  ];
  arc.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g[y][x] = row[x];
  });
  // under the lifted page: the next page, its first two lines
  for (let y = 5; y <= 10; y++) for (let x = 11; x <= 17; x++) g[y][x] = 'W';
  for (let x = 12; x <= 15; x++) g[6][x] = 'x';
  for (let x = 12; x <= 16; x++) g[8][x] = 'x';
  return g.map((r) => r.join(''));
})();
const BOOK_SIDE = [
  'gggggg',
  'gllWWg',
  'glkWWg',
  'glkWWg',
  'glkWWg',
  'glkWWg',
  'glkWWg',
  'glkWWg',
  'gkkWWg',
  'gggggg',
];
const BOOK_SIDE_FLIP = [
  'gggggg',
  'gllWWg',
  'glkWWg',
  'glkWWg',
  'glkWkg',
  'glkkkg',
  'glkWWg',
  'glkWWg',
  'gkkWWg',
  'gggggg',
];

/** Side view arm from the shoulder, its hand drifting `swing` px forward (+) or back (-) at the bottom. */
function sideViewArm(swing: number): string[] {
  const rows: string[] = [];
  const len = 8;
  for (let i = 0; i <= len + 3; i++) {
    const t = i / (len + 3);
    const dx = Math.round(swing * t);
    const row = new Array<string>(FRAME_W).fill('.');
    const x = 13 + dx;
    if (i < len) put(row, x, 'UTttU');
    else if (i === len) put(row, x, 'UuuuU');
    else if (i === len + 1) put(row, x, 'KssSK');
    else if (i === len + 2) put(row, x, 'KsSSK');
    else put(row, x, '.KKK.');
    rows.push(row.join(''));
  }
  return rows;
}

/** Side view, seated: upper arm down, forearm forward onto the desk, hand at column 26. */
function sideForearm(handDy: number): string[] {
  const rows = emptyRows(8);
  for (let i = 0; i < 4; i++) put(rows[i], 13, 'UTttU');
  put(rows[4], 13, 'UTtttttttUU');
  put(rows[5], 13, 'UuuuuuuuuuU');
  put(rows[6], 14, 'UUUUUUUUUU');
  const hy = 3 + handDy;
  put(rows[hy], 23, 'KKKK');
  put(rows[hy + 1], 23, 'KsssK');
  put(rows[hy + 2], 23, 'KsSsSK');
  put(rows[hy + 3], 24, 'KKKK');
  return rows.map((r) => r.join(''));
}

interface Pose {
  /** Upper-body vertical shift (head, torso and arms move together). */
  dy: number;
  /** Extra shift of the shoulders alone: the napper breathes while head, arms and waist rest. */
  torsoDy?: number;
  legs: string[] | null;
  arms: Stamp[];
  /** A head other than the dir's own, at an absolute row (the bowed nap head). */
  head?: { rows: string[]; y: number };
}

/**
 * Idle poses, front view: sit-idle (hands in the lap), head-down (nap), page-turn A and B.
 * No book and no mug here: both are overlays, so the hands only frame the empty space. The book
 * goes at rows 30-39 (32-41 on page B), high on the chest, so the desk in front of a seated agent
 * does not hide it.
 */
const napPose = (breathIn: boolean): Pose => ({
  dy: 0,
  torsoDy: breathIn ? -1 : 0,
  legs: null,
  arms: [{ rows: NAP_ARMS, x: 0, y: NAP_ARMS_Y }],
  head: { rows: NAP_HEAD, y: NAP_HEAD_Y },
});

/** Hands at the bottom corners of the book overlay (cols 6..25, rows 28..39). */
const pageArms = (turn: boolean): Stamp[] => [
  { rows: SLEEVE_L, x: 4, y: ARM_TOP },
  { rows: SLEEVE_R, x: 24, y: ARM_TOP },
  { rows: FIST_L, x: 3, y: 36 },
  turn ? { rows: FIST_R, x: 21, y: 27 } : { rows: FIST_R, x: 25, y: 36 },
];

const IDLE_POSES: Pose[] = [
  { dy: 0, legs: null, arms: seatedArms(1, 1) },
  napPose(false),
  { dy: 0, legs: null, arms: pageArms(false) },
  { dy: BOB, legs: null, arms: pageArms(true) },
  napPose(true),
  // sip: the left hand rests in the lap, the right holds the mug overlay (cols 22..31) at the chest
  {
    dy: 0,
    legs: null,
    arms: [
      { rows: SLEEVE_L, x: 4, y: ARM_TOP },
      { rows: TYPE_L, x: 4, y: 38 },
      { rows: SLEEVE_R, x: 24, y: ARM_TOP },
      { rows: FIST_R, x: 19, y: 34 },
    ],
  },
];

function posesFor(dir: Dir): Pose[] {
  if (dir === 'right') {
    return [
      { dy: BOB, legs: legsSide(6, 20, 0, 1), arms: [{ rows: sideViewArm(-5), x: 0, y: 31 }] },
      { dy: 0, legs: legsSide(11, 14), arms: [{ rows: sideViewArm(0), x: 0, y: 31 }] },
      { dy: BOB, legs: legsSide(20, 7, 1, 0), arms: [{ rows: sideViewArm(5), x: 0, y: 31 }] },
      { dy: 0, legs: null, arms: [{ rows: sideForearm(0), x: 0, y: 33 }] },
      { dy: 0, legs: null, arms: [{ rows: sideForearm(-1), x: 0, y: 33 }] },
      {
        dy: 0,
        legs: null,
        arms: [
          { rows: sideViewArm(3).slice(0, 6), x: 0, y: 31 },
          { rows: BOOK_SIDE, x: 22, y: 33, prop: true },
          { rows: FIST_R, x: 19, y: 37 },
        ],
      },
      {
        dy: BOB,
        legs: null,
        arms: [
          { rows: sideViewArm(3).slice(0, 6), x: 0, y: 31 },
          { rows: BOOK_SIDE_FLIP, x: 22, y: 33, prop: true },
          { rows: FIST_R, x: 19, y: 37 },
        ],
      },
    ];
  }
  const up = dir === 'up';
  return [
    // walk: the arm opposite the lifted leg swings forward (longer, the hand lower)
    {
      dy: BOB,
      legs: legsFrontBack(14, 10, up),
      arms: [armL(5, 0, up), armR(9, 0, up)],
    },
    { dy: 0, legs: legsFrontBack(14, 14, up), arms: [armL(7, 0, up), armR(7, 0, up)] },
    {
      dy: BOB,
      legs: legsFrontBack(10, 14, up),
      arms: [armL(9, 0, up), armR(5, 0, up)],
    },
    // typing: hands tap in turn (front view: on the keys; back view: the elbows work)
    {
      dy: 0,
      legs: null,
      arms: up ? [armL(4, 2, true), armR(5, 0, true)] : seatedArms(0, -2),
    },
    {
      dy: 0,
      legs: null,
      arms: up ? [armL(5, 0, true), armR(4, 2, true)] : seatedArms(-2, 0),
    },
    // reading: book held up in front (front view) / elbows tucked in (back view)
    {
      dy: 0,
      legs: null,
      arms: up
        ? [
            { rows: sideArm(true, 5, true), x: 6, y: ARM_TOP },
            { rows: sideArm(false, 5, true), x: 22, y: ARM_TOP },
          ]
        : [
            armL(5),
            armR(5),
            { rows: OPEN_BOOK_A as string[], x: 6, y: 26, prop: true },
            { rows: FIST_L, x: 3, y: 36 },
            { rows: FIST_R, x: 25, y: 36 },
          ],
    },
    {
      dy: BOB,
      legs: null,
      arms: up
        ? [
            { rows: sideArm(true, 5, true), x: 6, y: ARM_TOP },
            { rows: sideArm(false, 5, true), x: 22, y: ARM_TOP },
          ]
        : [
            armL(5),
            armR(5),
            { rows: OPEN_BOOK_B as string[], x: 6, y: 26, prop: true },
            { rows: FIST_L, x: 3, y: 36 },
            { rows: FIST_R, x: 21, y: 27 },
          ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Frame composition
// ---------------------------------------------------------------------------

/** A composed frame: one char per pixel, '.' transparent. */
export type FrameGrid = string[][];

function blank(): FrameGrid {
  return Array.from({ length: FRAME_H }, () => new Array<string>(FRAME_W).fill('.'));
}

function stampGrid(g: FrameGrid, rows: readonly string[], x: number, y: number): void {
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const c = row[rx];
      const gx = x + rx;
      const gy = y + ry;
      if (c !== '.' && gx >= 0 && gx < FRAME_W && gy >= 0 && gy < FRAME_H) {
        g[gy][gx] = c;
      }
    }
  });
}

export function composeFrame(
  dir: Dir,
  frame: number,
  style: HairStyle = 'short',
  withProps = true,
): FrameGrid {
  return composePose(dir, posesFor(dir)[frame], style, withProps);
}

/** Idle row frame `i` (0 sit-idle, 1 head-down, 2 page-turn A, 3 page-turn B), front view. */
export function composeIdleFrame(i: number, style: HairStyle = 'short'): FrameGrid {
  return composePose('down', IDLE_POSES[i], style);
}

function composePose(dir: Dir, pose: Pose, style: HairStyle, withProps = true): FrameGrid {
  const g = blank();
  if (pose.legs) {
    stampGrid(g, pose.legs, 0, LEGS_Y);
  } else {
    const seat = dir === 'down' ? SEATED_DOWN : dir === 'up' ? SEATED_UP : SEATED_RIGHT;
    stampGrid(g, seat, 0, LEGS_Y);
  }
  const torso = dir === 'down' ? TORSO_DOWN : dir === 'up' ? TORSO_UP : TORSO_RIGHT;
  stampGrid(g, torso, 0, TORSO_Y + pose.dy);
  if (pose.torsoDy) {
    // the shoulders alone move: the waist stays on the seat
    stampGrid(g, torso.slice(0, 6), 0, TORSO_Y + pose.dy + pose.torsoDy);
  }
  if (pose.head) {
    stampGrid(g, pose.head.rows, 0, pose.head.y);
  } else {
    stampGrid(g, HEADS[dir], 0, HEAD_Y + pose.dy);
    // Long hair hangs from the upright head; the bowed nap head hides it under the arms.
    if (style === 'long') stampGrid(g, LONG[dir], 0, LONG_Y[dir] + pose.dy);
  }
  // Arms last: in the front view the forearms and the book sit over the body, and the nap arms
  // fold over the bowed head's lower edge.
  for (const a of pose.arms) {
    if (a.prop && !withProps) continue;
    stampGrid(g, a.rows, a.x, a.y + pose.dy);
  }
  return g;
}

export function validateMaps(): void {
  for (const dir of DIRS) {
    assertRect(`HEAD ${dir}`, HEADS[dir], FRAME_W, 24);
  }
  assertRect('HEAD nap', NAP_HEAD, FRAME_W, 24);
  for (const dir of DIRS) {
    assertRect(`LONG ${dir}`, LONG[dir], FRAME_W, LONG[dir].length);
  }
  assertRect('TORSO down', TORSO_DOWN, FRAME_W, 14);
  assertRect('TORSO up', TORSO_UP, FRAME_W, 14);
  assertRect('TORSO right', TORSO_RIGHT, FRAME_W, 14);
  assertRect('SEATED down', SEATED_DOWN, FRAME_W, 8);
  assertRect('SEATED up', SEATED_UP, FRAME_W, 8);
  assertRect('SEATED right', SEATED_RIGHT, FRAME_W, 8);
  assertRect('TYPE left', TYPE_L, 12, 7);
  assertRect('TYPE right', TYPE_R, 12, 7);
  assertRect('BOOK open', OPEN_BOOK_A, 20, 14);
  assertRect('BOOK open turn', OPEN_BOOK_B, 20, 14);
  assertRect('NAP arms', NAP_ARMS, FRAME_W, 5);
  assertRect('BOOK side', BOOK_SIDE, 6, 10);
  assertRect('BOOK side flip', BOOK_SIDE_FLIP, 6, 10);
  for (const dir of DIRS) {
    posesFor(dir).forEach((p, i) => {
      if (p.legs) {
        assertRect(`legs ${dir} ${i}`, p.legs, FRAME_W, 14);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Palette swap
// ---------------------------------------------------------------------------

export interface CharLook {
  name: string;
  hair: string;
  /** Index into SKIN_RAMPS (core/src/assets/skinTones.ts). */
  skin: number;
  outfit: string;
  /** Same head for everyone; a few sheets add long hair (it never changes the head top). */
  style: HairStyle;
}

/** char_0..11. Same chibi; hair and outfit differ per sheet, skin comes from the fixed ramp. */
const CHAR_PALETTES: ReadonlyArray<Omit<CharLook, 'skin' | 'style'>> = [
  { name: 'nova', hair: '#3a2416', outfit: '#3d6fd1' },
  { name: 'pixel', hair: '#e0a040', outfit: '#48a46f' },
  { name: 'byte', hair: '#1d1d24', outfit: '#e0c15a' },
  { name: 'luna', hair: '#7a5ad1', outfit: '#d65d73' },
  { name: 'ramon', hair: '#c0563f', outfit: '#5ec2d6' },
  { name: 'sol', hair: '#d9d4e6', outfit: '#e8855a' },
  { name: 'iris', hair: '#2b3a67', outfit: '#9b6fd6' },
  { name: 'milo', hair: '#8a5a2b', outfit: '#d94f4f' },
  { name: 'jade', hair: '#0f0f14', outfit: '#3fb8a0' },
  { name: 'coco', hair: '#5a2e1e', outfit: '#f2b8c6' },
  { name: 'finn', hair: '#e8d27a', outfit: '#4a5d8f' },
  { name: 'ruby', hair: '#a8322e', outfit: '#8fc25e' },
];

/** Sheet n wears skin tone n mod 5. */
const LONG_HAIR: ReadonlySet<string> = new Set(['luna', 'iris', 'coco', 'ruby']);

export const CHAR_LOOKS: readonly CharLook[] = CHAR_PALETTES.map((p, n) => ({
  ...p,
  skin: n % SKIN_RAMPS.length,
  style: LONG_HAIR.has(p.name) ? 'long' : 'short',
}));

/** Linear mix of two colors, k = 0 gives a, k = 1 gives b. */
function mix(a: string, b: string, k: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return (
    '#' +
    ca
      .map((v, i) =>
        Math.max(0, Math.min(255, Math.round(v + (cb[i] - v) * k)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function paletteFor(look: CharLook): Palette {
  const skin = SKIN_RAMPS[look.skin];
  return {
    O: mix(look.hair, '#140806', 0.6),
    d: shade(look.hair, -0.3),
    h: look.hair,
    H: mix(look.hair, '#ffd9a8', 0.22),
    j: mix(look.hair, '#ffe6c4', 0.5),
    b: mix(look.hair, '#140806', 0.3),
    K: skin.outline,
    N: skin.deep,
    S: skin.shade,
    s: skin.base,
    c: skin.blush,
    m: skin.mouth,
    e: EYE_COLORS.dark,
    i: EYE_COLORS.iris,
    I: EYE_COLORS.irisLight,
    w: EYE_COLORS.shine,
    U: mix(look.outfit, '#140a12', 0.55),
    u: shade(look.outfit, -0.22),
    t: look.outfit,
    T: shade(look.outfit, 0.22),
    q: '#fff4dc',
    Q: '#d8c4a0',
    n: '#1f2236',
    v: '#2c3049',
    p: '#3a3f5c',
    P: '#555c80',
    y: '#1e1008',
    z: '#3b2412',
    Z: '#6a4426',
    g: '#4a2014',
    k: '#b84a3a',
    l: '#d8705a',
    W: '#fff4dc',
    x: '#9a9088',
    X: '#d8c8a8',
  };
}

export function buildCharacterSheet(look: CharLook): Canvas {
  const sheet = new Canvas(FRAME_W * FRAMES, FRAME_H * SHEET_ROWS);
  const pal = paletteFor(look);
  DIRS.forEach((dir, row) => {
    for (let f = 0; f < FRAMES; f++) {
      const g = composeFrame(dir, f, look.style);
      sheet.stamp(
        g.map((r) => r.join('')),
        pal,
        f * FRAME_W,
        row * FRAME_H,
      );
    }
  });
  for (let f = 0; f < IDLE_FRAMES; f++) {
    sheet.stamp(
      composeIdleFrame(f, look.style).map((r) => r.join('')),
      pal,
      f * FRAME_W,
      DIRS.length * FRAME_H,
    );
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Flair anchors (for accessories drawn over the sprite), in WORLD px
// ---------------------------------------------------------------------------

export interface DirAnchors {
  /** First opaque row of the head in the neutral frame (walk2, also idle). */
  headTopY: number;
  /** First outfit row (the shoulder line) in the neutral frame. */
  shoulderY: number;
  /** Per frame: how far the head sits below the neutral frame. */
  bob: number[];
  /** Per frame: how far the shoulder line sits below the neutral frame. Differs from `bob` only when
   *  the head moves alone (the bowed head of the nap frame). */
  shoulderBob: number[];
}

export interface Sparkle {
  dx: number;
  dy: number;
  phaseMs: number;
}

export type Anchors = Record<Dir, DirAnchors> & { sparkles: Sparkle[] };

function firstRow(g: FrameGrid, pred: (c: string) => boolean): number {
  for (let y = 0; y < g.length; y++) {
    if (g[y].some(pred)) {
      return y;
    }
  }
  return -1;
}

const OUTFIT_KEYS = 'UutTqQ';

/** Fable's twinkles around the head, world px from the sprite's top-left (the sprite is 3x3 world px). */
const SPARKLES: Sparkle[] = [
  { dx: 0, dy: 4, phaseMs: 0 },
  { dx: 13, dy: 1, phaseMs: 470 },
  { dx: 14, dy: 11, phaseMs: 930 },
];

/** Measured on the art in art px, written in world px (art px / DENSITY, halves allowed). */
export function computeAnchors(): Anchors {
  const out = {} as Anchors;
  const world = (artPx: number) => artPx / DENSITY;
  for (const dir of DIRS) {
    // Bodies only: a held book must not pass for the head or the shoulder line.
    const frames = Array.from({ length: FRAMES }, (_, f) => composeFrame(dir, f, 'short', false));
    // The idle row is front view only: its frames follow the seven of `down` (frames 7..10).
    if (dir === 'down') {
      for (let f = 0; f < IDLE_FRAMES; f++) frames.push(composeIdleFrame(f));
    }
    const top = frames.map((g) => firstRow(g, (c) => c !== '.'));
    const shoulder = frames.map((g) => firstRow(g, (c) => OUTFIT_KEYS.includes(c)));
    const neutral = 1;
    out[dir] = {
      headTopY: world(top[neutral]),
      shoulderY: world(shoulder[neutral]),
      bob: top.map((t) => world(t - top[neutral])),
      shoulderBob: shoulder.map((t) => world(t - shoulder[neutral])),
    };
  }
  out.sparkles = SPARKLES;
  return out;
}
