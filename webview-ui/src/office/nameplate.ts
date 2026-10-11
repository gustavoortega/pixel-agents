/**
 * Nameplate geometry: which side of the character it sits on and how big the box is, so the
 * collision layout reserves the plate the DOM will actually draw. Pure; no DOM.
 */

import { ART_DENSITY } from '../../../core/src/assets/constants.js';
import {
  CHARACTER_SPRITE_HEIGHT_PX,
  NAMEPLATE_BADGE_GOLD,
  NAMEPLATE_BADGE_INK,
  NAMEPLATE_BG,
  NAMEPLATE_BORDER_COLOR,
  NAMEPLATE_BORDER_PX,
  NAMEPLATE_COMPACT_BG,
  NAMEPLATE_COMPACT_LINE_PX,
  NAMEPLATE_HEAD_GAP_PX,
  NAMEPLATE_LINE1_PX,
  NAMEPLATE_LINE2_PX,
  NAMEPLATE_PAD_Y_PX,
  NAMEPLATE_PILL_GAP_PX,
  NAMEPLATE_PILL_HEIGHT_PX,
  NAMEPLATE_SHADOW_PX,
  NAMEPLATE_SLOT_CLEARANCE_PX,
  NAMEPLATE_SUB_BG,
  NAMEPLATE_TEXT_COLOR,
  PLATE_COMPACT_MAX_LEVEL,
  PLATE_SCALE_FIT_FLOOR,
  PLATE_SCALE_MAX,
  PLATE_SCALE_MIN,
} from '../constants.js';
import { ANCHORS } from './flair/accessories.js';
import type { Rarity } from './flair/modelFlair.js';
import { rarityColor } from './flair/modelFlair.js';
import type { NameplateContent } from './toolUtils.js';
import type { Direction } from './types.js';
import { Direction as Dir } from './types.js';

export type PlateSide = 'above' | 'below';

/**
 * Scale of the plates: the zoom relative to the zoom at which the whole map fits, so a plate keeps
 * the same share of the screen however big the map is. Clamped: past the bounds a plate is either
 * unreadable or a billboard.
 */
export function plateScale(zoom: number, fitZoomWholeMap: number): number {
  // The staged README scene frames one room as the whole map, which would pin the ratio at 1; it
  // shows its plates (and the FX text riding them) at full size instead.
  if (fullPlates) return PLATE_SCALE_MAX;
  return Math.max(
    PLATE_SCALE_MIN,
    Math.min(PLATE_SCALE_MAX, zoom / Math.max(PLATE_SCALE_FIT_FLOOR, fitZoomWholeMap)),
  );
}

/** Plates are one-line compact (`Lv N  Name`, no title) up to zoom level 3; from 4x the full two-line plate shows. */
export function plateIsCompact(zoom: number): boolean {
  return !fullPlates && zoom / ART_DENSITY <= PLATE_COMPACT_MAX_LEVEL;
}

let fullPlates = false;

/** Dev-only (the README hero scene): keeps the two-line plate at any zoom, since a 1x display fits the room at a compact zoom. */
export function forceFullPlates(on: boolean): void {
  fullPlates = on;
}

/** World y of the top of the sprite's head: `y` is the tile centre, `sit` the draw offset. */
export function spriteHeadTopY(y: number, sit: number, headBobPx = 0): number {
  return y + sit - CHARACTER_SPRITE_HEIGHT_PX + ANCHORS.down.headTopY + headBobPx;
}

/**
 * World y of the line a plate above the head hangs from: 2 px over the sprite's head, or higher
 * by the slot clearance when a bubble, glyph or beacon is drawn there. `y` is the character's (or
 * its tile's) centre and `sit` how far below it the sprite is drawn.
 */
export function plateAnchorAboveY(
  y: number,
  sit: number,
  slotTaken: boolean,
  headBobPx = 0,
): number {
  const headTop = spriteHeadTopY(y, sit, headBobPx);
  return headTop - NAMEPLATE_HEAD_GAP_PX - (slotTaken ? NAMEPLATE_SLOT_CLEARANCE_PX : 0);
}

/**
 * A character facing the camera (DOWN) keeps its face visible, so the plate goes above the head,
 * in the gap above the pod. One facing away (UP) shows its back, so the plate goes below the feet.
 * Sideways and walking characters take the above slot like DOWN.
 */
export function plateSide(dir: Direction): PlateSide {
  return dir === Dir.UP ? 'below' : 'above';
}

/** Height of the plate itself in CSS px, with its border and hard shadow. 0 when it has no lines. */
export function plateBoxHeight(c: NameplateContent, compact = false): number {
  const line1 = compact ? NAMEPLATE_COMPACT_LINE_PX : NAMEPLATE_LINE1_PX;
  const lines = (c.badge || c.name ? line1 : 0) + (c.sub ? NAMEPLATE_LINE2_PX : 0);
  return lines > 0
    ? lines + 2 * NAMEPLATE_PAD_Y_PX + 2 * NAMEPLATE_BORDER_PX + NAMEPLATE_SHADOW_PX
    : 0;
}

/** Height of the tripwire chip in CSS px, 0 when there is no alarm. */
export function chipBoxHeight(c: NameplateContent): number {
  return c.pill ? NAMEPLATE_PILL_HEIGHT_PX : 0;
}

/** Height of the plate box in CSS px: the plate, plus the tripwire chip beside it and the gap
 *  between them. 0 when there is nothing to draw. */
export function nameplateHeight(c: NameplateContent): number {
  const plate = plateBoxHeight(c);
  const chip = chipBoxHeight(c);
  return plate + (plate > 0 && chip > 0 ? NAMEPLATE_PILL_GAP_PX : 0) + chip;
}

export interface NameplateStyle {
  bg: string;
  text: string;
  subBg: string;
  /** Border and hard shadow: the same for every agent. */
  border: string;
  badgeBg: string;
  badgeInk: string;
}

/** Plate colors for a tier. Rarity (tiers 2-4) colors only the Lv badge, never the border; tier 1
 *  and an unknown model (null) keep the gold badge. */
export function nameplateStyle(rarity: Rarity | null, compact = false): NameplateStyle {
  return {
    bg: compact ? NAMEPLATE_COMPACT_BG : NAMEPLATE_BG,
    text: NAMEPLATE_TEXT_COLOR,
    subBg: NAMEPLATE_SUB_BG,
    border: NAMEPLATE_BORDER_COLOR,
    badgeBg: rarity ? rarityColor(rarity) : NAMEPLATE_BADGE_GOLD,
    badgeInk: NAMEPLATE_BADGE_INK,
  };
}
