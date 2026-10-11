/**
 * ONE cozy chibi, authored as pixel maps, drawn into the 112x128 character sheet
 * the app loads: 7 frames x 16 px wide, 4 rows x 32 px tall.
 *
 *   rows:   0 = down, 1 = up (back view, how seated agents are seen), 2 = right (left is a runtime flip),
 *           3 = idle poses, front view only (see below)
 *   frames: 0 walk1, 1 walk2 (also idle), 2 walk3, 3 type1, 4 type2, 5 read1, 6 read2
 *   row 3:  0 sit-idle, 1 head-down (nap), 2 page-turn A, 3 page-turn B (4 frames, the rest is transparent)
 *
 * The book and the mug an agent holds are NOT in the sheet: they are palette-free overlays the
 * renderer draws on top, so every palette shares them.
 *
 * char_0..11 are palette swaps of that single base (hair, skin, outfit).
 *
 * Map legend:
 *   o outline   h hair  H hair light  d hair dark   s skin  S skin shade  c blush  m mouth
 *   e eye  w eye shine   t outfit  T outfit light  u outfit dark   p pants  b shoes
 *   k book cover  W book page
 */

import type { Palette } from './canvas';
import { assertRect, Canvas, mirror, shade } from './canvas';

export const FRAME_W = 16;
export const FRAME_H = 32;
export const FRAMES = 7;
/** Frames in the idle row (row 3); the decoder appends them to `down` as frames 7..10. */
export const IDLE_FRAMES = 4;
export const DIRS = ['down', 'up', 'right'] as const;
export type Dir = (typeof DIRS)[number];
/** Sheet rows: one per direction plus the idle row. */
export const SHEET_ROWS = DIRS.length + 1;

// Frame rows where the layers sit.
const HEAD_Y = 3;
const TORSO_Y = 15;
const LEGS_Y = 22;

// ---------------------------------------------------------------------------
// Heads (12 rows)
// ---------------------------------------------------------------------------

/** Left half of the front view, mirrored. */
const HEAD_DOWN_HALF = [
  '....oooo',
  '...ohhhh',
  '..ohhHHh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhss',
  '..ohhsss',
  '..ohewss',
  '..oheess',
  '..osccss',
  '...osssm',
  '....oooo',
];

/** Back of the head: hair everywhere, a light swirl on top and a shadow at the nape. */
const HEAD_UP_HALF = [
  '....oooo',
  '...ohhhh',
  '..ohhHHh',
  '..ohhHhh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhdd',
  '...ohddd',
  '....oooo',
];

/** Facing right: hair at the back and top, face at the front. */
const HEAD_RIGHT = [
  '....oooooo......',
  '...ohhhhhhoo....',
  '..ohhHHhhhhho...',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhsso..',
  '..ohhhhhhhsssso.',
  '..ohhhhhsssesso.',
  '..ohhhhhsssesso.',
  '..ohhhhhsccsso..',
  '...ohhhhsssssmo.',
  '....oooooooooo..',
];

/** Head bowed onto the desk: only the crown shows, hair all around (9 rows). */
const NAP_HEAD_HALF = [
  '....oooo',
  '...ohhhh',
  '..ohhHHh',
  '..ohhHhh',
  '..ohhhhh',
  '..ohhhhh',
  '..ohhhdd',
  '...ohddd',
  '....oooo',
];
const NAP_HEAD_Y = 9;

const HEADS: Record<Dir, string[]> = {
  down: mirror(HEAD_DOWN_HALF),
  up: mirror(HEAD_UP_HALF),
  right: HEAD_RIGHT,
};

// ---------------------------------------------------------------------------
// Torsos (7 rows, rows 15..21)
// ---------------------------------------------------------------------------

const TORSO_DOWN = [
  'otttssttto',
  'otttttttto',
  'otttttttto',
  'otttttttto',
  'otttttttto',
  'ouuuuuuuuo',
  'oppppppppo',
];
const TORSO_UP = [
  'otttttttto',
  'otttttttto',
  'otttttttto',
  'otttttttto',
  'otttttttto',
  'ouuuuuuuuo',
  'oppppppppo',
];
const TORSO_RIGHT = ['otttto', 'otttto', 'otttto', 'otttto', 'otttto', 'ouuuuo', 'oppppo'];

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

/** Front/back legs. Lengths are in rows from LEGS_Y; the longer leg touches the ground (row 28). */
function legsFrontBack(leftLen: number, rightLen: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < 7; i++) {
    const row = new Array<string>(16).fill('.');
    const put = (x: number, seg: string) => {
      for (let k = 0; k < seg.length; k++) {
        row[x + k] = seg[k];
      }
    };
    const draw = (x: number, len: number) => {
      if (i < len - 2) {
        put(x + 1, 'oppo');
      } else if (i === len - 2) {
        put(x, 'obbbo');
      } else if (i === len - 1) {
        put(x, 'ooooo');
      }
    };
    draw(3, leftLen);
    draw(8, rightLen);
    rows.push(row.join(''));
  }
  return rows;
}

/** Side legs; `back` is the far leg, `front` the near one. */
function legsSide(backX: number, backLen: number, frontX: number, frontLen: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < 7; i++) {
    const row = new Array<string>(16).fill('.');
    const draw = (x: number, len: number) => {
      let seg: string;
      if (i < len - 2) {
        seg = 'oppo';
      } else if (i === len - 2) {
        seg = 'obbbbo';
      } else if (i === len - 1) {
        seg = 'oooooo';
      } else {
        return;
      }
      for (let k = 0; k < seg.length; k++) {
        row[x + k] = seg[k];
      }
    };
    draw(backX, backLen);
    draw(frontX, frontLen);
    rows.push(row.join(''));
  }
  return rows;
}

const SEATED_DOWN = [
  '....oppppppo....',
  '....oppppppo....',
  '...obbbooobbbo..',
  '...oooooooooo...',
];
const SEATED_UP = ['....oppppppo....', '....oppppppo....', '....oppppppo....', '....oooooooo....'];
const SEATED_RIGHT = [
  '....opppppppo...',
  '....opppppppo...',
  '.........obbbo..',
  '.........ooooo..',
];

// ---------------------------------------------------------------------------
// Arms and props, as {rows, x, y} stamps relative to the upper-body shift
// ---------------------------------------------------------------------------

interface Stamp {
  rows: string[];
  x: number;
  y: number;
}

const ARM_L = ['ot', 'ot', 'ot', 'ot', 'os', 'oo'];
const ARM_R = ['to', 'to', 'to', 'to', 'so', 'oo'];
const HAND = ['ss', 'oo'];
const BOOK_FRONT = ['oooooooo', 'okkkkkko', 'okkkkkko', 'okkkkkko', 'oooooooo'];
const BOOK_FRONT_FLIP = ['oooooooo', 'okkkkkko', 'okkkkkko', 'okkkkWko', 'oooooooo'];
const BOOK_SIDE = ['oooo', 'okko', 'okWo', 'okko', 'oooo'];
const BOOK_SIDE_FLIP = ['oooo', 'okWo', 'okko', 'okko', 'oooo'];
const ARM_SIDE = ['ot', 'ot', 'ot', 'os', 'oo'];
const FOREARM_SIDE = ['ottso', 'ooooo'];

interface Pose {
  /** Upper-body vertical shift (head, torso and arms move together). */
  dy: number;
  legs: string[] | null;
  seated: boolean;
  arms: Stamp[];
  /** A head other than the dir's own, at an absolute row (the bowed nap head). */
  head?: { rows: string[]; y: number };
}

/**
 * Idle poses, front view: sit-idle (hands in the lap), head-down (nap), page-turn A and B.
 * No book and no mug here: both are overlays, so the hands only frame the empty space. The book
 * goes at rows 15-19 (16-20 on page B), high on the chest, so the desk in front of a seated agent
 * does not hide it.
 */
const IDLE_POSES: Pose[] = [
  {
    dy: 0,
    legs: null,
    seated: true,
    arms: [
      { rows: ARM_L, x: 1, y: 16 },
      { rows: ARM_R, x: 13, y: 16 },
      { rows: HAND, x: 5, y: 20 },
      { rows: HAND, x: 9, y: 20 },
    ],
  },
  {
    dy: 0,
    legs: null,
    seated: true,
    arms: [
      { rows: ARM_L, x: 1, y: 17 },
      { rows: ARM_R, x: 13, y: 17 },
      { rows: HAND, x: 4, y: 21 },
      { rows: HAND, x: 10, y: 21 },
    ],
    head: { rows: mirror(NAP_HEAD_HALF), y: NAP_HEAD_Y },
  },
  {
    dy: 0,
    legs: null,
    seated: true,
    arms: [
      { rows: ARM_L, x: 1, y: 16 },
      { rows: ARM_R, x: 13, y: 16 },
      { rows: HAND, x: 3, y: 17 },
      { rows: HAND, x: 11, y: 17 },
    ],
  },
  {
    dy: 1,
    legs: null,
    seated: true,
    arms: [
      { rows: ARM_L, x: 1, y: 16 },
      { rows: ARM_R, x: 13, y: 16 },
      { rows: HAND, x: 3, y: 17 },
      { rows: HAND, x: 11, y: 16 },
    ],
  },
];

function posesFor(dir: Dir): Pose[] {
  if (dir === 'right') {
    const stand = legsSide(5, 6, 6, 7);
    return [
      { dy: 1, legs: legsSide(3, 6, 8, 7), seated: false, arms: [{ rows: ARM_SIDE, x: 9, y: 16 }] },
      { dy: 0, legs: stand, seated: false, arms: [{ rows: ARM_SIDE, x: 6, y: 16 }] },
      { dy: 1, legs: legsSide(8, 6, 4, 7), seated: false, arms: [{ rows: ARM_SIDE, x: 3, y: 16 }] },
      { dy: 0, legs: null, seated: true, arms: [{ rows: FOREARM_SIDE, x: 8, y: 18 }] },
      { dy: 0, legs: null, seated: true, arms: [{ rows: FOREARM_SIDE, x: 8, y: 19 }] },
      {
        dy: 0,
        legs: null,
        seated: true,
        arms: [
          { rows: BOOK_SIDE, x: 11, y: 17 },
          { rows: HAND, x: 9, y: 19 },
        ],
      },
      {
        dy: 1,
        legs: null,
        seated: true,
        arms: [
          { rows: BOOK_SIDE_FLIP, x: 11, y: 17 },
          { rows: HAND, x: 9, y: 19 },
        ],
      },
    ];
  }
  const up = dir === 'up';
  return [
    {
      dy: 1,
      legs: legsFrontBack(7, 5),
      seated: false,
      arms: [
        { rows: ARM_L, x: 1, y: 15 },
        { rows: ARM_R, x: 13, y: 17 },
      ],
    },
    {
      dy: 0,
      legs: legsFrontBack(7, 7),
      seated: false,
      arms: [
        { rows: ARM_L, x: 1, y: 16 },
        { rows: ARM_R, x: 13, y: 16 },
      ],
    },
    {
      dy: 1,
      legs: legsFrontBack(5, 7),
      seated: false,
      arms: [
        { rows: ARM_L, x: 1, y: 17 },
        { rows: ARM_R, x: 13, y: 15 },
      ],
    },
    // typing: hands alternate (front view: on the desk in front; back view: elbows work)
    {
      dy: 0,
      legs: null,
      seated: true,
      arms: up
        ? [
            { rows: ARM_L, x: 1, y: 17 },
            { rows: ARM_R, x: 13, y: 16 },
          ]
        : [
            { rows: ARM_L, x: 1, y: 16 },
            { rows: ARM_R, x: 13, y: 16 },
            { rows: HAND, x: 5, y: 20 },
            { rows: HAND, x: 9, y: 19 },
          ],
    },
    {
      dy: 0,
      legs: null,
      seated: true,
      arms: up
        ? [
            { rows: ARM_L, x: 1, y: 16 },
            { rows: ARM_R, x: 13, y: 17 },
          ]
        : [
            { rows: ARM_L, x: 1, y: 16 },
            { rows: ARM_R, x: 13, y: 16 },
            { rows: HAND, x: 5, y: 19 },
            { rows: HAND, x: 9, y: 20 },
          ],
    },
    // reading: book held up in front (front view) / elbows tucked in (back view)
    {
      dy: 0,
      legs: null,
      seated: true,
      arms: up
        ? [
            { rows: ARM_L, x: 2, y: 16 },
            { rows: ARM_R, x: 12, y: 16 },
          ]
        : [
            { rows: ARM_L, x: 1, y: 16 },
            { rows: ARM_R, x: 13, y: 16 },
            { rows: BOOK_FRONT, x: 4, y: 17 },
          ],
    },
    {
      dy: 1,
      legs: null,
      seated: true,
      arms: up
        ? [
            { rows: ARM_L, x: 2, y: 16 },
            { rows: ARM_R, x: 12, y: 16 },
          ]
        : [
            { rows: ARM_L, x: 1, y: 16 },
            { rows: ARM_R, x: 13, y: 16 },
            { rows: BOOK_FRONT_FLIP, x: 4, y: 17 },
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

export function composeFrame(dir: Dir, frame: number): FrameGrid {
  return composePose(dir, posesFor(dir)[frame]);
}

/** Idle row frame `i` (0 sit-idle, 1 head-down, 2 page-turn A, 3 page-turn B), front view. */
export function composeIdleFrame(i: number): FrameGrid {
  return composePose('down', IDLE_POSES[i]);
}

function composePose(dir: Dir, pose: Pose): FrameGrid {
  const g = blank();
  if (pose.legs) {
    stampGrid(g, pose.legs, 0, LEGS_Y);
  } else {
    const seat = dir === 'down' ? SEATED_DOWN : dir === 'up' ? SEATED_UP : SEATED_RIGHT;
    stampGrid(g, seat, 0, LEGS_Y);
  }
  const torso = dir === 'down' ? TORSO_DOWN : dir === 'up' ? TORSO_UP : TORSO_RIGHT;
  stampGrid(g, torso, dir === 'right' ? 5 : 3, TORSO_Y + pose.dy);
  for (const a of pose.arms) {
    stampGrid(g, a.rows, a.x, a.y + pose.dy);
  }
  if (pose.head) {
    stampGrid(g, pose.head.rows, 0, pose.head.y);
  } else {
    stampGrid(g, HEADS[dir], 0, HEAD_Y + pose.dy);
  }
  return g;
}

export function validateMaps(): void {
  assertRect('HEAD down', HEADS.down, 16, 12);
  assertRect('HEAD up', HEADS.up, 16, 12);
  assertRect('HEAD right', HEADS.right, 16, 12);
  assertRect('HEAD nap', mirror(NAP_HEAD_HALF), 16, 9);
  assertRect('TORSO down', TORSO_DOWN, 10, 7);
  assertRect('TORSO up', TORSO_UP, 10, 7);
  assertRect('TORSO right', TORSO_RIGHT, 6, 7);
  assertRect('SEATED down', SEATED_DOWN, 16, 4);
  assertRect('SEATED up', SEATED_UP, 16, 4);
  assertRect('SEATED right', SEATED_RIGHT, 16, 4);
  for (const dir of DIRS) {
    posesFor(dir).forEach((p, i) => {
      if (p.legs) {
        assertRect(`legs ${dir} ${i}`, p.legs, 16, 7);
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
  skin: string;
  outfit: string;
}

/**
 * Skin is never hue-shifted at runtime, so the ramp is fixed: sheet n wears tone n mod 5.
 * Keep in sync with `SKIN_TONES` in webview-ui/src/constants.ts (the runtime skips these pixels).
 */
export const SKIN_RAMP: readonly string[] = ['#f6d9b8', '#f2c9a0', '#c98d5e', '#8d5a3b', '#5a3a28'];

/** char_0..11. Same chibi; hair and outfit differ per sheet, skin comes from the ramp. */
const CHAR_PALETTES: ReadonlyArray<Omit<CharLook, 'skin'>> = [
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

export const CHAR_LOOKS: readonly CharLook[] = CHAR_PALETTES.map((p, n) => ({
  ...p,
  skin: SKIN_RAMP[n % SKIN_RAMP.length],
}));

export function paletteFor(look: CharLook): Palette {
  return {
    o: '#2a1a12',
    h: look.hair,
    H: shade(look.hair, 0.28),
    d: shade(look.hair, -0.3),
    s: look.skin,
    S: shade(look.skin, -0.12),
    c: shade('#f08a8a', -0.05),
    m: shade(look.skin, -0.38),
    e: '#1f1a2a',
    w: '#ffffff',
    t: look.outfit,
    T: shade(look.outfit, 0.2),
    u: shade(look.outfit, -0.25),
    p: '#3a3f5c',
    b: '#3b2412',
    k: '#8a4b2a',
    W: '#fff4dc',
  };
}

export function buildCharacterSheet(look: CharLook): Canvas {
  const sheet = new Canvas(FRAME_W * FRAMES, FRAME_H * SHEET_ROWS);
  const pal = paletteFor(look);
  DIRS.forEach((dir, row) => {
    for (let f = 0; f < FRAMES; f++) {
      const g = composeFrame(dir, f);
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
      composeIdleFrame(f).map((r) => r.join('')),
      pal,
      f * FRAME_W,
      DIRS.length * FRAME_H,
    );
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Flair anchors (for accessories drawn over the sprite)
// ---------------------------------------------------------------------------

export interface DirAnchors {
  /** First opaque row of the head in the neutral frame (walk2, also idle). */
  headTopY: number;
  /** First outfit row (the shoulder line) in the neutral frame. */
  shoulderY: number;
  /** Per frame: rows the head sits below the neutral frame. */
  bob: number[];
  /** Per frame: rows the shoulder line sits below the neutral frame. Differs from `bob` only when
   *  the head moves alone (the bowed head of the nap frame). */
  shoulderBob: number[];
}

export type Anchors = Record<Dir, DirAnchors>;

function firstRow(g: FrameGrid, pred: (c: string) => boolean): number {
  for (let y = 0; y < g.length; y++) {
    if (g[y].some(pred)) {
      return y;
    }
  }
  return -1;
}

export function computeAnchors(): Anchors {
  const out = {} as Anchors;
  for (const dir of DIRS) {
    const frames = Array.from({ length: FRAMES }, (_, f) => composeFrame(dir, f));
    // The idle row is front view only: its frames follow the seven of `down` (frames 7..10).
    if (dir === 'down') {
      for (let f = 0; f < IDLE_FRAMES; f++) frames.push(composeIdleFrame(f));
    }
    const top = frames.map((g) => firstRow(g, (c) => c !== '.'));
    const shoulder = frames.map((g) => firstRow(g, (c) => c === 't'));
    const neutral = 1;
    out[dir] = {
      headTopY: top[neutral],
      shoulderY: shoulder[neutral],
      bob: top.map((t) => t - top[neutral]),
      shoulderBob: shoulder.map((t) => t - shoulder[neutral]),
    };
  }
  return out;
}
