/**
 * The desk of an agent that needs you, lit on the canvas: gold while it waits on a permission or
 * a question, red while it is stuck. Pure: the office hands in plain facts and the desk lookup,
 * the renderer draws the rects this returns.
 */

import { DESK_HIGHLIGHT_BLINK_MS, TILE_SIZE } from '../constants.js';
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
