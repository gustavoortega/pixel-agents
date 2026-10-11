/**
 * A repeated palette hue-shifts hair and outfit, never skin: the bundled sheets wear a fixed
 * 5-tone ramp and a shifted skin would turn green.
 */
import * as path from 'path';
import { expect, test } from 'vitest';

import { decodeAllCharacters } from '../../core/src/assets/loader.js';
import { HUE_LOCKED } from '../../core/src/assets/skinTones.js';
import { getCharacterSprites, setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import { Direction } from '../src/office/types.js';

const sheets = decodeAllCharacters(path.resolve(__dirname, '..', 'public', 'assets'));

test('every bundled sheet has exactly one skin tone and its mouth shade in HUE_LOCKED', () => {
  expect(sheets).toHaveLength(12);
  for (const [n, sheet] of sheets.entries()) {
    const skin = new Set(sheet.down[1].flat().filter((px) => HUE_LOCKED.has(px)));
    expect(skin.size, `char_${n}`).toBe(2);
  }
});

test('hue shift changes hair and outfit but leaves every HUE_LOCKED pixel unchanged', () => {
  // The bundled sheets wear only some locked colors; a row of every one of them under the walk
  // frame makes the whole set reach the hue shift, whatever the art uses today.
  const locked = [...HUE_LOCKED];
  const withLockedRow = sheets.map((sheet) => ({
    ...sheet,
    down: sheet.down.map((frame, i) =>
      i === 1 ? [...frame, frame[0].map((_, x) => locked[x % locked.length])] : frame,
    ),
  }));
  setCharacterTemplates(withLockedRow);
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
