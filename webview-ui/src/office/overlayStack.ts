/**
 * The stack of overlay items above one agent, bottom to top: sprite, plate, tripwire chip, bubble.
 * Each item hangs from the top of the one below it, so no item shares an anchor with another and
 * none can land on the sprite or on a neighbour. The group is clamped inside the room floor as a
 * whole, so the order survives a wall. Pure geometry in CSS px; no DOM.
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
}

export interface OverlayStack {
  plate: Rect | null;
  chip: Rect | null;
  bubble: Rect | null;
  /** Total shift of the group from its natural spot (collision push plus clamp). */
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
  const moved = (r: Rect | null): Rect | null => (r ? { ...r, x: r.x + dx, y: r.y + dy } : null);
  return { plate: moved(plate), chip: moved(chip), bubble: moved(bubble), shift: { dx, dy } };
}
