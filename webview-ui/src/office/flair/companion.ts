import {
  COMPANION_BOB_INTERVAL_SEC,
  COMPANION_HOVER_PX,
  COMPANION_IDLE_FRAME_DURATION_SEC,
  COMPANION_MOVE_FRAME_DURATION_SEC,
  COMPANION_SPEED_PX_PER_SEC,
  COMPANION_TRAIL_LENGTH,
} from '../../constants.js';
import birdData from '../sprites/flair/companion-bird.json';
import catData from '../sprites/flair/companion-cat.json';
import dragonData from '../sprites/flair/companion-dragon.json';
import owlData from '../sprites/flair/companion-owl.json';
import type { SpriteData } from '../types.js';
import { TILE_SIZE } from '../types.js';
import { CompanionKind } from './modelFlair.js';

/**
 * The companion that follows an agent: a lightweight follower, not a layout
 * Pet and with no pet AI. It never blocks, is never clickable, and exists only
 * while it has a free tile to stand on.
 */

export interface Tile {
  col: number;
  row: number;
}

/** Left, right, then below the agent: the order a seated companion tries them. */
export const SEATED_COMPANION_OFFSETS: ReadonlyArray<Tile> = [
  { col: -1, row: 0 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
];

const FLYING_KINDS: ReadonlySet<CompanionKind> = new Set([
  CompanionKind.BIRD,
  CompanionKind.DRAGON,
]);

/**
 * The tile a companion should be on, or null when it has none and stays hidden.
 *
 * A stationary agent (seated, or standing still) gets the first free of left,
 * right and below. A walking agent gets the tile it just left, so the
 * companion trails by at most one tile; if that tile is taken the companion
 * is hidden until it frees up, never stacked on whatever is there. With no
 * history yet (the agent has not left its tile) it falls back to the
 * stationary rule.
 */
export function companionTile(input: {
  moving: boolean;
  agentTile: Tile;
  /** Tiles the agent left behind, most recent first. */
  trail: readonly Tile[];
  isFree: (tile: Tile) => boolean;
}): Tile | null {
  const { moving, agentTile, trail, isFree } = input;
  if (moving && trail.length > 0) {
    const behind = trail[0];
    return isFree(behind) ? behind : null;
  }
  for (const off of SEATED_COMPANION_OFFSETS) {
    const tile = { col: agentTile.col + off.col, row: agentTile.row + off.row };
    if (isFree(tile)) return tile;
  }
  return null;
}

/**
 * The desk tile a seated hero's companion sits on: one tile right of the monitor the seat faces.
 * Null when the seat faces no monitor within `depth` tiles, or that tile is not desk surface
 * (or is taken); the caller then falls back to the floor rule.
 */
export function deskCompanionTile(input: {
  seat: Tile;
  /** Unit step of the seat's facing. */
  facing: Tile;
  depth: number;
  electronicsTiles: ReadonlySet<string>;
  deskTiles: ReadonlyMap<string, number>;
  isTaken: (tile: Tile) => boolean;
}): Tile | null {
  const { seat, facing, depth, electronicsTiles, deskTiles, isTaken } = input;
  for (let d = 1; d <= depth; d++) {
    const monitor = { col: seat.col + facing.col * d, row: seat.row + facing.row * d };
    if (!electronicsTiles.has(`${monitor.col},${monitor.row}`)) continue;
    const tile = { col: monitor.col + 1, row: monitor.row };
    const key = `${tile.col},${tile.row}`;
    return deskTiles.has(key) && !electronicsTiles.has(key) && !isTaken(tile) ? tile : null;
  }
  return null;
}

/**
 * Where the companion of an agent sitting on a sofa rests: on the coffee table in front of it. The
 * first table tile along the seat's facing line, else the table tile beside that one (right, then
 * left). Null when the sofa faces no table or every candidate is taken.
 */
export function tableCompanionTile(input: {
  seat: Tile;
  /** Unit step of the seat's facing. */
  facing: Tile;
  depth: number;
  tableTiles: ReadonlyMap<string, number>;
  isTaken: (tile: Tile) => boolean;
}): Tile | null {
  const { seat, facing, depth, tableTiles, isTaken } = input;
  for (let d = 1; d <= depth; d++) {
    const contact = { col: seat.col + facing.col * d, row: seat.row + facing.row * d };
    if (!tableTiles.has(`${contact.col},${contact.row}`)) continue;
    const beside = [
      contact,
      { col: contact.col + 1, row: contact.row },
      { col: contact.col - 1, row: contact.row },
    ];
    return beside.find((t) => tableTiles.has(`${t.col},${t.row}`) && !isTaken(t)) ?? null;
  }
  return null;
}

/** New trail after the agent moved from `from` to `to`; unchanged while it stays put. */
export function advanceTrail(trail: readonly Tile[], from: Tile, to: Tile): readonly Tile[] {
  if (from.col === to.col && from.row === to.row) return trail;
  return [from, ...trail].slice(0, COMPANION_TRAIL_LENGTH);
}

/** Vertical offset of a companion's feet, world px (negative = up). */
export function companionHoverOffsetPx(kind: CompanionKind, timeSec: number): number {
  if (!FLYING_KINDS.has(kind)) return 0;
  const bob = Math.floor(timeSec / COMPANION_BOB_INTERVAL_SEC) % 2 === 0 ? 0 : -1;
  return -COMPANION_HOVER_PX + bob;
}

// ── Sprites ─────────────────────────────────────────────────────

interface CompanionJson {
  facing: 'left' | 'right';
  palette: Record<string, string>;
  frames: { idle: string[][][]; move: string[][][] };
}

export const CompanionSet = { IDLE: 'idle', MOVE: 'move' } as const;
export type CompanionSet = (typeof CompanionSet)[keyof typeof CompanionSet];

const COMPANION_JSON: Record<CompanionKind, CompanionJson> = {
  [CompanionKind.BIRD]: birdData as CompanionJson,
  [CompanionKind.CAT]: catData as CompanionJson,
  [CompanionKind.OWL]: owlData as CompanionJson,
  [CompanionKind.DRAGON]: dragonData as CompanionJson,
};

const companionSprites = new Map<string, SpriteData>();

/**
 * One SpriteData per (kind, set, frame, facing), built once: the draw cache is
 * keyed on SpriteData identity, so flipping per frame would allocate a canvas per draw.
 */
export function getCompanionSprite(
  kind: CompanionKind,
  set: CompanionSet,
  frame: number,
  facingRight: boolean,
): SpriteData {
  const key = `${kind}:${set}:${frame}:${facingRight}`;
  const cached = companionSprites.get(key);
  if (cached) return cached;
  const json = COMPANION_JSON[kind];
  const frames = json.frames[set];
  const pixels = frames[frame % frames.length];
  let sprite = pixels.map((row) => row.map((k) => json.palette[k] ?? ''));
  if ((json.facing === 'right') !== facingRight) {
    sprite = sprite.map((row) => [...row].reverse());
  }
  companionSprites.set(key, sprite);
  return sprite;
}

// ── State ───────────────────────────────────────────────────────

export interface Companion {
  agentId: number;
  kind: CompanionKind;
  /** World px, tile centre. */
  x: number;
  y: number;
  /** False while the companion has no free tile. */
  visible: boolean;
  facingRight: boolean;
  set: CompanionSet;
  frame: number;
  frameTimer: number;
  /** Tiles the agent left behind, most recent first. */
  trail: readonly Tile[];
  /** Where the agent was on the previous update, to detect a step. */
  lastAgentTile: Tile;
  /** Sort depth of the desk the companion stands on; null on the floor. It sorts just in front of it. */
  deskZY: number | null;
}

export function createCompanion(agentId: number, kind: CompanionKind, agentTile: Tile): Companion {
  return {
    agentId,
    kind,
    x: agentTile.col * TILE_SIZE + TILE_SIZE / 2,
    y: agentTile.row * TILE_SIZE + TILE_SIZE / 2,
    visible: false,
    facingRight: true,
    set: CompanionSet.IDLE,
    frame: 0,
    frameTimer: 0,
    trail: [],
    lastAgentTile: agentTile,
    deskZY: null,
  };
}

/**
 * Move a companion toward its tile (or hide it) and advance its animation.
 * A companion that was hidden snaps to its tile: gliding across the room from
 * wherever it vanished would walk it through walls and furniture.
 */
export function updateCompanion(
  c: Companion,
  target: Tile | null,
  agentCol: number,
  dt: number,
): void {
  if (!target) {
    c.visible = false;
    return;
  }
  const tx = target.col * TILE_SIZE + TILE_SIZE / 2;
  const ty = target.row * TILE_SIZE + TILE_SIZE / 2;
  if (!c.visible) {
    c.visible = true;
    c.x = tx;
    c.y = ty;
  }
  const dx = tx - c.x;
  const dy = ty - c.y;
  const dist = Math.hypot(dx, dy);
  const step = COMPANION_SPEED_PX_PER_SEC * dt;
  let moving = false;
  if (dist > 0.01) {
    moving = true;
    if (dist <= step) {
      c.x = tx;
      c.y = ty;
    } else {
      c.x += (dx / dist) * step;
      c.y += (dy / dist) * step;
    }
    if (Math.abs(dx) > 0.5) c.facingRight = dx > 0;
  } else if (agentCol !== target.col) {
    // Standing still: face the agent
    c.facingRight = agentCol > target.col;
  }

  const nextSet = moving ? CompanionSet.MOVE : CompanionSet.IDLE;
  if (nextSet !== c.set) {
    c.set = nextSet;
    c.frame = 0;
    c.frameTimer = 0;
  }
  c.frameTimer += dt;
  const frameDuration =
    c.set === CompanionSet.MOVE
      ? COMPANION_MOVE_FRAME_DURATION_SEC
      : COMPANION_IDLE_FRAME_DURATION_SEC;
  if (c.frameTimer >= frameDuration) {
    c.frameTimer -= frameDuration;
    c.frame = (c.frame + 1) % 2;
  }
}
