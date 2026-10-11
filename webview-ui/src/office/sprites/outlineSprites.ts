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

/** Build a 1px outline SpriteData of `color` (2px larger in each dimension) */
function buildOutline(sprite: SpriteData, color: string): SpriteData {
  const rows = sprite.length;
  const cols = sprite[0].length;
  // Expanded grid: +2 in each dimension for 1px border
  const outline: string[][] = [];
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(''));
  }

  // For each opaque pixel, mark its 4 cardinal neighbors with the outline color
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === '') continue;
      const er = r + 1;
      const ec = c + 1;
      if (outline[er - 1][ec] === '') outline[er - 1][ec] = color;
      if (outline[er + 1][ec] === '') outline[er + 1][ec] = color;
      if (outline[er][ec - 1] === '') outline[er][ec - 1] = color;
      if (outline[er][ec + 1] === '') outline[er][ec + 1] = color;
    }
  }

  // Clear pixels that overlap with original opaque pixels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== '') {
        outline[r + 1][c + 1] = '';
      }
    }
  }
  return outline;
}

/** Generate a 1px white outline SpriteData (2px larger in each dimension) */
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
