/**
 * The monitor's office labels beside the rail: room plaques on the top walls, and one tag per
 * character placed by the tag solver (placeTags) clear of every sprite body, plaque, banner and
 * other tag. No React: ToolOverlay draws what this places.
 */

import { spriteWorldHeight, spriteWorldWidth } from '../../../core/src/assets/artDensity.js';
import {
  BUBBLE_VERTICAL_OFFSET_PX,
  OVERLAY_STACK_GAP_PX,
  PIXEL_FONT_CAP_EM,
  PIXEL_FONT_DESCENT_EM,
  PLAQUE_BORDER_PX,
  PLAQUE_LINE_GAP_PX,
  PLAQUE_PAD_X_PX,
  PLAQUE_PAD_Y_PX,
  TAG_DESK_GAP_PX,
  TAG_FAR_REACH_PX,
  TAG_HEAD_GAP_PX,
  TAG_LEADER_AT_PX,
  TAG_LEADER_PX,
  TAG_PAD_PX,
  TAG_REACH_PX,
  TAG_SIDE_COST,
  TAG_STEP_PX,
  TILE_SIZE,
  WALL_FACE_TILES,
} from '../constants.js';
import type { CrewBannerForm, CrewBannerView } from './crewBanner.js';
import { sheetFrameIndex } from './engine/characters.js';
import type { OfficeState } from './engine/officeState.js';
import { ANCHORS } from './flair/accessories.js';
import { fxTextBox } from './fx/fxTextBox.js';
import { type AgentHealthView, healthMark } from './health.js';
import {
  placeTags,
  type Rect,
  roomFloorRect,
  type TagItem,
  tagLeader,
  type TagObstacle,
  type TagPlacement,
  type TagSlot,
  withTopWallFace,
} from './labelLayout.js';
import { type MonitorType, pixelTextWidth, spriteHeadTopY } from './nameplate.js';
import type { OverlayProjection } from './projection.js';
import { seatedBubbleOffsetPx, seatedDrawOffsetPx } from './seatDraw.js';
import { BUBBLE_WAITING_SPRITE } from './sprites/spriteData.js';
import { statusGlyph } from './toolUtils.js';
import type { Character, OfficeLayout } from './types.js';
import { CharacterState, Direction, IdlePose } from './types.js';

/** Something is drawn on the canvas right above the head (bubble, idle glyph, Zz, beacon,
 *  health mark). A dead agent draws nothing there. `rules` is the office's word on the bubble and
 *  on a tag that already carries the alert (OfficeState). */
export function headSlotTaken(
  ch: Character,
  hasTripwire: boolean,
  health: AgentHealthView | undefined,
  rules: Pick<OfficeState, 'bubbleShown' | 'alertOnTag'>,
): boolean {
  return (
    rules.bubbleShown(ch) ||
    hasTripwire ||
    healthMark(health?.state) !== null ||
    statusGlyph(ch, hasTripwire || health !== undefined || rules.alertOnTag(ch)) !== null
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
  form: CrewBannerForm;
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
  /** Its type, CSS px: title and folder sizes, each line trimmed to the caps. */
  title: { font: number; line: number };
  sub: { font: number; line: number } | null;
}

/** The folder a room maps (`+N` when several do), from the folder -> areas mappings. */
function plaqueFolder(label: string, mappings: Record<string, string[]>): string | null {
  const folders = Object.keys(mappings)
    .filter((f) => mappings[f]?.includes(label))
    .sort();
  if (folders.length === 0) return null;
  return folders.length > 1 ? `${folders[0]} +${folders.length - 1}` : folders[0];
}

/** A plaque title is set in caps with this much letter spacing (em). */
export const PLAQUE_TITLE_TRACKING_EM = 0.05;

/** A plaque's box at a type size, CSS px: the caps-trimmed title, then the folder with room for
 *  its descenders. */
export function plaqueSize(
  label: string,
  folder: string | null,
  type: MonitorType,
): Pick<PlacedPlaque, 'title' | 'sub'> & { w: number; h: number } {
  const title = { font: type.plaqueTitle, line: Math.ceil(type.plaqueTitle * PIXEL_FONT_CAP_EM) };
  const sub = folder
    ? {
        font: type.plaqueFolder,
        line: Math.ceil(type.plaqueFolder * (PIXEL_FONT_CAP_EM + PIXEL_FONT_DESCENT_EM)),
      }
    : null;
  const titleW =
    pixelTextWidth(label.toUpperCase(), title.font) +
    Math.ceil(label.length * PLAQUE_TITLE_TRACKING_EM * title.font);
  const w =
    Math.max(titleW, folder && sub ? pixelTextWidth(folder, sub.font) : 0) +
    2 * (PLAQUE_PAD_X_PX + PLAQUE_BORDER_PX);
  const h =
    title.line +
    (sub ? PLAQUE_LINE_GAP_PX + sub.line : 0) +
    2 * (PLAQUE_PAD_Y_PX + PLAQUE_BORDER_PX);
  return { title, sub, w, h };
}

/** Every Area's plaque, CSS px: on its room's top wall half a tile in from its first column,
 *  centred in the band (on the floor's top edge where the room has no wall above it). */
export function roomPlaques(
  officeState: OfficeState,
  project: OverlayProjection,
  type: MonitorType,
): PlacedPlaque[] {
  const layout = officeState.getLayout();
  const out: PlacedPlaque[] = [];
  for (const area of layout.areas ?? []) {
    if (!layout.areaTiles?.includes(area.label)) continue;
    const floor = roomFloorRect(layout.areaTiles, layout.cols, layout.rows, area.label);
    const folder = plaqueFolder(area.label, officeState.areaMappings);
    const { w, h, title, sub } = plaqueSize(area.label, folder, type);
    const bandWorld = wallBand(floor);
    const band = bandWorld ? screenRect(project, bandWorld) : null;
    const x = project.toScreenX(floor.x + TILE_SIZE / 2);
    const y =
      band && band.h >= h
        ? Math.round(band.y + (band.h - h) / 2)
        : project.toScreenY(floor.y) - (band ? Math.min(h, band.h) : 0);
    out.push({ label: area.label, folder, rect: { x, y, w, h }, title, sub });
  }
  return out;
}

/** What the last monitor layout placed, page CSS px: the e2e reads it to check no tag covers
 *  another or a face (canvas faces have no DOM), that each stays in its room and near what it
 *  hangs from unless a leader joins them. */
export interface TagLayoutSnapshot {
  tags: Array<{
    id: number;
    rect: Rect;
    /** The desk unit or sprite it hangs from. */
    anchor: Rect;
    leader: boolean;
  }>;
  heads: Array<{ id: number; rect: Rect }>;
  /** Every room: what a tag in it may occupy (its floor and top wall), as `tagRoom` bounds it. */
  rooms: Array<{ label: string; rect: Rect }>;
  banners: Array<{ leadId: number; rect: Rect; onWall: boolean; band: Rect | null }>;
  plaques: Array<{ label: string; rect: Rect }>;
}

let lastTagLayout: TagLayoutSnapshot = {
  tags: [],
  heads: [],
  rooms: [],
  banners: [],
  plaques: [],
};

export function lastMonitorTagLayout(): TagLayoutSnapshot {
  return lastTagLayout;
}

/** A room's floor and its own top wall, world px: what a tag in the room may occupy. */
function roomRect(layout: Pick<OfficeLayout, 'areaTiles' | 'cols' | 'rows'>, label: string | null) {
  return withTopWallFace(roomFloorRect(layout.areaTiles, layout.cols, layout.rows, label));
}

/**
 * Where a character's tag may go, world px: the room of the tile it stands on now (floor and top
 * wall), not its seat's, since the tag follows the agent into the lobby while it walks or drinks
 * its coffee. A tile with no area gives the whole map.
 */
export function tagRoom(
  layout: Pick<OfficeLayout, 'areaTiles' | 'cols' | 'rows'>,
  ch: Pick<Character, 'tileCol' | 'tileRow'>,
): Rect {
  return roomRect(layout, layout.areaTiles?.[ch.tileRow * layout.cols + ch.tileCol] ?? null);
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

/** What one agent's slots are built from, CSS px. */
export interface SlotGeometry {
  /** The centre x the tag hangs from: the agent's. */
  x: number;
  /** The desk unit while it sits at its seat, else its sprite: what a tag under it hangs from. */
  unit: Rect;
  body: Rect;
  /** The head's top edge, nap bob included. */
  headTop: number;
  tagH: number;
  /** The tag and what rides on it above the head (the FX text, then the bubble). */
  groupH: number;
}

function slotOn(side: 'under' | 'above', g: SlotGeometry): TagSlot {
  return side === 'under'
    ? { x: g.x, y: g.unit.y + g.unit.h + TAG_DESK_GAP_PX, h: g.tagH, below: true, anchor: g.unit }
    : {
        x: g.x,
        y: g.headTop - TAG_HEAD_GAP_PX - g.groupH,
        h: g.groupH,
        below: false,
        anchor: g.body,
      };
}

/**
 * The agent's open side, the one slot its tag hangs from: under the desk unit for one seated
 * facing up (the desk is over its head, and the chair back hides it below), above the head for
 * every other agent (face-on at its desk, on a couch, or standing, `facing` null). Under the
 * unit the tag's top edge sits TAG_DESK_GAP_PX under the chair back and what rides on it stays
 * over the head; above the head its bottom edge sits TAG_HEAD_GAP_PX over the head and the riders
 * stack over it. The other side of a desk pod is the next seat's cell, so it is only a fallback.
 */
export function openSideSlots(facing: Direction | null, g: SlotGeometry): TagSlot[] {
  return [slotOn(facing === Direction.UP ? 'under' : 'above', g)];
}

/** One character's tag for the monitor pass: its box, CSS px, and its solver rank. */
export interface MonitorTagInput {
  id: number;
  rank: number;
  w: number;
  h: number;
}

/** A lit desk's frame, CSS px: the outline around the desk unit (pulled back where a neighbour is
 *  too near, see separateFrames). Its owner's tag is pinned to it. */
export interface LitFrameBox {
  id: number;
  unit: Rect;
  outline: Rect;
}

/**
 * Beside the rail: the crew banners on their walls first, then every tag through the solver
 * (placeTags). A lit desk's tag goes to its frame's corner (the top edge, or the bottom edge for
 * an agent facing up); every other tag hangs from its agent's open side, else the other side on a
 * leader, clear of every sprite body, plaque, banner, other tag and lit desk, inside the room the
 * agent stands in. What rides on a tag above the head (the FX text, then the bubble) is placed with
 * it, so the stack keeps its order; a tag under the desk leaves them over the head. Writes the
 * bubble lifts and weather anchors like the classic pass, and the snapshot the e2e reads.
 */
export function layoutMonitorTags(input: {
  officeState: OfficeState;
  project: OverlayProjection;
  container: DOMRect;
  items: readonly MonitorTagInput[];
  /** What no tag covers (the plaques, the stage chrome). */
  obstacles: readonly TagObstacle[];
  /** The lit desks: in every tag's way but their owner's, and where that tag is pinned. */
  frames: readonly LitFrameBox[];
  /** Places the crew banners clear of `avoid` (and, on a wall, of `wallAvoid`). */
  placeBanners: (avoid: readonly Rect[], wallAvoid: readonly Rect[]) => PlacedBanner[];
  plaques: readonly PlacedPlaque[];
  fxScale: number;
}): {
  fxSlots: Map<number, Rect>;
  tagPlacements: Map<number, TagPlacement | null>;
  leaders: Map<number, Rect>;
  banners: PlacedBanner[];
} {
  const { officeState, project } = input;
  const layout = officeState.getLayout();
  const zoomCss = 1 / project.toWorldLength(1);
  const gap = OVERLAY_STACK_GAP_PX;
  const chars = [...officeState.characters.values()];
  const bodies = chars.map((c) => bodyRect(project, c));
  const frames = new Map(input.frames.map((f) => [f.id, f] as const));
  // A lit desk is its agent's: no other tag sits inside its frame.
  const frameObstacles: TagObstacle[] = input.frames.map((f) => ({ owner: f.id, ...f.outline }));
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
  // A tag never grows past its room: the name's ellipsis takes the rest.
  const tagWidths = new Map<number, number>();
  // A bubble drawn where it is by default (its tag under the desk) is in every other tag's way.
  const bubbleSpots: TagObstacle[] = [];
  const items: TagItem[] = [];
  for (const it of input.items) {
    const ch = officeState.characters.get(it.id);
    if (!ch) continue;
    const fx = fxBoxes.get(it.id) ?? null;
    const bubble = headSlotTaken(
      ch,
      officeState.tripwires.has(it.id),
      officeState.health.get(it.id),
      officeState,
    );
    riders.set(it.id, { fx, bubble });
    const body = bodyRect(project, ch);
    const cx = project.toScreenX(ch.x);
    if (bubble) {
      const bottom = project.toScreenY(ch.y + seatedBubbleOffsetPx(ch) - BUBBLE_VERTICAL_OFFSET_PX);
      bubbleSpots.push({
        owner: it.id,
        x: cx - bubbleBox.w / 2,
        y: bottom - bubbleBox.h,
        w: bubbleBox.w,
        h: bubbleBox.h,
      });
    }
    const unitWorld = officeState.deskUnitOf(ch);
    const unit = unitWorld ? screenRect(project, unitWorld) : body;
    const bounds = screenRect(project, tagRoom(layout, ch));
    const room = bounds.w - 2 * TAG_PAD_PX;
    const tagW = Math.min(it.w, room);
    tagWidths.set(it.id, tagW);
    const groupH = it.h + (fx ? gap + fx.h : 0) + (bubble ? gap + bubbleBox.h : 0);
    const geometry: SlotGeometry = {
      x: cx,
      unit,
      body,
      headTop: project.toScreenY(spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch), napHeadBobPx(ch))),
      tagH: it.h,
      groupH,
    };
    const facing = officeState.seatFacingOf(ch);
    const open = openSideSlots(facing, geometry);
    // The other side of the agent: on a leader to the agent itself wherever the tag lands. Under a
    // desk the tag touches the desk, so a leader to the desk would not be drawn and the tag would
    // read as the next seat's.
    const other = {
      ...slotOn(open[0].below ? 'above' : 'under', geometry),
      anchor: body,
      leader: true,
    };
    // A lit desk's tag goes to its frame, but only for one sitting at it: a frame around an empty
    // desk (its agent walking) would name the desk, not the agent.
    const frame = unitWorld ? frames.get(it.id) : undefined;
    items.push({
      id: it.id,
      rank: it.rank,
      col: ch.tileCol,
      row: ch.tileRow,
      w: Math.min(Math.max(tagW, fx?.w ?? 0, bubble ? bubbleBox.w : 0), room),
      tagW,
      tagH: it.h,
      slots: [...open, other],
      bounds,
      pin: frame
        ? {
            outline: frame.outline,
            unit: frame.unit,
            edge: facing === Direction.UP ? 'bottom' : 'top',
            groupH,
          }
        : undefined,
    });
  }
  const opts = {
    step: TAG_STEP_PX,
    leaderAt: TAG_LEADER_AT_PX,
    reach: TAG_REACH_PX,
    farReach: TAG_FAR_REACH_PX,
    pad: TAG_PAD_PX,
    sideCost: TAG_SIDE_COST,
    leaderPx: TAG_LEADER_PX,
  };
  // The banners first, on their walls: a tag finds another spot more easily than a banner does.
  // Then the agents' tags, then the helpers', clear of it all.
  // A banner keeps off the spots the agents' tags hang from over their heads: on a top row that
  // is the wall band, and a tag pushed off it would need a leader. The spot is where the tag lands
  // inside its room, with the solver's air around it and one step either side (the solver moves a
  // tag in whole steps, so a gap narrower than that fits nothing).
  const tagSpots: Rect[] = items
    .filter((it) => it.rank < HELPER_RANK)
    .flatMap((it) => {
      const [slot] = it.slots;
      const w = it.pin ? (it.tagW ?? it.w) : it.w;
      const x = it.pin ? it.pin.outline.x : slot.x - w / 2;
      const y = it.pin ? it.pin.outline.y - it.pin.groupH : slot.y;
      const h = it.pin ? it.pin.groupH : slot.h;
      if (!it.pin && slot.below) return [];
      const b = it.bounds;
      const left = Math.max(b.x, Math.min(x, b.x + b.w - w));
      const side = TAG_PAD_PX + TAG_STEP_PX;
      return [{ x: left - side, y: y - TAG_PAD_PX, w: w + 2 * side, h: h + 2 * TAG_PAD_PX }];
    });
  const banners = input.placeBanners([...input.obstacles, ...frameObstacles, ...bodies], tagSpots);
  const fixed: TagObstacle[] = [
    ...input.obstacles,
    ...frameObstacles,
    ...bodies,
    ...banners.map((b) => b.rect),
    ...bubbleSpots,
  ];
  const solved = placeTags(
    items.filter((it) => it.rank < HELPER_RANK),
    fixed,
    opts,
  );
  const agentGroups = [...solved.values()].flatMap((p) => (p ? [p.group] : []));
  const helpers = placeTags(
    items.filter((it) => it.rank >= HELPER_RANK),
    [...fixed, ...agentGroups],
    opts,
  );
  for (const [id, p] of helpers) solved.set(id, p);

  // The group is as wide as its widest rider; the tag itself keeps its own width, centred in it.
  const tagPlacements = new Map<number, TagPlacement | null>();
  const leaders = new Map<number, Rect>();
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
    const tagW = tagWidths.get(it.id) ?? it.w;
    const cx = hit.group.x + hit.group.w / 2;
    const tag = { x: cx - tagW / 2, y: hit.tag.y, w: tagW, h: hit.tag.h };
    tagPlacements.set(it.id, { ...hit, tag });
    const leader = hit.leader ? tagLeader(tag, hit.anchor, TAG_LEADER_PX) : null;
    if (leader) leaders.set(it.id, leader);
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
    tags: [...tagPlacements].flatMap(([id, p]) =>
      p ? [{ id, rect: page(p.tag), anchor: page(p.anchor), leader: leaders.has(id) }] : [],
    ),
    heads: chars.map((c) => ({ id: c.id, rect: page(headRect(project, c)) })),
    rooms: (layout.areas ?? []).flatMap((a) =>
      layout.areaTiles?.includes(a.label)
        ? [{ label: a.label, rect: page(screenRect(project, roomRect(layout, a.label))) }]
        : [],
    ),
    banners: banners.map((b) => ({
      leadId: b.leadId,
      rect: page(b.rect),
      onWall: b.onWall,
      band: b.band ? page(b.band) : null,
    })),
    plaques: input.plaques.map((p) => ({ label: p.label, rect: page(p.rect) })),
  };
  return { fxSlots, tagPlacements, leaders, banners };
}
