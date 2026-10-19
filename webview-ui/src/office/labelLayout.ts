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

/** Where a tag may hang, CSS px: its centre x and the top of its group (the tag, and on an above
 *  slot what rides on it), and what it hangs from (`anchor`: the desk unit under it, the sprite
 *  over it). */
export interface TagSlot {
  x: number;
  y: number;
  /** The group's height at this slot: the tag alone under the desk, tag and riders above. */
  h: number;
  below: boolean;
  anchor: Rect;
  /** A slot on the agent's closed side: a tag there hangs from a leader wherever it lands. */
  leader?: boolean;
}

/** A tag pinned to its lit desk's frame: on an edge of the outline, at its corner. */
export interface TagPin {
  /** The frame's outer edge, CSS px (the unit grown by the outline, pulled back by a neighbour). */
  outline: Rect;
  /** The desk unit the outline surrounds: what the tag hangs from. */
  unit: Rect;
  /** The edge it sits on first: `top` puts the tag over the frame, `bottom` under it. */
  edge: 'top' | 'bottom';
  /** The group's height over the frame's top edge: the tag and what rides on it. */
  groupH: number;
}

/** One character's tag for the monitor's solver, CSS px. */
export interface TagItem {
  id: number;
  /** Placed by rank (an alert before a plain agent before a helper), then tile row, column, id. */
  rank: number;
  col: number;
  row: number;
  /** Its slots, the agent's open side first, then the other side, which hangs from a leader. */
  slots: readonly TagSlot[];
  /** The group's width: the widest of the tag and what rides on it above the head. */
  w: number;
  /** The tag's own width when it is narrower than the group (`w` otherwise). */
  tagW?: number;
  tagH: number;
  /** Where the tag may go: its room's floor and top wall. */
  bounds: Rect;
  /** A lit desk's tag goes to its frame's corner before it looks for a slot. */
  pin?: TagPin;
}

export interface TagPlacement {
  /** The tag itself. */
  tag: Rect;
  /** The tag and what rides on it (the tag alone under the desk). */
  group: Rect;
  below: boolean;
  /** How far it moved from its slot, CSS px. */
  shift: number;
  /** What it hangs from (its slot's anchor), and whether a leader joins them. */
  anchor: Rect;
  leader: boolean;
}

export interface TagSolverOptions {
  step: number;
  /** Farthest move from a slot that still hangs free of a leader (`leaderAt` and less) or within
   *  reach, and how far it looks at all (`farReach`), CSS px. */
  leaderAt: number;
  reach: number;
  farReach: number;
  /** Air kept from obstacles and from other tags. */
  pad: number;
  /** A sideways step costs this many vertical ones. */
  sideCost: number;
  /** A leader's thickness. */
  leaderPx: number;
}

/** An obstacle; one with an `owner` is in the way of every tag but that character's own. */
export type TagObstacle = Rect & { owner?: number };

/** The gap between two rects, CSS px: 0 when they meet. */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Every move of at most `reach`, in whole steps, cheapest first. */
function movesWithin(step: number, reach: number, sideCost: number): Array<[number, number]> {
  const n = Math.floor(reach / step);
  const out: Array<[number, number]> = [];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++)
      if (Math.hypot(i * step, j * step) <= reach) out.push([i * step, j * step]);
  return out.sort(
    (a, b) =>
      Math.abs(a[1]) + sideCost * Math.abs(a[0]) - (Math.abs(b[1]) + sideCost * Math.abs(b[0])),
  );
}

/** Sideways moves along an edge, none first and then by distance, `inward` (+1 or -1) side first,
 *  up to `width`. */
function slidesAlong(step: number, width: number, inward: 1 | -1): number[] {
  const out = [0];
  for (let k = 1; k * step <= width; k++) out.push(inward * k * step, -inward * k * step);
  return out;
}

/**
 * The monitor's tags, in rank order. A lit desk's tag (`pin`) goes to its frame first: its left
 * edge on the outline's outer left (its right edge on the outer right when that would cross the
 * room's right bound), over the top edge, or under the bottom edge for one facing up. On a
 * collision it slides along the edge, dy 0, up to its own width, then tries the other edge the
 * same way; with no spot there it falls back to the slots below, always on a leader.
 *
 * Each slot (the agent's open side, then the other) is searched whole before the next: first at
 * most `leaderAt` from the slot, then within `reach`, then within `farReach`, cheapest move first
 * (vertical before sideways). Free means clear of every obstacle (sprite bodies, plaques, banners,
 * other lit desks) and of the tags placed before it, by `pad`, and inside its room. A tag moved
 * more than `leaderAt`, left farther than `reach` from its anchor, or on a slot marked `leader`
 * gets a leader, which must reach its anchor and cross no obstacle. A tag with no free spot gets
 * null: it is not drawn, so no tag ever covers another or a face.
 */
export function placeTags(
  items: readonly TagItem[],
  obstacles: readonly TagObstacle[],
  opts: TagSolverOptions,
): Map<number, TagPlacement | null> {
  const order = [...items].sort(
    (a, b) => a.rank - b.rank || a.row - b.row || a.col - b.col || a.id - b.id,
  );
  const placed: Rect[] = [];
  const out = new Map<number, TagPlacement | null>();
  const pad = opts.pad;
  const tiers = [
    movesWithin(opts.step, opts.leaderAt, opts.sideCost),
    movesWithin(opts.step, opts.reach, opts.sideCost).filter(
      ([dx, dy]) => Math.hypot(dx, dy) > opts.leaderAt,
    ),
    movesWithin(opts.step, opts.farReach, opts.sideCost).filter(
      ([dx, dy]) => Math.hypot(dx, dy) > opts.reach,
    ),
  ];
  for (const it of order) {
    const b = it.bounds;
    const free = (r: Rect): boolean => {
      if (r.x < b.x || r.y < b.y || r.x + r.w > b.x + b.w || r.y + r.h > b.y + b.h) return false;
      const grown = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
      return (
        !obstacles.some((o) => o.owner !== it.id && intersects(grown, o)) &&
        !placed.some((p) => intersects(grown, p))
      );
    };
    // A leader that misses what it hangs from, or runs over something, does not keep the owner
    // clear. Its ends meet the tag and the anchor, so they are left out of the crossing test (the
    // leader's coordinates are rounded).
    const leaderOk = (tag: Rect, anchor: Rect): boolean => {
      const line = tagLeader(tag, anchor, opts.leaderPx);
      if (!line) return true;
      const vertical = line.h >= line.w;
      const body = vertical
        ? { ...line, y: line.y + 1, h: Math.max(0, line.h - 2) }
        : { ...line, x: line.x + 1, w: Math.max(0, line.w - 2) };
      return (
        rectGap(line, anchor) <= 1 &&
        !obstacles.some((o) => o.owner !== it.id && intersects(body, o))
      );
    };
    let hit: TagPlacement | null = null;
    const pin = it.pin;
    if (pin) {
      const w = it.tagW ?? it.w;
      const flip = pin.outline.x + w > b.x + b.w;
      const x0 = flip ? pin.outline.x + pin.outline.w - w : pin.outline.x;
      const edges =
        pin.edge === 'top' ? (['top', 'bottom'] as const) : (['bottom', 'top'] as const);
      pinned: for (const edge of edges) {
        const above = edge === 'top';
        const h = above ? pin.groupH : it.tagH;
        const y = above ? pin.outline.y - h : pin.outline.y + pin.outline.h;
        for (const dx of slidesAlong(opts.step, w, flip ? -1 : 1)) {
          const x = x0 + dx;
          // Still over the frame's edge, not beside it.
          if (x >= pin.outline.x + pin.outline.w || x + w <= pin.outline.x) continue;
          const group = { x, y, w, h };
          if (!free(group)) continue;
          const tag = { x, y: y + h - it.tagH, w, h: it.tagH };
          hit = { tag, group, below: !above, shift: Math.abs(dx), anchor: pin.unit, leader: false };
          break pinned;
        }
      }
    }
    search: for (const slot of hit ? [] : it.slots) {
      for (const moves of tiers) {
        for (const [dx, dy] of moves) {
          const group = { x: slot.x - it.w / 2 + dx, y: slot.y + dy, w: it.w, h: slot.h };
          if (!free(group)) continue;
          const tag = { x: group.x, y: group.y + slot.h - it.tagH, w: it.w, h: it.tagH };
          const shift = Math.hypot(dx, dy);
          const leader =
            !!slot.leader ||
            !!pin ||
            shift > opts.leaderAt ||
            rectGap(tag, slot.anchor) > opts.reach;
          if (leader && !leaderOk(tag, slot.anchor)) continue;
          hit = { tag, group, below: slot.below, shift, anchor: slot.anchor, leader };
          break search;
        }
      }
    }
    out.set(it.id, hit);
    if (hit) placed.push(hit.group);
  }
  return out;
}

/**
 * The leader from a tag to what it hangs from, CSS px: one `width` px segment, vertical at the
 * anchor's centre x (kept over the tag) when one is above the other, else horizontal. Null when
 * they meet.
 */
export function tagLeader(tag: Rect, anchor: Rect, width: number): Rect | null {
  if (rectGap(tag, anchor) === 0) return null;
  const half = width / 2;
  if (tag.y >= anchor.y + anchor.h || tag.y + tag.h <= anchor.y) {
    const cx = Math.max(tag.x + 4, Math.min(anchor.x + anchor.w / 2, tag.x + tag.w - 4));
    const x = Math.round(cx - half);
    const above = tag.y + tag.h <= anchor.y;
    const y0 = above ? tag.y + tag.h : anchor.y + anchor.h;
    const y1 = above ? anchor.y : tag.y;
    return { x, y: Math.round(y0), w: width, h: Math.round(y1 - y0) };
  }
  const cy = Math.max(tag.y + 2, Math.min(anchor.y + anchor.h / 2, tag.y + tag.h - 2));
  const left = tag.x + tag.w <= anchor.x;
  const x0 = left ? tag.x + tag.w : anchor.x + anchor.w;
  const x1 = left ? anchor.x : tag.x;
  return { x: Math.round(x0), y: Math.round(cy - half), w: Math.round(x1 - x0), h: width };
}
