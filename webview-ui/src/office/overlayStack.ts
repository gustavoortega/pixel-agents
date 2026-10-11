/**
 * The stack of overlay items above one agent, bottom to top: sprite, plate, tripwire chip, bubble.
 * Each item hangs from the top of the one below it, so no item shares an anchor with another and
 * none can land on the sprite or on a neighbour. The group is clamped inside the room floor as a
 * whole, so the order survives a wall. When a close wall would push that group onto the head, the
 * whole group goes below the feet instead. Pure geometry in CSS px; no DOM.
 */

import { OVERLAY_STACK_GAP_PX } from '../constants.js';
import { clampPlate, type Rect } from './labelLayout.js';

export interface BoxSize {
  w: number;
  h: number;
}

export interface OverlayStackInput {
  /** Horizontal centre of the stack. */
  x: number;
  /** Top edge of the sprite's head: the stack stands on it. */
  headTop: number;
  plate: BoxSize | null;
  chip: BoxSize | null;
  bubble: BoxSize | null;
  /** Gap between neighbouring items; defaults to OVERLAY_STACK_GAP_PX. */
  gap?: number;
  /** Shift of the whole group before clamping (collision push from other labels), negative is up. */
  dy?: number;
  /** Room floor the group must stay in; absent means unclamped. */
  floor?: Rect;
  /** The sprite's head box and the y of its feet. Together with `floor` they let the group flip
   *  below the feet when the wall would otherwise push it onto the head. */
  head?: Rect;
  feetY?: number;
}

export interface OverlayStack {
  plate: Rect | null;
  chip: Rect | null;
  bubble: Rect | null;
  /** Total shift of the plate and chip from their natural spot above the head (collision push
   *  plus clamp, or the flip below the feet). */
  shift: { dx: number; dy: number };
}

export function stackAbove(input: OverlayStackInput): OverlayStack {
  const gap = input.gap ?? OVERLAY_STACK_GAP_PX;
  let bottom = input.headTop;
  const place = (box: BoxSize | null): Rect | null => {
    if (!box) return null;
    const r = { x: input.x - box.w / 2, y: bottom - box.h, w: box.w, h: box.h };
    bottom = r.y - gap;
    return r;
  };
  const plate = place(input.plate);
  const chip = place(input.chip);
  const bubble = place(input.bubble);
  const items = [plate, chip, bubble].filter((r): r is Rect => r !== null);

  let dx = 0;
  let dy = input.dy ?? 0;
  if (items.length > 0 && input.floor) {
    const x0 = Math.min(...items.map((r) => r.x));
    const y0 = Math.min(...items.map((r) => r.y)) + dy;
    const x1 = Math.max(...items.map((r) => r.x + r.w));
    const y1 = Math.max(...items.map((r) => r.y + r.h)) + dy;
    const group: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const fitted = clampPlate(group, input.floor);
    dx = fitted.x - group.x;
    dy += fitted.y - group.y;
  }
  const overlapsHead = (r: Rect): boolean => {
    const h = input.head;
    return !!h && r.x < h.x + h.w && h.x < r.x + r.w && r.y < h.y + h.h && h.y < r.y + r.h;
  };
  if (items.length > 0 && input.floor && input.head && input.feetY !== undefined) {
    const stillAbove = items.some((r) => overlapsHead({ ...r, x: r.x + dx, y: r.y + dy }));
    if (stillAbove) {
      const below = stackBelow(input, [plate, chip, bubble], gap, input.feetY);
      if (below && !below.rects.some((r) => r !== null && overlapsHead(r))) {
        const label = [plate, chip].filter((r): r is Rect => r !== null);
        const [bp, bc, bb] = below.rects;
        const belowLabel = [bp, bc].filter((r): r is Rect => r !== null);
        const natural = Math.min(...(label.length > 0 ? label : items).map((r) => r.y));
        const placed = Math.min(
          ...(belowLabel.length > 0 ? belowLabel : [bb as Rect]).map((r) => r.y),
        );
        return {
          plate: bp,
          chip: bc,
          bubble: bb,
          shift: { dx: below.dx, dy: placed - natural },
        };
      }
    }
  }
  const moved = (r: Rect | null): Rect | null => (r ? { ...r, x: r.x + dx, y: r.y + dy } : null);
  return { plate: moved(plate), chip: moved(chip), bubble: moved(bubble), shift: { dx, dy } };
}

/** The same boxes in the same order, growing downward from the feet and clamped as a group. */
function stackBelow(
  input: OverlayStackInput,
  boxes: Array<Rect | null>,
  gap: number,
  feetY: number,
): { rects: Array<Rect | null>; dx: number } | null {
  if (!input.floor) return null;
  let top = feetY + gap;
  const laid = boxes.map((b) => {
    if (!b) return null;
    const r = { x: b.x, y: top, w: b.w, h: b.h };
    top += b.h + gap;
    return r;
  });
  const items = laid.filter((r): r is Rect => r !== null);
  const x0 = Math.min(...items.map((r) => r.x));
  const y0 = items[0].y;
  const x1 = Math.max(...items.map((r) => r.x + r.w));
  const y1 = Math.max(...items.map((r) => r.y + r.h));
  const group: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const fitted = clampPlate(group, input.floor);
  const dx = fitted.x - group.x;
  const dy = fitted.y - group.y;
  return {
    rects: laid.map((r) => (r ? { ...r, x: r.x + dx, y: r.y + dy } : null)),
    dx,
  };
}
