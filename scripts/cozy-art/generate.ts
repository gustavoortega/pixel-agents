/**
 * Builds every cozy art file in memory. Pure and deterministic: no clock, no
 * randomness, no reading of existing PNGs. The same source always gives the same bytes.
 */

import { buildDecor } from './decor';
import type { SpriteSet } from './furniture';
import { buildChairs, buildDesks, buildPcs } from './furniture';
import { buildCharacterSheet, CHAR_LOOKS, computeAnchors, validateMaps } from './characters';
import { encodePng } from './png';
import { buildCarpets, buildFloors, buildWalls } from './tiles';

/** Where the generated files live, relative to the repository root. */
export const ASSETS_DIR = 'webview-ui/public/assets';
export const ANCHORS_PATH = 'webview-ui/src/office/sprites/flair/anchors.json';

/** Relative path (from the repository root) to file bytes. */
export type FileMap = Map<string, Buffer>;

export function buildAssets(): FileMap {
  validateMaps();
  const files: FileMap = new Map();

  CHAR_LOOKS.forEach((look, i) => {
    files.set(`${ASSETS_DIR}/characters/char_${i}.png`, encodePng(buildCharacterSheet(look)));
  });

  for (const group of [buildFloors(), buildWalls(), buildCarpets()]) {
    for (const [rel, canvas] of Object.entries(group)) {
      files.set(`${ASSETS_DIR}/${rel}`, encodePng(canvas));
    }
  }

  const furniture: SpriteSet = {};
  buildDesks(furniture);
  buildPcs(furniture);
  buildChairs(furniture);
  buildDecor(furniture);
  for (const [rel, canvas] of Object.entries(furniture)) {
    files.set(`${ASSETS_DIR}/furniture/${rel}`, encodePng(canvas));
  }

  files.set(ANCHORS_PATH, Buffer.from(JSON.stringify(computeAnchors(), null, 2) + '\n', 'utf8'));
  return files;
}
