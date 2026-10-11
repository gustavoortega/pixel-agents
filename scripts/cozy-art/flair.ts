/**
 * Flair at art density 2: the accessories (headphones, cape, crown), the companions (bird, cat, owl,
 * dragon), the idle props (book, mug) and Fable's sparkle, written as the JSON files the webview
 * imports from webview-ui/src/office/sprites/flair/.
 *
 * Pixel maps are art px. Every offset in the JSON (`row` of an accessory, `dx`/`dy` of a prop) is
 * WORLD px, like anchors.json, so the engine never divides: art px / 2, halves allowed.
 */

import type { Palette } from './canvas';
import { assertRect } from './canvas';
import { at, DENSITY, FRAME_W, HEADS, OPEN_BOOK_A, OPEN_BOOK_B } from './characters';

export const FLAIR_DIR = 'webview-ui/src/office/sprites/flair';

type Map2D = string[];

function flip(rows: readonly string[]): string[] {
  return rows.map((r) => r.split('').reverse().join(''));
}

function mirrorHalf(rows: readonly string[]): string[] {
  return rows.map((r) => r + r.split('').reverse().join(''));
}

/** string rows -> the string[][] the webview reads. */
function cells(rows: readonly string[]): string[][] {
  return rows.map((r) => r.split(''));
}

function grid(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => new Array<string>(w).fill('.'));
}

function put(g: string[][], x: number, y: number, seg: string): void {
  for (let k = 0; k < seg.length; k++) {
    if (seg[k] !== '.' && y >= 0 && y < g.length && x + k >= 0 && x + k < g[0].length) {
      g[y][x + k] = seg[k];
    }
  }
}

function stampRows(g: string[][], rows: readonly string[], x: number, y: number): void {
  rows.forEach((r, i) => put(g, x, y + i, r));
}

const world = (artPx: number) => artPx / DENSITY;

// ---------------------------------------------------------------------------
// Headphones (head anchor)
// ---------------------------------------------------------------------------

/** Rows of empty space above the head in the accessory maps (the band arcs over the hair). */
const HEAD_PAD = 2;
/** Head rows (from the head top) the band covers before the cups take over. */
const BAND_ROWS = 13;

const CUP_FRONT = [
  '.oooo.',
  'oPPPPo',
  'oPHPPo',
  'oPHPPo',
  'oPPPPo',
  'oPPPQo',
  'oPPPQo',
  'oQPPQo',
  'oQQQQo',
  '.oooo.',
];
const CUP_SIDE = [
  '.oooooo.',
  'oPPPPPPo',
  'oPHHPPPo',
  'oPHPPPQo',
  'oPPPPPQo',
  'oPPPPPQo',
  'oPPPPQQo',
  'oQPPPQQo',
  'oQQQQQQo',
  '.oooooo.',
];

/**
 * Front and back: a 3 px band hugging the hair outline (dark edge, steel fill with a lit top-left,
 * dark edge), measured off the head map so it follows the HD silhouette exactly, plus two cups.
 */
function headphonesFront(): Map2D {
  const head = HEADS.down;
  const h = HEAD_PAD + head.length;
  const g = grid(FRAME_W, h);
  const inHead = (x: number, y: number) =>
    y >= 0 && y < head.length && x >= 0 && x < FRAME_W && head[y][x] !== '.';
  for (let y = -HEAD_PAD; y < BAND_ROWS; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      let best = Infinity;
      for (let yy = 0; yy < head.length; yy++) {
        for (let xx = 0; xx < FRAME_W; xx++) {
          if (inHead(xx, yy)) best = Math.min(best, Math.hypot(xx - x, yy - y));
        }
      }
      const edge =
        inHead(x, y) &&
        (!inHead(x - 1, y) || !inHead(x + 1, y) || !inHead(x, y - 1) || !inHead(x, y + 1));
      let c = '.';
      if (edge) c = 'o';
      else if (!inHead(x, y) && best <= 1.5) c = y < 4 && x < 16 ? 'H' : 'F';
      else if (!inHead(x, y) && best <= 2.5) c = 'o';
      if (c !== '.') g[y + HEAD_PAD][x] = c;
    }
  }
  stampRows(g, CUP_FRONT, 0, HEAD_PAD + 12);
  stampRows(g, flip(CUP_FRONT), FRAME_W - 6, HEAD_PAD + 12);
  return g.map((r) => r.join(''));
}

/** Side: the band crosses the crown and drops to one big cup over the ear. */
function headphonesSide(): Map2D {
  const h = HEAD_PAD + HEADS.right.length;
  const g = grid(FRAME_W, h);
  put(g, 13, HEAD_PAD - 2, 'oooooo');
  put(g, 13, HEAD_PAD - 1, 'oHFFFo');
  for (let y = HEAD_PAD; y < HEAD_PAD + 11; y++) put(g, 14, y, 'oHFo');
  stampRows(g, CUP_SIDE, 12, HEAD_PAD + 11);
  return g.map((r) => r.join(''));
}

// ---------------------------------------------------------------------------
// Crown (head anchor): the bottom two rows rest on the hair
// ---------------------------------------------------------------------------

const CROWN = [
  '.o.....oo.....o.',
  'oLo...oLLo...oLo',
  'oYo..oYLLYo..oYo',
  'oYYo.oYYYYo.oYYo',
  'oYYYoYYRRYYoYYYo',
  'oLYYYYRrrRYYYYLo',
  'oYYBYYYRRYYYBYYo',
  'oYYYYYYYYYYYYYYo',
  'oDDDDDDDDDDDDDDo',
  'oooooooooooooooo',
];
const CROWN_ROW = 8;

function crownAt(x: number): Map2D {
  const g = grid(FRAME_W, CROWN.length);
  stampRows(g, CROWN, x, 0);
  return g.map((r) => r.join(''));
}

// ---------------------------------------------------------------------------
// Cape (shoulder anchor)
// ---------------------------------------------------------------------------

/**
 * A cape filled from per-row spans: outline around, a lit strip on the left edge, folds that fan out
 * downward. `folds` are columns at the top; each drifts `spread` px per row away from the center.
 */
function capeFromSpans(
  spans: Array<[number, number]>,
  folds: number[],
  spread: number,
  clasp: Array<[number, number]> = [],
): Map2D {
  const h = spans.length;
  const g = grid(FRAME_W, h);
  const center = (spans[0][0] + spans[0][1]) / 2;
  spans.forEach(([l, r], y) => {
    for (let x = l; x <= r; x++) {
      const last = y === h - 1;
      if (x === l || x === r || last || y === 0) g[y][x] = 'o';
      else if (x === l + 1) g[y][x] = 'L';
      else if (y === h - 2) g[y][x] = 'D';
      else g[y][x] = 'C';
    }
  });
  for (const f of folds) {
    for (let y = 2; y < h - 2; y++) {
      const x = Math.round(f + Math.sign(f - center) * spread * y);
      if (x > spans[y][0] + 1 && x < spans[y][1]) g[y][x] = 'D';
    }
  }
  for (const [x, y] of clasp) g[y][x] = 'G';
  return g.map((r) => r.join(''));
}

function span(
  rows: number,
  top: [number, number],
  bottom: [number, number],
): Array<[number, number]> {
  return Array.from({ length: rows }, (_, y) => {
    const t = y / (rows - 1);
    return [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
    ];
  });
}

/** Map rows above the shoulder line in the front cape (it starts under the collar). */
const CAPE_DOWN_ROW = 2;

// ---------------------------------------------------------------------------
// Companions (32x32 per frame)
// ---------------------------------------------------------------------------

const BIRD_BASE = [
  at(14, 'oo'),
  at(13, 'oLo'),
  at(11, 'ooLLooo'),
  at(10, 'oLLLLLBBo'),
  at(9, 'oLLLLBBBBBo'),
  at(8, 'oLLLBBBBweBo'),
  at(8, 'oLBBBBBBeeBBo'),
  at(7, 'oLBBBBBBBBBBoYYo'),
  at(7, 'oBBBBBBBBBBBByyo'),
  at(7, 'oBDDDDBBWWWWBoo'),
  at(6, 'oBDDDDDDBWWWWBo'),
  at(6, 'odDDDDDBWWWWWBo'),
  at(7, 'oddDDBBWWWWWBo'),
  at(8, 'oooBBBBBBBoo'),
  at(11, 'oooooooo'),
  at(12, 'oFo.oFo'),
  at(12, 'FF..FF'),
];
/** Wing raised: the move frames alternate between the folded wing and this one. */
const BIRD_WING_UP = [
  at(3, 'oo'),
  at(3, 'oDoo'),
  at(4, 'oDDDoo'),
  at(4, 'odDDDDoo'),
  at(5, 'oddDDDDBo'),
  at(6, 'ooddDDBBo'),
];

function bird(blink: boolean, wingUp: boolean, feetStep: boolean): Map2D {
  const g = grid(32, 32);
  const top = 32 - BIRD_BASE.length;
  stampRows(g, BIRD_BASE, 0, top);
  if (blink) {
    put(g, 16, top + 5, 'BB');
    put(g, 16, top + 6, 'oo');
  }
  if (wingUp) {
    // fold the wing away, raise it above the back
    for (let y = 9; y < 13; y++) {
      for (let x = 6; x < 14; x++) {
        const c = g[top + y][x];
        if (c === 'D' || c === 'd') g[top + y][x] = 'B';
      }
    }
    stampRows(g, BIRD_WING_UP, 0, top + 5);
  }
  if (feetStep) {
    put(g, 12, top + 15, '.....');
    put(g, 12, top + 16, '......');
    put(g, 11, top + 15, 'oFo');
    put(g, 11, top + 16, 'FF');
    put(g, 16, top + 15, 'oFo');
    put(g, 17, top + 16, 'FF');
  }
  return g.map((r) => r.join(''));
}

/** Front-sitting cat (left half, mirrored), tail curling round the right side. Native facing left. */
const CAT_HALF = [
  '...oo.......',
  '...ofo......',
  '..ofpfo.....',
  '..ofppfooooo',
  '.ofFpFFFFFFF',
  '.ofFFFFgFFFg',
  '.offffffgfff',
  'offffffffffg',
  'offfeyffffff',
  'offfeefffffW',
  'offfffffWWWn',
  'offffffWWWWo',
  'offffffWWWoW',
  '.offffffWWWW',
  '..ooffffWWWW',
  '..offgffWWWW',
  '.offgffffWWV',
  '.offgffffWWV',
  'offgfffffWWV',
  'offffffoWWWo',
  'offffffoWVWo',
  '.ooooooooooo',
];
const CAT_TAIL = [
  at(27, 'oo'),
  at(26, 'ofFo'),
  at(26, 'ofgo'),
  at(25, 'ofgfo'),
  at(23, 'oofffo'),
  at(20, 'ooofggoo'),
];
const CAT_TAIL_UP = [
  at(28, 'oo'),
  at(27, 'ofFo'),
  at(27, 'ofgo'),
  at(27, 'ofgo'),
  at(26, 'ofgfo'),
  at(25, 'offfo'),
  at(22, 'oooofgoo'),
];

function cat(blink: boolean, tailUp: boolean, paw: 0 | 1 | 2): Map2D {
  const g = grid(32, 32);
  const top = 10;
  if (tailUp) stampRows(g, CAT_TAIL_UP, 0, top + 15);
  else stampRows(g, CAT_TAIL, 0, top + 16);
  stampRows(
    g,
    mirrorHalf(CAT_HALF).map((r) => '....' + r + '....'),
    0,
    top,
  );
  // eyes: the shine on the same side for both
  for (const ex of [8, 22]) {
    if (blink) {
      put(g, ex, top + 8, 'ff');
      put(g, ex, top + 9, 'oo');
    } else {
      put(g, ex, top + 8, 'wy');
      put(g, ex, top + 9, 'ye');
    }
  }
  if (paw !== 0) {
    // one front paw lifted mid-step
    const x = paw === 1 ? 12 : 16;
    put(g, x, top + 20, 'oooo');
    for (let k = 0; k < 4; k++) g[top + 21][x + k] = '.';
  }
  return g.map((r) => r.join(''));
}

/** Owl, left half mirrored (symmetric, native facing right). */
const OWL_HALF = [
  '...o......',
  '...oo.....',
  '...oDo....',
  '...oDDoooo',
  '..oDOOOOOO',
  '.oDOWWWWWO',
  '.oOWWyyyyW',
  'oDOWyweeyW',
  'oDOWyeeeyW',
  'oDOWWyyyyW',
  'oDOOWWWWWY',
  'oDOOOOOOTY',
  'oDOOOTTtTT',
  'oDDOTtTTTt',
  'oDDOTTTtTT',
  'oDDOOTtTTT',
  '.oDDOOTTTT',
  '..oDDOOOOO',
  '...ooooYYo',
  '......oYYo',
];

function owl(blink: boolean, step: 0 | 1 | 2): Map2D {
  const g = grid(32, 32);
  const top = 32 - OWL_HALF.length;
  stampRows(g, mirrorHalf(OWL_HALF), 6, top);
  put(g, 18, top + 7, 'wee');
  if (blink) {
    put(g, 10, top + 7, 'yyyy');
    put(g, 18, top + 7, 'yyyy');
    put(g, 10, top + 8, 'oooo');
    put(g, 18, top + 8, 'oooo');
  }
  if (step !== 0) {
    // weight on one foot: the other lifts a row, the body leans a column
    put(g, 6, top + 18, '...ooooYYooYYoooo...');
    put(g, 6, top + 19, '....................');
    put(g, step === 1 ? 12 : 18, top + 19, 'oYYo');
  }
  return g.map((r) => r.join(''));
}

/** Dragon wing, left half (mirrored for the right one). */
const DRAGON_WING = [
  '...o.....',
  '..oWo....',
  '.oWWWo...',
  '.oWwWWo..',
  'oWwwWWWo.',
  'oWwwwWWWo',
  'oWwwwwWWo',
  'oWwwwwwWo',
  '.oWwwwwWo',
  '.oWwwwwo.',
  '..oWwwwo.',
  '..oWwwo..',
  '...oWo...',
];
/** Dragon body, left half (mirrored): horn, big head, eye with a shine, belly, feet. */
const DRAGON_BODY = [
  '...........o....',
  '..........oHo...',
  '..........oHoooo',
  '........ooDDDDDD',
  '.......oDLLLLDDD',
  '.......oDLwEDDDD',
  '.......oDLEEDDDD',
  '.......oDLeeDDDD',
  '.......oDDDDDDDD',
  '.......oDDDDDDoo',
  '........oDDDBBBB',
  '........oDDBBBBB',
  '.......oDDBBBBBB',
  '.......oDdBBBBBB',
  '.......oDdDBBBBB',
  '........oddDDDDD',
  '........oDDDDDDD',
  '........oLLLoooo',
  '........oooo....',
];
const DRAGON_TAIL = [at(28, 'oo'), at(27, 'oDHo'), at(24, 'oooDdo'), at(24, 'Dddo')];

/** Dragon, native facing left: wings up (or swept down mid-flap), tail trailing right. */
function dragon(blink: boolean, wingDown: boolean): Map2D {
  const g = grid(32, 32);
  const top = 32 - DRAGON_BODY.length;
  const wingY = top - 2 + (wingDown ? 4 : 0);
  stampRows(g, DRAGON_WING, 0, wingY);
  stampRows(g, flip(DRAGON_WING), 23, wingY);
  stampRows(g, mirrorHalf(DRAGON_BODY), 0, top);
  stampRows(g, DRAGON_TAIL, 0, top + 12);
  // shine on the same side for both eyes
  put(g, 20, top + 5, 'wE');
  if (blink) {
    for (const x of [10, 20]) {
      put(g, x, top + 5, 'DD');
      put(g, x, top + 6, 'oo');
      put(g, x, top + 7, 'DD');
    }
  }
  return g.map((r) => r.join(''));
}

// ---------------------------------------------------------------------------
// Idle props and sparkle
// ---------------------------------------------------------------------------

/**
 * Mug held at the chest, 10x12: a lit rim ellipse with coffee inside, a highlight down the body, the
 * handle ring on the outer side (columns 8..9, outside the body).
 */
const MUG = [
  '.oooooo...',
  'oLLLLLLo..',
  'oLccccLo..',
  'oBLLLLbo..',
  'oBBBBBbobb',
  'oBHBBBbo.b',
  'oBHBBBbo.b',
  'oBHBBBbo.b',
  'oBBBBBbobb',
  'oBBBBBbo..',
  'obbbbbbo..',
  '.oooooo...',
];

/**
 * Steam over the mug, 10x8, 3 frames: two 1 px wisps wiggling up the right side (clear of the face),
 * each frame the pattern three rows higher, so the loop rises.
 */
function steamFrame(f: number): string[] {
  const wiggle = [0, 1, 1, 0, 0, -1, -1, 0, 0];
  return Array.from({ length: 8 }, (_, r) => {
    const y = r + 3 * f;
    const row = new Array<string>(10).fill('.');
    if (y % 9 <= 5) row[5 + wiggle[y % 9]] = 's';
    if ((y + 4) % 9 <= 4) row[8 + wiggle[(y + 4) % 9]] = 's';
    return row.join('');
  });
}

/** A pixel Z with a 1 px dark outline all round, padded to an even size. */
function zGlyph(size: number): string[] {
  const z = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      y === 0 || y === size - 1 || x === size - 1 - y ? 'W' : '.',
    ),
  );
  const n = size + 3; // outline on both sides, one more column and row to make it even
  const g = grid(n, n);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (z[y][x] === 'W') {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (g[y + 1 + dy][x + 1 + dx] === '.') g[y + 1 + dy][x + 1 + dx] = 'o';
          }
      }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (z[y][x] === 'W') g[y + 1][x + 1] = 'W';
  return g.map((r) => r.join(''));
}

const SPARKLE = ['..YY..', '..WY..', 'YWWWWY', 'YWWWWY', '..YW..', '..YY..'];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function accessory(
  name: string,
  description: string,
  anchor: 'head' | 'shoulder',
  palette: Palette,
  directions: Record<'down' | 'up' | 'right', { row: number; rows: Map2D }>,
  variants?: Record<string, Palette>,
): Json {
  const dirs: Json = {};
  for (const [k, v] of Object.entries(directions)) {
    assertRect(`${name} ${k}`, v.rows, FRAME_W, v.rows.length);
    dirs[k] = { row: world(v.row), pixels: cells(v.rows) };
  }
  return {
    name,
    description,
    density: DENSITY,
    anchor,
    palette: { '.': '', ...palette },
    ...(variants ? { variants } : {}),
    directions: dirs,
  };
}

function companion(
  name: string,
  description: string,
  facing: 'left' | 'right',
  palette: Palette,
  idle: Map2D[],
  move: Map2D[],
): Json {
  for (const f of [...idle, ...move]) assertRect(name, f, 32, 32);
  return {
    name,
    description,
    density: DENSITY,
    width: 32,
    height: 32,
    facing,
    palette: { '.': '', ...palette },
    frames: { idle: idle.map(cells), move: move.map(cells) },
  };
}

const CAPE_PALETTE: Palette = {
  o: '#3a1420',
  C: '#7a2a3a',
  D: '#5c1f2c',
  L: '#9a3e50',
  G: '#ffc94a',
};

export function buildFlair(): Record<string, Json> {
  const headRow = HEAD_PAD; // map row on the head-top anchor
  const out: Record<string, Json> = {};

  out['headphones.json'] = accessory(
    'headphones',
    'Over-ear headphones for Sonnet and Opus. Art density 2 (32 px wide, like a frame); left is the right map flipped. `row` is WORLD px: the map row (art px / 2) that lands on the head-top anchor.',
    'head',
    { o: '#15151c', F: '#4a4a5c', H: '#9a9ab4', P: '#c8523a', Q: '#8c3526' },
    {
      down: { row: headRow, rows: headphonesFront() },
      up: { row: headRow, rows: headphonesFront() },
      right: { row: headRow, rows: headphonesSide() },
    },
  );

  out['crown.json'] = accessory(
    'crown',
    'Gold crown for Fable. Art density 2; its band rests on the top of the hair. `row` is WORLD px: the map row (art px / 2) on the head-top anchor.',
    'head',
    {
      o: '#5a3408',
      L: '#fff2b0',
      Y: '#ffc94a',
      D: '#d8962a',
      R: '#e8553a',
      r: '#ff9a7a',
      B: '#5ab8e8',
    },
    {
      down: { row: CROWN_ROW, rows: crownAt(8) },
      up: { row: CROWN_ROW, rows: crownAt(8) },
      right: { row: CROWN_ROW, rows: crownAt(7) },
    },
  );

  out['cape.json'] = accessory(
    'cape',
    'Cape for Opus (maroon) and Fable (gold), via `variants` keyed by tier. Behind the body for down/right, over it for up (back to the camera). Art density 2. `row` is WORLD px: the map row (art px / 2) on the shoulder anchor.',
    'shoulder',
    CAPE_PALETTE,
    {
      down: { row: CAPE_DOWN_ROW, rows: capeFromSpans(span(20, [7, 24], [1, 30]), [10, 21], 0.12) },
      up: {
        row: 0,
        rows: capeFromSpans(span(18, [8, 23], [4, 27]), [12, 19], 0.1, [
          [11, 0],
          [12, 0],
          [19, 0],
          [20, 0],
        ]),
      },
      right: { row: 0, rows: capeFromSpans(span(19, [9, 18], [2, 17]), [12], 0.25) },
    },
    {
      '3': CAPE_PALETTE,
      '4': { o: '#6a4408', C: '#d8a020', D: '#b07c14', L: '#f2c64a', G: '#fff2b0' },
    },
  );

  out['companion-bird.json'] = companion(
    'companion-bird',
    'Haiku companion: a little blue bird, native facing right. Hovers (bob handled by the renderer). Art density 2: 32x32 art px, 16x16 world px.',
    'right',
    {
      o: '#1e2a3a',
      B: '#6fb8ff',
      L: '#a8d8ff',
      D: '#3f86d0',
      d: '#2f6aa8',
      W: '#e8f4ff',
      Y: '#ffc94a',
      y: '#e0962a',
      F: '#e0962a',
      e: '#111111',
      w: '#ffffff',
    },
    [bird(false, false, false), bird(true, false, false)],
    [bird(false, true, false), bird(false, false, true)],
  );

  out['companion-cat.json'] = companion(
    'companion-cat',
    'Sonnet companion: an orange cat sitting, native facing left. Art density 2: 32x32 art px, 16x16 world px.',
    'left',
    {
      o: '#6a2e10',
      f: '#e8963c',
      F: '#f6b866',
      g: '#c06a24',
      W: '#fff4dc',
      V: '#e6d2b0',
      n: '#f08a8a',
      e: '#2a1a2e',
      y: '#8ccf5a',
      w: '#ffffff',
      p: '#f2a0a0',
    },
    [cat(false, false, 0), cat(true, true, 0)],
    [cat(false, false, 1), cat(false, true, 2)],
  );

  out['companion-owl.json'] = companion(
    'companion-owl',
    'Opus companion: a brown owl, symmetric (native facing right). Art density 2: 32x32 art px, 16x16 world px.',
    'right',
    {
      o: '#2a1a12',
      O: '#9a6a3a',
      D: '#6e4624',
      T: '#c49a64',
      t: '#a87c4a',
      W: '#f6e9cf',
      Y: '#ffc94a',
      y: '#ffc94a',
      e: '#1f1a2a',
      w: '#ffffff',
    },
    [owl(false, 0), owl(true, 0)],
    [owl(false, 1), owl(false, 2)],
  );

  out['companion-dragon.json'] = companion(
    'companion-dragon',
    'Fable companion: a purple dragon, native facing left. Hovers. Art density 2: 32x32 art px, 16x16 world px.',
    'left',
    {
      o: '#2a1430',
      D: '#8a4fd8',
      L: '#b07af0',
      d: '#6a36b0',
      W: '#c79bff',
      w: '#a87ae6',
      B: '#ffd0f0',
      e: '#ffe066',
      E: '#2a1430',
      H: '#fff2b0',
    },
    [dragon(false, false), dragon(true, false)],
    [dragon(false, false), dragon(false, true)],
  );

  assertRect('mug', MUG, 10, 12);
  const steam = [0, 1, 2].map(steamFrame);
  steam.forEach((f, i) => assertRect(`steam ${i}`, f, 10, 8));
  const bookCovers = [
    { k: '#b84a3a', l: '#d8705a' },
    { k: '#3a64b8', l: '#6a92d8' },
  ];
  const mugBodies = [
    { B: '#d0483c', b: '#9c3028', H: '#f08a7a', L: '#f6b0a4' },
    { B: '#3aa89a', b: '#277a70', H: '#7ad4c8', L: '#a8e6de' },
    { B: '#d8a630', b: '#a87c1c', H: '#f2d070', L: '#f8e2a0' },
  ];
  out['idle-props.json'] = {
    name: 'idle-props',
    description:
      'Palette-free overlays an idle agent holds, drawn over the sprite at fixed offsets from its top-left: the open book (pages with text lines; `b` is the page-turn with the right page lifting) held at chest height, and the mug held in one hand with its steam loop above it. `covers` and `bodies` are palette overrides the engine picks per agent (by seed); `palette` already holds the first of each. Art density 2; `dx`/`dy` are WORLD px.',
    density: DENSITY,
    palette: {
      '.': '',
      g: '#4a2014',
      ...bookCovers[0],
      W: '#fff4dc',
      x: '#9a9088',
      X: '#d8c8a8',
      o: '#3a2418',
      ...mugBodies[0],
      c: '#5a3420',
      s: '#e8e8e8a0',
    },
    book: {
      dx: world(6),
      dy: world(26),
      a: cells(OPEN_BOOK_A),
      b: cells(OPEN_BOOK_B),
      covers: bookCovers,
    },
    mug: { dx: world(22), dy: world(28), pixels: cells(MUG), bodies: mugBodies },
    steam: { dx: world(22), dy: world(20), frames: steam.map(cells) },
  };

  const zSmall = zGlyph(5);
  const zLarge = zGlyph(7);
  assertRect('z small', zSmall, 8, 8);
  assertRect('z large', zLarge, 10, 10);
  out['zz.json'] = {
    name: 'zz',
    description:
      'Napping Z glyphs: a 5 px and a 7 px pixel Z, white with a 1 px dark outline, padded to 8x8 and 10x10. The engine spawns them at `dx`/`dy` (WORLD px from the sprite top-left, over the bowed head of idle frame 1) and lets them rise and fade, at most two per agent. Art density 2.',
    density: DENSITY,
    palette: { '.': '', W: '#ffffff', o: '#2a2440' },
    dx: world(20),
    dy: world(10),
    small: cells(zSmall),
    large: cells(zLarge),
  };

  assertRect('sparkle', SPARKLE, 6, 6);
  out['sparkle.json'] = {
    name: 'sparkle',
    description: 'Twinkle for Fable (6x6 art px plus, 3x3 world px).',
    density: DENSITY,
    width: 6,
    height: 6,
    palette: { '.': '', W: '#ffffff', Y: '#ffd65a' },
    pixels: cells(SPARKLE),
  };
  return out;
}

/**
 * JSON with each pixel row on one line, so a diff of the art stays readable. Deterministic: key
 * order is insertion order.
 */
export function formatFlairJson(value: unknown): string {
  const isRow = (v: unknown) => Array.isArray(v) && v.every((c) => typeof c === 'string');
  const fmt = (v: unknown, indent: string): string => {
    if (isRow(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const inner = indent + '  ';
      return '[\n' + v.map((x) => inner + fmt(x, inner)).join(',\n') + '\n' + indent + ']';
    }
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      const inner = indent + '  ';
      return (
        '{\n' +
        entries.map(([k, x]) => inner + JSON.stringify(k) + ': ' + fmt(x, inner)).join(',\n') +
        '\n' +
        indent +
        '}'
      );
    }
    return JSON.stringify(v);
  };
  return fmt(value, '') + '\n';
}
