/**
 * Floor tile pattern storage and caching.
 *
 * Stores grayscale floor patterns loaded from individual PNGs in assets/floors/.
 * Uses shared colorize module for HSL tinting (Photoshop-style Colorize).
 * Caches colorized SpriteData by (pattern, h, s, b, c) key.
 */

import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import type { ColorValue } from '../components/ui/types.js';
import { CANVAS_ERROR_TILE_COLOR, FALLBACK_FLOOR_COLOR, TILE_SIZE } from '../constants.js';
import { clearColorizeCache, getColorizedSprite } from './colorize.js';
import type { SpriteData } from './types.js';

/** One tile of a single color, at art density. */
function solidTile(color: string): SpriteData {
  const size = TILE_SIZE * ART_DENSITY;
  return Array.from({ length: size }, () => Array(size).fill(color) as string[]);
}

/** Default solid gray tile used when floor tile PNGs are not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = solidTile(FALLBACK_FLOOR_COLOR);
/** Magenta tile for a pattern index with no sprite. Built once so the canvas cache keys on it. */
const ERROR_FLOOR_SPRITE: SpriteData = solidTile(CANVAS_ERROR_TILE_COLOR);

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = [];

// Re-export WALL_COLOR from constants for backward compatibility
export { WALL_COLOR } from '../constants.js';

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites;
  clearColorizeCache();
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 -> array index 0-6).
 *  Falls back to the default solid gray tile when floors.png is not loaded. */
function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1;
  if (idx < 0) return null;
  if (idx < floorSprites.length) return floorSprites[idx];
  // No PNG sprites loaded — return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE;
  return null;
}

/** Check if floor sprites are available (always true — falls back to default solid tile) */
export function hasFloorSprites(): boolean {
  return true;
}

/** Get count of available floor patterns (at least 1 for the default solid tile) */
export function getFloorPatternCount(): number {
  return floorSprites.length > 0 ? floorSprites.length : 1;
}

/** Get all floor sprites (for preview rendering, falls back to default solid tile) - unused */
// function getAllFloorSprites(): SpriteData[] {
//   return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE];
// }

/**
 * Get a colorized version of a floor sprite.
 * Uses Photoshop-style Colorize: grayscale -> HSL with given hue/saturation,
 * then brightness/contrast adjustment.
 */
export function getColorizedFloorSprite(patternIndex: number, color: ColorValue): SpriteData {
  const base = getFloorSprite(patternIndex);
  if (!base) return ERROR_FLOOR_SPRITE;

  // Floor tiles are always colorized (grayscale patterns need Photoshop-style Colorize)
  return getColorizedSprite(base, { ...color, colorize: true });
}
