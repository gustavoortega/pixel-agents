/**
 * Soft oval under every character: sprite and the z order it sorts at. Pure, so the
 * renderer and the tests share one definition of "below the outline".
 */

import { upscaleSprite } from '../../../core/src/assets/artDensity.js';
import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import {
  OUTLINE_Z_SORT_OFFSET,
  SHADOW_COLOR,
  SHADOW_SIZE_PX,
  SHADOW_SMALL_SIZE_PX,
  SHADOW_Z_SORT_OFFSET,
} from '../constants.js';
import type { SpriteData } from './types.js';

/** Sort keys of the layers that make up one character; lower draws first. */
export function characterLayerZ(charZY: number): { shadow: number; outline: number; body: number } {
  return {
    shadow: charZY - SHADOW_Z_SORT_OFFSET,
    outline: charZY - OUTLINE_Z_SORT_OFFSET,
    body: charZY,
  };
}

function ovalSprite(w: number, h: number): SpriteData {
  const rows: SpriteData = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      row.push(dx * dx + dy * dy <= 1 ? SHADOW_COLOR : '');
    }
    rows.push(row);
  }
  return rows;
}

// Built once: getCachedSprite keys its canvases by sprite identity. Rasterized in world px and
// upscaled, so the oval keeps the exact shape it had before art went to ART_DENSITY.
const SHADOW_SPRITE = upscaleSprite(ovalSprite(SHADOW_SIZE_PX.w, SHADOW_SIZE_PX.h), ART_DENSITY);
const SHADOW_SMALL_SPRITE = upscaleSprite(
  ovalSprite(SHADOW_SMALL_SIZE_PX.w, SHADOW_SMALL_SIZE_PX.h),
  ART_DENSITY,
);

/** Sub-agents and companions get the small oval. */
export function shadowSprite(small: boolean): SpriteData {
  return small ? SHADOW_SMALL_SPRITE : SHADOW_SPRITE;
}
