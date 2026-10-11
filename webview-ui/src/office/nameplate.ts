/**
 * Nameplate geometry: which side of the character it sits on and how big the box is, so the
 * collision layout reserves the plate the DOM will actually draw. Pure; no DOM.
 */

import {
  NAMEPLATE_BORDER_PX,
  NAMEPLATE_LINE1_PX,
  NAMEPLATE_LINE2_PX,
  NAMEPLATE_PAD_Y_PX,
  NAMEPLATE_PILL_GAP_PX,
  NAMEPLATE_PILL_HEIGHT_PX,
  NAMEPLATE_SHADOW_PX,
} from '../constants.js';
import type { NameplateContent } from './toolUtils.js';
import type { Direction } from './types.js';
import { Direction as Dir } from './types.js';

export type PlateSide = 'above' | 'below';

/**
 * A character facing the camera (DOWN) keeps its face visible, so the plate goes above the head,
 * in the gap above the pod. One facing away (UP) shows its back, so the plate goes below the feet.
 * Sideways and walking characters take the above slot like DOWN.
 */
export function plateSide(dir: Direction): PlateSide {
  return dir === Dir.UP ? 'below' : 'above';
}

/** Height of the plate box in CSS px: the plate with its border and hard shadow, plus the
 *  tripwire pill under it. 0 when there is nothing to draw. */
export function nameplateHeight(c: NameplateContent): number {
  const lines = (c.badge || c.name ? NAMEPLATE_LINE1_PX : 0) + (c.sub ? NAMEPLATE_LINE2_PX : 0);
  const plate =
    lines > 0 ? lines + 2 * NAMEPLATE_PAD_Y_PX + 2 * NAMEPLATE_BORDER_PX + NAMEPLATE_SHADOW_PX : 0;
  const pill = c.pill ? (plate > 0 ? NAMEPLATE_PILL_GAP_PX : 0) + NAMEPLATE_PILL_HEIGHT_PX : 0;
  return plate + pill;
}
