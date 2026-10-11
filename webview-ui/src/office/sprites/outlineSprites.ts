import { ART_DENSITY } from '../../../../core/src/assets/constants.js';
import type { SpriteData } from '../types.js';

// DOM-free on purpose: the node-side tests import this directly.

// ── Outline sprite generation ─────────────────────────────────

const outlineCache = new WeakMap<SpriteData, SpriteData>();
/** One outline per (frame sprite, color). Frame sprites are stable per character
 *  sheet, so this is the (sheet, direction, frame, color) memo: the draw cache
 *  below is keyed on SpriteData identity, so a fresh outline per frame would
 *  rebuild a canvas on every draw. */
const tintedOutlineCache = new WeakMap<SpriteData, Map<string, SpriteData>>();

const SELECTION_OUTLINE_COLOR = '#FFFFFF';

/**
 * Outline of `color` ART_DENSITY art px thick (one world px), the grid grown by that on every
 * side. A clear pixel is outlined when an opaque one lies within ART_DENSITY straight up, down,
 * left or right of it: a cross, not a disc, so on upscaled 1x art it is exactly the old 1 px
 * 4-neighbour outline, corners included.
 */
function buildOutline(sprite: SpriteData, color: string): SpriteData {
  const t = ART_DENSITY;
  const rows = sprite.length;
  const cols = sprite[0].length;
  const outline: string[][] = [];
  for (let r = 0; r < rows + 2 * t; r++) {
    outline.push(new Array<string>(cols + 2 * t).fill(''));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === '') continue;
      const er = r + t;
      const ec = c + t;
      for (let d = 1; d <= t; d++) {
        outline[er - d][ec] = color;
        outline[er + d][ec] = color;
        outline[er][ec - d] = color;
        outline[er][ec + d] = color;
      }
    }
  }
  // Clear what the sprite itself covers
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== '') outline[r + t][c + t] = '';
    }
  }
  return outline;
}

/** White outline, one world px thick around the sprite (see buildOutline). */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineCache.get(sprite);
  if (cached) return cached;
  const outline = buildOutline(sprite, SELECTION_OUTLINE_COLOR);
  outlineCache.set(sprite, outline);
  return outline;
}

/** The same outline in another color (the rarity outline), memoized per sprite and color. */
export function getTintedOutlineSprite(sprite: SpriteData, color: string): SpriteData {
  let byColor = tintedOutlineCache.get(sprite);
  if (!byColor) {
    byColor = new Map();
    tintedOutlineCache.set(sprite, byColor);
  }
  const cached = byColor.get(color);
  if (cached) return cached;
  const outline = buildOutline(sprite, color);
  byColor.set(color, outline);
  return outline;
}
