/**
 * A repeated palette hue-shifts hair and outfit, never skin: the bundled sheets wear a fixed
 * 5-tone ramp and a shifted skin would turn green.
 */
import * as path from 'path';
import { expect, test } from 'vitest';

import { decodeAllCharacters } from '../../core/src/assets/loader.js';
import { SKIN_TONES } from '../src/constants.js';
import { getCharacterSprites, setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import { Direction } from '../src/office/types.js';

const sheets = decodeAllCharacters(path.resolve(__dirname, '..', 'public', 'assets'));

test('every bundled sheet has exactly one skin tone and its mouth shade in SKIN_TONES', () => {
  expect(sheets).toHaveLength(12);
  for (const [n, sheet] of sheets.entries()) {
    const skin = new Set(sheet.down[1].flat().filter((px) => SKIN_TONES.has(px)));
    expect(skin.size, `char_${n}`).toBe(2);
  }
});

test('hue shift changes hair and outfit but leaves every SKIN_TONES pixel unchanged', () => {
  setCharacterTemplates(sheets);
  for (let n = 0; n < sheets.length; n++) {
    const base = getCharacterSprites(n, 0).walk[Direction.DOWN][1];
    const shifted = getCharacterSprites(n, 120).walk[Direction.DOWN][1];
    let skinPixels = 0;
    let changed = 0;
    base.forEach((row, y) =>
      row.forEach((px, x) => {
        if (SKIN_TONES.has(px)) {
          skinPixels++;
          expect(shifted[y][x], `char_${n} skin at ${x},${y}`).toBe(px);
        } else if (px !== '' && shifted[y][x] !== px) {
          changed++;
        }
      }),
    );
    expect(skinPixels, `char_${n} has skin`).toBeGreaterThan(0);
    expect(changed, `char_${n} hair/outfit shift`).toBeGreaterThan(0);
  }
});
