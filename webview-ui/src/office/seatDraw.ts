/**
 * How low a sitting character is drawn. One definition, so the sprite, its shadow, the hit test,
 * the nameplate and the speech bubble all agree on where a seated agent is.
 */

import { BUBBLE_SITTING_OFFSET_PX, CHARACTER_SITTING_OFFSET_PX } from '../constants.js';
import { CharacterState } from './types.js';

interface Seatable {
  state: CharacterState;
  /** Extra sink of the seat it sits in; absent or 0 for a plain seat. */
  drawSink?: number;
}

/**
 * Px below the tile centre a character is drawn: seated ones sit lower than standing ones, and a
 * seat whose desk hides the sprite sinks it further (`drawSink`, set from the seat it sits in and
 * 0 the moment it stands).
 */
export function seatedDrawOffsetPx(ch: Seatable): number {
  return ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX + (ch.drawSink ?? 0) : 0;
}

/** Same for the speech bubble above a seated head. */
export function seatedBubbleOffsetPx(ch: Seatable): number {
  return ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX + (ch.drawSink ?? 0) : 0;
}
