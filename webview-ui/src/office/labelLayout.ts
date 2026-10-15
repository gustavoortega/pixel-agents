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
  AREA_SIGN_BORDER_PX,
  AREA_SIGN_GLYPH_WIDTH_EM,
  AREA_SIGN_PADDING_PX,
  AREA_SIGN_SHADOW_PX,
  COMPACT_LABEL_LINE_HEIGHT_PX,
  LABEL_LAYOUT_MAX_DISPLACEMENT_LINES,
  LABEL_LAYOUT_PAD_PX,
  TILE_SIZE,
  WALL_FACE_TILES,
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
  /** Heights of the plate and the chip inside `h` (the chip stacks above the plate on an above-head label). */
  plateH?: number;
  chipH?: number;
  /** Direction a colliding plate is pushed: down for a plate under the feet (default), up for
   *  one above the head, so a displaced plate never lands on its own character's face. */
  grow?: 'down' | 'up';
  /** The room's left and right edges: a plate that would cross one slides back inside. */
  span?: { x0: number; x1: number };
  /** Narrowest the plate may get (its name must stay whole). */
  minW?: number;
  /** Placed before higher ranks: an agent's plate keeps its spot, a helper's gives way. */
  rank?: number;
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
 * never sideways. Items are placed by rank (agents before helpers), then tile row,
 * then tile column, then id, so the result does not depend on sub-tile
 * position and labels do not swap places while someone walks. A label that
 * would move further than a few lines stays at its anchor and dims instead.
 */
export function layoutLabels(
  items: readonly LabelItem[],
  obstacles: readonly Rect[],
  lineHeight = COMPACT_LABEL_LINE_HEIGHT_PX,
): Map<number, LabelPlacement> {
  const order = [...items].sort(
    (a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.row - b.row || a.col - b.col || a.id - b.id,
  );
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

/** Centre of a plate of width `w` once slid inside its room. */
function slidCentre(it: LabelItem, w: number): number {
  if (!it.span) return it.x;
  const { x0, x1 } = it.span;
  if (x1 - x0 <= w) return (x0 + x1) / 2;
  return Math.max(x0 + w / 2, Math.min(it.x, x1 - w / 2));
}

/**
 * Narrows plates that would touch a neighbour on the same band, so side-by-side seats keep their
 * plates side by side (each plate ellipsizes its state and line 2) instead of pushing one off its
 * agent. Two plates whose boxes share some height must leave `gap` between them, measured where
 * they end up (slid inside their rooms): the narrower keeps its width when it fits in its half,
 * the wider takes the rest, and when neither fits both get half. Never narrower than the item's
 * `minW` (past that the collision pass decides). Returns the new width per id.
 */
export function fitPlateWidths(items: readonly LabelItem[], gap: number): Map<number, number> {
  const w = new Map(items.map((it) => [it.id, it.w] as const));
  const floor = (it: LabelItem, v: number): number => Math.max(it.minW ?? 0, Math.min(it.w, v));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
        const wa = w.get(a.id)!;
        const wb = w.get(b.id)!;
        const room = Math.abs(slidCentre(a, wa) - slidCentre(b, wb)) - gap;
        if ((wa + wb) / 2 <= room) continue;
        const wide = wa <= wb ? b : a;
        const wn = Math.min(wa, wb);
        if (wn <= room) w.set(wide.id, floor(wide, 2 * room - wn));
        else {
          w.set(a.id, floor(a, room));
          w.set(b.id, floor(b, room));
        }
      }
    }
  }
  return w;
}

/**
 * Room plaque for an area, in world units: on the wall row above the area's
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
  const border = AREA_SIGN_BORDER_PX * zoom;
  const w = (label.length * fontPx * AREA_SIGN_GLYPH_WIDTH_EM + 2 * pad + 2 * border) / zoom;
  // Border above and below the text, plus the hard shadow under the plate.
  const h = (fontPx + 2 * border + AREA_SIGN_SHADOW_PX * zoom) / zoom;

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

/**
 * The plate moved the least that puts it inside `floor`: a plate never crosses a wall or the top
 * edge of its room. A plate bigger than the floor on one axis is aligned to the floor's start
 * there. A plate already inside comes back unchanged.
 */
export function clampPlate(plate: Rect, floor: Rect): Rect {
  const fit = (pos: number, size: number, start: number, extent: number): number =>
    Math.max(start, Math.min(pos, start + extent - size));
  return {
    ...plate,
    x: fit(plate.x, plate.w, floor.x, floor.w),
    y: fit(plate.y, plate.h, floor.y, floor.h),
  };
}

/**
 * The rect an overlay group may occupy: the room floor plus the room's own top wall face, so a
 * plate for an agent at the first floor row sits over that wall instead of flipping onto the desk.
 * Never extends past the map top, and never sideways or down, so it cannot reach another room.
 */
export function withTopWallFace(floor: Rect): Rect {
  const up = Math.min(WALL_FACE_TILES * TILE_SIZE, Math.max(0, floor.y));
  return { ...floor, y: floor.y - up, h: floor.h + up };
}

/**
 * Floor rect of the room a label belongs to, in world units: the bounding box of the area's
 * tiles, or the whole map for an agent outside every area (or whose area has no tiles).
 */
export function roomFloorRect(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  rows: number,
  label: string | null,
): Rect {
  const whole: Rect = { x: 0, y: 0, w: cols * TILE_SIZE, h: rows * TILE_SIZE };
  if (!label || !areaTiles || cols <= 0) return whole;
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (let i = 0; i < areaTiles.length; i++) {
    if (areaTiles[i] !== label) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
  }
  if (minCol === Infinity) return whole;
  return {
    x: minCol * TILE_SIZE,
    y: minRow * TILE_SIZE,
    w: (maxCol - minCol + 1) * TILE_SIZE,
    h: (maxRow - minRow + 1) * TILE_SIZE,
  };
}

/** One character's tag for the monitor's solver, CSS px. */
export interface TagItem {
  id: number;
  /** Placed by rank (an alert before a plain agent before a helper), then tile row, column, id. */
  rank: number;
  col: number;
  row: number;
  /** Centre x of the tag. */
  x: number;
  /** Bottom of the group at its natural spot: a gap above the head. */
  bottom: number;
  /** The group: the tag at its bottom and what rides on it (the bubble), `tagH` of it the tag. */
  w: number;
  h: number;
  tagH: number;
  /** Top of the room under the feet, where the tag alone goes when nothing above is free. */
  feetY: number;
  /** Where the tag may go: its room's floor and top wall. */
  bounds: Rect;
}

export interface TagPlacement {
  /** The tag itself. */
  tag: Rect;
  /** The tag and what rides on it (the tag alone below the feet). */
  group: Rect;
  below: boolean;
}

export interface TagSolverOptions {
  step: number;
  maxSteps: number;
  /** Air kept from obstacles and from other tags. */
  pad: number;
  /** A tag slid sideways keeps at least this much of itself on each side of its centre x, so
   *  it still hangs over its own character. */
  attach: number;
  /** A sideways step costs this many vertical ones. */
  sideCost: number;
}

/**
 * The monitor's tags: each one goes to its natural spot above the head, else the nearest free spot
 * above it, moving up in `step` px (and sideways, at a higher cost, while the tag still covers
 * its own x), else under the feet going down the same way. Free means clear of every obstacle
 * (sprite bodies, windows, plaques, banners) and of the tags placed before it, by `pad`, and
 * inside its room. A tag with no free spot gets null: it is not drawn, so no tag ever covers
 * another or a face.
 */
export function placeTags(
  items: readonly TagItem[],
  obstacles: readonly Rect[],
  opts: TagSolverOptions,
): Map<number, TagPlacement | null> {
  const order = [...items].sort(
    (a, b) => a.rank - b.rank || a.row - b.row || a.col - b.col || a.id - b.id,
  );
  const placed: Rect[] = [];
  const out = new Map<number, TagPlacement | null>();
  const pad = opts.pad;
  const free = (r: Rect): boolean => {
    const grown = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    return (
      !obstacles.some((o) => intersects(grown, o)) && !placed.some((p) => intersects(grown, p))
    );
  };
  for (const it of order) {
    const b = it.bounds;
    const slide = (cx: number): number =>
      it.w >= b.w ? b.x + b.w / 2 : Math.max(b.x + it.w / 2, Math.min(cx, b.x + b.w - it.w / 2));
    const sides = Math.max(0, Math.floor((it.w / 2 - opts.attach) / opts.step));
    // Every (vertical, sideways) step pair, cheapest first.
    const moves: Array<[number, number]> = [];
    for (let k = 0; k <= opts.maxSteps; k++) {
      for (let s = -sides; s <= sides; s++) moves.push([k, s]);
    }
    moves.sort(
      (m, n) => m[0] + opts.sideCost * Math.abs(m[1]) - (n[0] + opts.sideCost * Math.abs(n[1])),
    );
    let hit: TagPlacement | null = null;
    for (const [k, s] of moves) {
      const top = it.bottom - it.h - k * opts.step;
      const x = slide(it.x + s * opts.step) - it.w / 2;
      const group = { x, y: top, w: it.w, h: it.h };
      if (top >= b.y && free(group)) {
        hit = { group, tag: { x, y: top + it.h - it.tagH, w: it.w, h: it.tagH }, below: false };
        break;
      }
    }
    for (const [k, s] of hit ? [] : moves) {
      const tag = {
        x: slide(it.x + s * opts.step) - it.w / 2,
        y: it.feetY + k * opts.step,
        w: it.w,
        h: it.tagH,
      };
      if (tag.y + tag.h <= b.y + b.h && free(tag)) {
        hit = { group: tag, tag, below: true };
        break;
      }
    }
    out.set(it.id, hit);
    if (hit) placed.push(hit.group);
  }
  return out;
}
