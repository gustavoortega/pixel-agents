/**
 * Layout of the always-on overlay text: agent nameplates and room signs.
 *
 * Pure geometry with no DOM or canvas access. Labels are laid out in CSS
 * pixels, signs in world units (the projection converts them), so the sign
 * rects can be handed to the label pass as obstacles.
 */

import {
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_SIGN_DOT_GAP_PX,
  AREA_SIGN_DOT_PX,
  AREA_SIGN_GLYPH_WIDTH_EM,
  AREA_SIGN_PADDING_PX,
  COMPACT_LABEL_LINE_HEIGHT_PX,
  LABEL_LAYOUT_MAX_DISPLACEMENT_LINES,
  LABEL_LAYOUT_PAD_PX,
  TILE_SIZE,
} from '../constants.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelItem {
  id: number;
  /** Tile the agent stands on; the placement order, so it is stable while agents walk. */
  col: number;
  row: number;
  /** Anchor: horizontal centre and top edge of the label, quantized to the tile by the caller. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Direction a colliding plate is pushed: down for a plate under the feet (default), up for
   *  one above the head, so a displaced plate never lands on its own character's face. */
  grow?: 'down' | 'up';
}

export interface LabelPlacement {
  dy: number;
  dim: boolean;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Pushes colliding labels away from their character (down, or up for plates above the head),
 * never sideways. Items are placed by tile row,
 * then tile column, then id, so the result does not depend on sub-tile
 * position and labels do not swap places while someone walks. A label that
 * would move further than a few lines stays at its anchor and dims instead.
 */
export function layoutLabels(
  items: readonly LabelItem[],
  obstacles: readonly Rect[],
  lineHeight = COMPACT_LABEL_LINE_HEIGHT_PX,
): Map<number, LabelPlacement> {
  const order = [...items].sort((a, b) => a.row - b.row || a.col - b.col || a.id - b.id);
  const placed: Rect[] = [];
  const out = new Map<number, LabelPlacement>();
  const maxDisplacement = LABEL_LAYOUT_MAX_DISPLACEMENT_LINES * lineHeight;

  for (const it of order) {
    const rect: Rect = { x: it.x - it.w / 2, y: it.y, w: it.w, h: it.h };
    let dy = 0;
    const up = it.grow === 'up';
    for (;;) {
      const cur = { ...rect, y: rect.y + dy };
      const hit =
        obstacles.find((o) => intersects(cur, o)) ?? placed.find((p) => intersects(cur, p));
      if (!hit) break;
      dy += up
        ? -(cur.y + cur.h - hit.y + LABEL_LAYOUT_PAD_PX)
        : hit.y + hit.h - cur.y + LABEL_LAYOUT_PAD_PX;
      if (Math.abs(dy) > maxDisplacement) break;
    }
    if (Math.abs(dy) > maxDisplacement) {
      out.set(it.id, { dy: 0, dim: true });
      placed.push(rect);
    } else {
      out.set(it.id, { dy, dim: false });
      placed.push({ ...rect, y: rect.y + dy });
    }
  }
  return out;
}

/**
 * Room sign for an area, in world units: on the wall row above the area's
 * bounding box, left-aligned half a tile in from its first column. An area
 * that starts on row 0 has no wall row above it, so its sign sits at the
 * centroid. Null when no tile carries the label.
 */
export function areaSignRect(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  label: string,
  zoom: number,
): Rect | null {
  if (!areaTiles || cols <= 0) return null;
  let minCol = Infinity;
  let minRow = Infinity;
  let sumCol = 0;
  let sumRow = 0;
  let count = 0;
  for (let i = 0; i < areaTiles.length; i++) {
    if (areaTiles[i] !== label) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    minCol = Math.min(minCol, c);
    minRow = Math.min(minRow, r);
    sumCol += c;
    sumRow += r;
    count++;
  }
  if (count === 0) return null;

  // Same font rule as the canvas text, converted from device px to world units.
  const fontPx = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);
  const pad = AREA_SIGN_PADDING_PX * zoom;
  const w =
    (label.length * fontPx * AREA_SIGN_GLYPH_WIDTH_EM +
      2 * pad +
      (AREA_SIGN_DOT_PX + AREA_SIGN_DOT_GAP_PX) * zoom) /
    zoom;
  const h = (fontPx + 2 * pad) / zoom;

  if (minRow - 1 < 0) {
    const cx = (sumCol / count + 0.5) * TILE_SIZE;
    const cy = (sumRow / count + 0.5) * TILE_SIZE;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  return {
    x: (minCol + 0.5) * TILE_SIZE,
    y: (minRow - 1) * TILE_SIZE + (TILE_SIZE - h) / 2,
    w,
    h,
  };
}
