/**
 * The sheet's pixel art as character grids: one character per pixel, `.` transparent, every other
 * character a palette class (`px-<char>` in inspector.css). Drawn as SVG rects with crisp edges,
 * because the pixel font has no check, pip, hourglass, coin or flag (A13).
 */

import type { ModelTier } from '../../../../core/src/provider.js';

export type Bitmap = readonly string[];

/** One rect per horizontal run of a palette character. */
export interface PixelRun {
  x: number;
  y: number;
  w: number;
  ch: string;
}

export function pixelRuns(rows: Bitmap): PixelRun[] {
  const runs: PixelRun[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') runs.push({ x, y, w: end - x, ch });
      x = end;
    }
  });
  return runs;
}

/** The tier glyph alone, 9 px (E15 gem), outlined in ink so it reads on paper. */
const TIER_GEM_9: Record<ModelTier, Bitmap> = {
  1: [
    '.........',
    '...kkk...',
    '..kfffk..',
    '.kffhffk.',
    '.kfffffk.',
    '.kfffffk.',
    '..kfffk..',
    '...kkk...',
    '.........',
  ],
  2: [
    '.........',
    '.kkkkkkk.',
    '.kffffhk.',
    '.kfffffk.',
    '.kfffffk.',
    '.kfffffk.',
    '.kfffffk.',
    '.kkkkkkk.',
    '.........',
  ],
  3: [
    '....k....',
    '...kfk...',
    '..kfhfk..',
    '.kfffffk.',
    'kfffffffk',
    '.kfffffk.',
    '..kfffk..',
    '...kfk...',
    '....k....',
  ],
  4: [
    '...kkk...',
    '...kfk...',
    '..kkhkk..',
    'kkkfffkkk',
    'kfffffffk',
    'kkkfffkkk',
    '..kkfkk..',
    '...kfk...',
    '...kkk...',
  ],
};

/** Tier fill and highlight characters: `px-1`..`px-4` and `px-x`, `px-y`, `px-z`, `px-v`. */
function tierChars(tier: ModelTier): { f: string; h: string } {
  return { f: String(tier), h: 'xyzv'[tier - 1] };
}

export function gemBitmap(tier: ModelTier): Bitmap {
  const { f, h } = tierChars(tier);
  return TIER_GEM_9[tier].map((r) => r.replace(/f/g, f).replace(/h/g, h));
}

/**
 * Palette: k ink, p paper, P paper-2, q paper-3, g gold, G gold-deep, w light, R rust, s sage,
 * S sage-ink, m smoke; 1-4 tier fill, x y z v its highlight.
 */
export const ICONS = {
  check: ['......k', '.....kk', 'k...kk.', 'kk.kk..', '.kkk...', '..k....'],
  hourglass: [
    'kkkkkkk',
    '.kPPPk.',
    '.kgggk.',
    '..kgk..',
    '...k...',
    '..kPk..',
    '.kPgPk.',
    '.kgggk.',
    'kkkkkkk',
  ],
  coin: [
    '..kkkk..',
    '.kggggk.',
    'kggwgggk',
    'kgwgggGk',
    'kgggggGk',
    'kggggGGk',
    '.kGGGGk.',
    '..kkkk..',
  ],
  candle: [
    '..g...',
    '.gwg..',
    '.gwg..',
    '..k...',
    '.kkkk.',
    '.kwwk.',
    '.kwPk.',
    '.kwPk.',
    '.kwPk.',
    'kkkkkk',
  ],
  candleCold: [
    '...m..',
    '..m...',
    '...m..',
    '..k...',
    '.kkkk.',
    '.kwwk.',
    '.kwPk.',
    '.kwPk.',
    '.kwPk.',
    'kkkkkk',
  ],
  folder: [
    'kkkk.....',
    'kqqqkkkkk',
    'kqqqqqqqk',
    'kqqqqqqqk',
    'kqqqqqqqk',
    'kqqqqqqqk',
    'kkkkkkkkk',
  ],
  branch: [
    '.k...k.',
    'kkk.kkk',
    '.k...k.',
    '.k..k..',
    '.k.k...',
    '.kk....',
    '.k.....',
    'kkk....',
    '.k.....',
  ],
  warn: [
    '....k....',
    '...kgk...',
    '...kgk...',
    '..kgkgk..',
    '..kgkgk..',
    '.kgggggk.',
    '.kggkggk.',
    'kgggggggk',
    'kkkkkkkkk',
  ],
  pulse: [
    '.........',
    '....k....',
    '...kk....',
    'kkkk.k.kk',
    '......kk.',
    '......k..',
    '.........',
  ],
  flask: ['.kkk.', '..k..', '..k..', '.kPk.', 'kPPPk', 'kSSSk', 'kkkkk'],
  page: [
    'kkkkk..',
    'kpppkk.',
    'kpppkpk',
    'kpppkkk',
    'kpppppk',
    'kpkkkpk',
    'kpppppk',
    'kpkkkpk',
    'kkkkkkk',
  ],
  cursor: ['kk', 'kk', 'kk', 'kk'],
} as const satisfies Record<string, Bitmap>;

export type IconName = keyof typeof ICONS;
