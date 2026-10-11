/**
 * A repeated palette hue-shifts hair and outfit, never skin: a shifted skin would turn green.
 * Which locked colors each sheet may wear is the generator's contract (cozyAssets.test.ts).
 */
import * as path from 'path';
import { expect, test } from 'vitest';

import { decodeAllCharacters } from '../../core/src/assets/loader.js';
import { HUE_LOCKED } from '../../core/src/assets/skinTones.js';
import { getCharacterSprites, setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import { Direction } from '../src/office/types.js';

const sheets = decodeAllCharacters(path.resolve(__dirname, '..', 'public', 'assets'));

test('hue shift changes hair and outfit but leaves every HUE_LOCKED pixel unchanged', () => {
  // Each sheet wears only its own tone's locked colors; rows holding every one of them under the
  // walk frame make the whole set reach the hue shift, whatever the art uses today.
  const locked = [...HUE_LOCKED];
  const withLockedRows = sheets.map((sheet) => ({
    ...sheet,
    down: sheet.down.map((frame, i) => {
      if (i !== 1) return frame;
      const w = frame[0].length;
      const extra = Array.from({ length: Math.ceil(locked.length / w) }, (_, r) =>
        Array.from({ length: w }, (_, x) => locked[(r * w + x) % locked.length]),
      );
      return [...frame, ...extra];
    }),
  }));
  setCharacterTemplates(withLockedRows);
  for (let n = 0; n < sheets.length; n++) {
    const base = getCharacterSprites(n, 0).walk[Direction.DOWN][1];
    const shifted = getCharacterSprites(n, 120).walk[Direction.DOWN][1];
    let skinPixels = 0;
    let changed = 0;
    base.forEach((row, y) =>
      row.forEach((px, x) => {
        if (HUE_LOCKED.has(px)) {
          skinPixels++;
          expect(shifted[y][x], `char_${n} skin at ${x},${y}`).toBe(px);
        } else if (px !== '' && shifted[y][x] !== px) {
          changed++;
        }
      }),
    );
    expect(skinPixels, `char_${n} has skin`).toBeGreaterThan(0);
    expect(new Set(base.flat().filter((px) => HUE_LOCKED.has(px))).size).toBe(HUE_LOCKED.size);
    expect(changed, `char_${n} hair/outfit shift`).toBeGreaterThan(0);
  }
});
