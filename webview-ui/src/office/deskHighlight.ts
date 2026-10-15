/**
 * The desk of an agent that needs you, lit on the canvas: gold while it waits on a permission or
 * a question, red while it is stuck. Pure: the office hands in plain facts and the desk lookup,
 * the renderer draws the rects this returns.
 */

import {
  DESK_HIGHLIGHT_BLINK_MS,
  DESK_HIGHLIGHT_HALO_PX,
  DESK_HIGHLIGHT_INK,
  DESK_HIGHLIGHT_INSET_PX,
  DESK_HIGHLIGHT_OUTLINE_PX,
  DESK_HIGHLIGHT_STUCK_COLOR,
  DESK_HIGHLIGHT_STUCK_FILL,
  DESK_HIGHLIGHT_STUCK_HALO,
  DESK_HIGHLIGHT_WAIT_COLOR,
  DESK_HIGHLIGHT_WAIT_FILL,
  DESK_HIGHLIGHT_WAIT_HALO,
  TILE_SIZE,
} from '../constants.js';
import type { Rect } from './labelLayout.js';

export type AttentionTone = 'wait' | 'stuck';

export interface AttentionFacts {
  /** A permission prompt is open. */
  permission: boolean;
  /** The agent stopped on a question for the user. */
  question: boolean;
  /** Health stuck, looping or stalled, or an unacknowledged tripwire. */
  stuck: boolean;
}

/** The plate's precedence: waiting on you outranks stuck. */
export function attentionTone(f: AttentionFacts): AttentionTone | null {
  if (f.permission || f.question) return 'wait';
  return f.stuck ? 'stuck' : null;
}

export interface HighlightAgent {
  id: number;
  tone: AttentionTone;
  /** The tile the agent stands on. */
  col: number;
  row: number;
  seatId: string | null;
  /** The sprite's box, world px, when the agent sits at its seat: the frame goes around it too,
   *  so its top edge never crosses the face. */
  sprite?: Rect | null;
}

export interface HighlightSeat {
  seatCol: number;
  seatRow: number;
  /** The tile the seat faces, one step from the seat. */
  facing: { dCol: number; dRow: number };
}

export interface DeskHighlight {
  id: number;
  tone: AttentionTone;
  /** World px. */
  rect: Rect;
}

function tileRect(col: number, row: number): Rect {
  return { x: col * TILE_SIZE, y: row * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Where each lit agent's frame goes, world px: its assigned seat and the desk that seat faces (a
 * face-on chair stands on the desk's back row, so the seat tile itself is tried first), plus the
 * sprite while it sits there. An agent with no seat gets its own tile.
 */
export function deskHighlights(
  agents: readonly HighlightAgent[],
  seats: ReadonlyMap<string, HighlightSeat>,
  deskRectAt: (col: number, row: number) => Rect | null,
): DeskHighlight[] {
  return agents.map((a) => {
    const seat = a.seatId ? seats.get(a.seatId) : undefined;
    if (!seat) return { id: a.id, tone: a.tone, rect: tileRect(a.col, a.row) };
    let rect = tileRect(seat.seatCol, seat.seatRow);
    const desk =
      deskRectAt(seat.seatCol, seat.seatRow) ??
      deskRectAt(seat.seatCol + seat.facing.dCol, seat.seatRow + seat.facing.dRow);
    if (desk) rect = union(rect, desk);
    if (a.sprite) rect = union(rect, a.sprite);
    return { id: a.id, tone: a.tone, rect };
  });
}

/** Which of the two frames shows at `nowMs`: 0 with the halo, 1 the outline alone. */
export function highlightFrame(nowMs: number): 0 | 1 {
  return Math.floor(nowMs / DESK_HIGHLIGHT_BLINK_MS) % 2 === 0 ? 0 : 1;
}

/** One solid rect to paint, device px. */
export interface PaintOp {
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four sides of a frame `t` thick around `r`, outside it. */
function ring(r: Rect, t: number, color: string): PaintOp[] {
  return [
    { color, x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: t },
    { color, x: r.x - t, y: r.y + r.h, w: r.w + 2 * t, h: t },
    { color, x: r.x - t, y: r.y, w: t, h: r.h },
    { color, x: r.x + r.w, y: r.y, w: t, h: r.h },
  ];
}

/** The faint wash of a lit desk on the carpet, under its furniture and people: `r` device px. */
export function deskHighlightFill(r: Rect, tone: AttentionTone): PaintOp {
  return { color: tone === 'stuck' ? DESK_HIGHLIGHT_STUCK_FILL : DESK_HIGHLIGHT_WAIT_FILL, ...r };
}

/**
 * A lit desk's frame over the scene, device px: the outline in the rail tile's color around `r`,
 * an ink line just inside it, and on frame 0 a hard halo outside the outline. Thicknesses are CSS
 * px times `dpr`, whole device px.
 */
export function deskHighlightFrame(
  r: Rect,
  tone: AttentionTone,
  frame: 0 | 1,
  dpr: number,
): PaintOp[] {
  const line = Math.max(1, Math.round(DESK_HIGHLIGHT_OUTLINE_PX * dpr));
  const inset = Math.max(1, Math.round(DESK_HIGHLIGHT_INSET_PX * dpr));
  const halo = Math.max(1, Math.round(DESK_HIGHLIGHT_HALO_PX * dpr));
  const stuck = tone === 'stuck';
  const inner = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset };
  const outline = { x: r.x - line, y: r.y - line, w: r.w + 2 * line, h: r.h + 2 * line };
  return [
    ...(frame === 0
      ? ring(outline, halo, stuck ? DESK_HIGHLIGHT_STUCK_HALO : DESK_HIGHLIGHT_WAIT_HALO)
      : []),
    ...ring(r, line, stuck ? DESK_HIGHLIGHT_STUCK_COLOR : DESK_HIGHLIGHT_WAIT_COLOR),
    ...ring(inner, inset, DESK_HIGHLIGHT_INK),
  ];
}
