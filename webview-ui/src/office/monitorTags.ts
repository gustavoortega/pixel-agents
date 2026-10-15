/**
 * The monitor's office labels beside the rail: room plaques on the top walls, and one tag per
 * character placed by the tag solver (placeTags) clear of every sprite body, window, plaque,
 * banner and other tag. No React: ToolOverlay draws what this places.
 */

import { spriteWorldHeight, spriteWorldWidth } from '../../../core/src/assets/artDensity.js';
import {
  BUBBLE_VERTICAL_OFFSET_PX,
  OVERLAY_STACK_GAP_PX,
  PLAQUE_BORDER_PX,
  PLAQUE_FOLDER_FONT_PX,
  PLAQUE_FOLDER_LINE_PX,
  PLAQUE_PAD_X_PX,
  PLAQUE_PAD_Y_PX,
  PLAQUE_TITLE_FONT_PX,
  PLAQUE_TITLE_LINE_PX,
  TAG_ATTACH_PX,
  TAG_HEAD_GAP_PX,
  TAG_MAX_STEPS,
  TAG_PAD_PX,
  TAG_SIDE_COST,
  TAG_STEP_PX,
  TILE_SIZE,
  WALL_FACE_TILES,
  WINDOW_TYPE_PREFIX,
} from '../constants.js';
import type { CrewBannerView } from './crewBanner.js';
import { sheetFrameIndex } from './engine/characters.js';
import type { OfficeState } from './engine/officeState.js';
import { ANCHORS } from './flair/accessories.js';
import { fxTextBox } from './fx/fxTextBox.js';
import { type AgentHealthView, healthMark } from './health.js';
import {
  type LabelItem,
  placeTags,
  type Rect,
  roomFloorRect,
  type TagItem,
  type TagPlacement,
  withTopWallFace,
} from './labelLayout.js';
import { pixelTextWidth, spriteHeadTopY } from './nameplate.js';
import type { OverlayProjection } from './projection.js';
import { seatedBubbleOffsetPx, seatedDrawOffsetPx } from './seatDraw.js';
import { BUBBLE_WAITING_SPRITE } from './sprites/spriteData.js';
import { statusGlyph } from './toolUtils.js';
import type { Character } from './types.js';
import { CharacterState, Direction, IdlePose } from './types.js';

/** Something is drawn on the canvas right above the head (bubble, idle glyph, Zz, beacon,
 *  health mark). A dead agent draws nothing there. */
export function headSlotTaken(
  ch: Character,
  hasTripwire: boolean,
  health: AgentHealthView | undefined,
): boolean {
  const bubble = ch.bubbleType && !(ch.bubbleType === 'waiting' && ch.waitingAwaitingInput);
  return (
    !!bubble ||
    hasTripwire ||
    healthMark(health?.state) !== null ||
    statusGlyph(ch, hasTripwire || health !== undefined) !== null
  );
}

/** A napping agent's head is lowered onto the desk: the plate follows it down. Walkers and typists do not bob it. */
export function napHeadBobPx(ch: Character): number {
  const napping =
    ch.pose === IdlePose.NAPPING && ch.state === CharacterState.TYPE && ch.dir === Direction.DOWN;
  return napping ? (ANCHORS.down.bob[sheetFrameIndex(ch)] ?? 0) : 0;
}

/** The tag solver's rank of a helper's tag (an alert is 0, an agent 1): placed last. */
export const HELPER_RANK = 2;

/** A face, for the plates and the banner to keep clear of: about the head's size, world px. */
export const FACE_WORLD_PX = 12;

export interface PlacedBanner {
  leadId: number;
  runId: string;
  view: CrewBannerView;
  rect: Rect;
  /** Its own scale: on a wall it may be drawn smaller than the plates to fit the band. */
  scale: number;
  onWall: boolean;
  /** The wall band it was tried on, CSS px (null in a compact office or a room at the map top). */
  band: Rect | null;
}

/** A world rect in CSS px through the projection. */
export function screenRect(project: OverlayProjection, r: Rect): Rect {
  const x = project.toScreenX(r.x);
  const y = project.toScreenY(r.y);
  return { x, y, w: project.toScreenX(r.x + r.w) - x, h: project.toScreenY(r.y + r.h) - y };
}

/** The top wall band of a room, world px: the wall face rows over its floor (none at the map top). */
export function wallBand(floor: Rect): Rect | null {
  const up = Math.min(WALL_FACE_TILES * TILE_SIZE, Math.max(0, floor.y));
  return up > 0 ? { x: floor.x, y: floor.y - up, w: floor.w, h: up } : null;
}

/** A room plaque beside the rail: the Area's name and, when the room maps one, its folder. */
export interface PlacedPlaque {
  label: string;
  folder: string | null;
  rect: Rect;
}

/** The folder a room maps (`+N` when several do), from the folder -> areas mappings. */
function plaqueFolder(label: string, mappings: Record<string, string[]>): string | null {
  const folders = Object.keys(mappings)
    .filter((f) => mappings[f]?.includes(label))
    .sort();
  if (folders.length === 0) return null;
  return folders.length > 1 ? `${folders[0]} +${folders.length - 1}` : folders[0];
}

/** Every Area's plaque, CSS px: on its room's top wall half a tile in from its first column,
 *  centred in the band (on the floor's top edge where the room has no wall above it). */
export function roomPlaques(officeState: OfficeState, project: OverlayProjection): PlacedPlaque[] {
  const layout = officeState.getLayout();
  const out: PlacedPlaque[] = [];
  for (const area of layout.areas ?? []) {
    if (!layout.areaTiles?.includes(area.label)) continue;
    const floor = roomFloorRect(layout.areaTiles, layout.cols, layout.rows, area.label);
    const folder = plaqueFolder(area.label, officeState.areaMappings);
    const w =
      Math.max(
        pixelTextWidth(area.label, PLAQUE_TITLE_FONT_PX),
        folder ? pixelTextWidth(folder, PLAQUE_FOLDER_FONT_PX) : 0,
      ) +
      2 * (PLAQUE_PAD_X_PX + PLAQUE_BORDER_PX);
    const h =
      PLAQUE_TITLE_LINE_PX +
      (folder ? PLAQUE_FOLDER_LINE_PX : 0) +
      2 * (PLAQUE_PAD_Y_PX + PLAQUE_BORDER_PX);
    const bandWorld = wallBand(floor);
    const band = bandWorld ? screenRect(project, bandWorld) : null;
    const x = project.toScreenX(floor.x + TILE_SIZE / 2);
    const y =
      band && band.h >= h
        ? Math.round(band.y + (band.h - h) / 2)
        : project.toScreenY(floor.y) - (band ? Math.min(h, band.h) : 0);
    out.push({ label: area.label, folder, rect: { x, y, w, h } });
  }
  return out;
}

/** What the last monitor layout placed, page CSS px: the e2e reads it to check no tag covers
 *  another or a face (canvas faces have no DOM). */
export interface TagLayoutSnapshot {
  tags: Array<{ id: number; rect: Rect }>;
  heads: Array<{ id: number; rect: Rect }>;
  banners: Array<{ leadId: number; rect: Rect; onWall: boolean; band: Rect | null }>;
  plaques: Array<{ label: string; rect: Rect }>;
}

let lastTagLayout: TagLayoutSnapshot = { tags: [], heads: [], banners: [], plaques: [] };

export function lastMonitorTagLayout(): TagLayoutSnapshot {
  return lastTagLayout;
}

/** Where the sprite is drawn now, CSS px: from the head's top to the feet, one sprite wide. */
function bodyRect(project: OverlayProjection, c: Character): Rect {
  const sit = seatedDrawOffsetPx(c);
  const top = spriteHeadTopY(c.y, sit, napHeadBobPx(c));
  return screenRect(project, { x: c.x - TILE_SIZE / 2, y: top, w: TILE_SIZE, h: c.y + sit - top });
}

/** The face the e2e checks tags against: the top FACE_WORLD_PX of the body, one sprite wide. */
function headRect(project: OverlayProjection, c: Character): Rect {
  const sit = seatedDrawOffsetPx(c);
  const top = spriteHeadTopY(c.y, sit, napHeadBobPx(c));
  return screenRect(project, { x: c.x - TILE_SIZE / 2, y: top, w: TILE_SIZE, h: FACE_WORLD_PX });
}

/**
 * Beside the rail: every tag through the solver (placeTags) against every sprite body, the
 * windows, the plaques, the banners and the tags placed before it. What rides on a tag (the FX
 * text, then the bubble) is placed with it, so the stack above a head keeps its order; a tag under
 * the feet leaves them over the head. Writes the bubble lifts and weather anchors like the classic
 * pass, and the snapshot the e2e reads.
 */
export function layoutMonitorTags(input: {
  officeState: OfficeState;
  project: OverlayProjection;
  container: DOMRect;
  items: readonly LabelItem[];
  obstacles: readonly Rect[];
  /** Places the crew banners clear of `avoid` (and, on a wall, of `wallAvoid`). */
  placeBanners: (avoid: readonly Rect[], wallAvoid: readonly Rect[]) => PlacedBanner[];
  plaques: readonly PlacedPlaque[];
  fxScale: number;
}): {
  fxSlots: Map<number, Rect>;
  tagPlacements: Map<number, TagPlacement | null>;
  banners: PlacedBanner[];
} {
  const { officeState, project } = input;
  const layout = officeState.getLayout();
  const zoomCss = 1 / project.toWorldLength(1);
  const gap = OVERLAY_STACK_GAP_PX;
  const chars = [...officeState.characters.values()];
  const bodies = chars.map((c) => bodyRect(project, c));
  const windows = officeState.furniture
    .filter((f) => f.type?.startsWith(WINDOW_TYPE_PREFIX))
    .map((f) =>
      screenRect(project, {
        x: f.x,
        y: f.y,
        w: spriteWorldWidth(f.sprite),
        h: spriteWorldHeight(f.sprite),
      }),
    );
  const fxBoxes = new Map<number, { w: number; h: number }>();
  for (const e of officeState.fx.active) {
    const box = fxTextBox(e, input.fxScale);
    const prev = fxBoxes.get(e.agentId);
    if (!prev || box.h > prev.h) fxBoxes.set(e.agentId, box);
  }
  const bubbleBox = {
    w: spriteWorldWidth(BUBBLE_WAITING_SPRITE) * zoomCss,
    h: spriteWorldHeight(BUBBLE_WAITING_SPRITE) * zoomCss,
  };
  const riders = new Map<number, { fx: { w: number; h: number } | null; bubble: boolean }>();
  const items: TagItem[] = [];
  for (const it of input.items) {
    const ch = officeState.characters.get(it.id);
    if (!ch) continue;
    const fx = fxBoxes.get(it.id) ?? null;
    const bubble = headSlotTaken(
      ch,
      officeState.tripwires.has(it.id),
      officeState.health.get(it.id),
    );
    riders.set(it.id, { fx, bubble });
    const w = Math.max(it.w, fx?.w ?? 0, bubble ? bubbleBox.w : 0);
    items.push({
      id: it.id,
      rank: it.rank ?? 0,
      col: it.col,
      row: it.row,
      x: it.x,
      bottom: it.y + it.h,
      w,
      tagH: it.h,
      h: it.h + (fx ? gap + fx.h : 0) + (bubble ? gap + bubbleBox.h : 0),
      feetY: project.toScreenY(ch.y + seatedDrawOffsetPx(ch)) + TAG_HEAD_GAP_PX,
      bounds: screenRect(
        project,
        withTopWallFace(
          roomFloorRect(layout.areaTiles, layout.cols, layout.rows, officeState.roomOf(ch)),
        ),
      ),
    });
  }
  const opts = {
    step: TAG_STEP_PX,
    maxSteps: TAG_MAX_STEPS,
    pad: TAG_PAD_PX,
    attach: TAG_ATTACH_PX,
    sideCost: TAG_SIDE_COST,
  };
  const fixed = [...input.obstacles, ...bodies, ...windows];
  // The agents' tags first: a banner never takes the only spot an agent's tag had. Then the
  // banners, clear of those tags and of every body; then the helpers' tags, clear of it all.
  const solved = placeTags(
    items.filter((it) => it.rank < HELPER_RANK),
    fixed,
    opts,
  );
  const agentGroups = [...solved.values()].flatMap((p) => (p ? [p.group] : []));
  const banners = input.placeBanners([...agentGroups, ...bodies], agentGroups);
  const helpers = placeTags(
    items.filter((it) => it.rank >= HELPER_RANK),
    [...fixed, ...agentGroups, ...banners.map((b) => b.rect)],
    opts,
  );
  for (const [id, p] of helpers) solved.set(id, p);

  // The group is as wide as its widest rider; the tag itself keeps its own width, centred in it.
  const tagPlacements = new Map<number, TagPlacement | null>();
  const fxSlots = new Map<number, Rect>();
  officeState.bubbleLift.clear();
  officeState.weatherAnchor.clear();
  for (const ch of chars) {
    officeState.weatherAnchor.set(ch.id, spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)));
  }
  for (const it of input.items) {
    const ch = officeState.characters.get(it.id);
    const hit = solved.get(it.id);
    const ride = riders.get(it.id);
    if (!ch || !ride) continue;
    if (!hit) {
      tagPlacements.set(it.id, null);
      continue;
    }
    const cx = hit.group.x + hit.group.w / 2;
    const tag = { x: cx - it.w / 2, y: hit.tag.y, w: it.w, h: hit.tag.h };
    tagPlacements.set(it.id, { ...hit, tag });
    const headTop = project.toScreenY(spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)));
    let top = hit.below ? headTop : tag.y;
    if (ride.fx) {
      const fx = { x: cx - ride.fx.w / 2, y: top - gap - ride.fx.h, w: ride.fx.w, h: ride.fx.h };
      fxSlots.set(it.id, fx);
      top = fx.y;
    }
    if (ride.bubble && !hit.below) {
      // World y of the bubble's bottom edge, against where the renderer draws it by default.
      const bottomWorld = project.toWorldLength(top - gap - project.toScreenY(0));
      const defaultBottom = ch.y + seatedBubbleOffsetPx(ch) - BUBBLE_VERTICAL_OFFSET_PX - 1;
      officeState.bubbleLift.set(it.id, defaultBottom - bottomWorld);
      top -= gap + bubbleBox.h;
    }
    officeState.weatherAnchor.set(it.id, project.toWorldLength(top - project.toScreenY(0)));
  }

  const page = (r: Rect): Rect => ({
    x: r.x + input.container.left,
    y: r.y + input.container.top,
    w: r.w,
    h: r.h,
  });
  lastTagLayout = {
    tags: [...tagPlacements].flatMap(([id, p]) => (p ? [{ id, rect: page(p.tag) }] : [])),
    heads: chars.map((c) => ({ id: c.id, rect: page(headRect(project, c)) })),
    banners: banners.map((b) => ({
      leadId: b.leadId,
      rect: page(b.rect),
      onWall: b.onWall,
      band: b.band ? page(b.band) : null,
    })),
    plaques: input.plaques.map((p) => ({ label: p.label, rect: page(p.rect) })),
  };
  return { fxSlots, tagPlacements, banners };
}
