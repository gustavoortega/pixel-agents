import type { ModelTier } from '../../../../core/src/provider.js';
import {
  ACCESSORY_FRONT_Z_OFFSET,
  CAPE_BEHIND_Z_OFFSET,
  CAPE_OVER_Z_OFFSET,
  SPARKLE_MIN_ALPHA,
  SPARKLE_PERIOD_MS,
} from '../../constants.js';
import { seatedDrawOffsetPx } from '../seatDraw.js';
import anchorsData from '../sprites/flair/anchors.json';
import capeData from '../sprites/flair/cape.json';
import crownData from '../sprites/flair/crown.json';
import headphonesData from '../sprites/flair/headphones.json';
import sparkleData from '../sprites/flair/sparkle.json';
import type { CharacterState, SpriteData } from '../types.js';
import { Direction } from '../types.js';
import { AccessoryKind } from './modelFlair.js';

/**
 * Equipment overlays (headphones, cape, crown) and the Fable sparkles. Sprites
 * are authored per direction (down/up/right, left is the right map flipped) and
 * placed by anchors, never by absolute pixel, so a re-drawn character sheet only
 * needs a new anchors.json.
 */

type FacingKey = 'down' | 'up' | 'right';

interface DirectionMap {
  /** Map row that lands on the anchor row. */
  row: number;
  pixels: string[][];
}

interface AccessoryJson {
  anchor: 'head' | 'shoulder';
  palette: Record<string, string>;
  /** Palette overrides keyed by model tier (the cape's color). */
  variants?: Record<string, Record<string, string>>;
  directions: Record<FacingKey, DirectionMap>;
}

interface AnchorsJson {
  down: AnchorSet;
  up: AnchorSet;
  right: AnchorSet;
  sparkles: Array<{ dx: number; dy: number; phaseMs: number }>;
}

interface AnchorSet {
  headTopY: number;
  shoulderY: number;
  /** Vertical offset of each sheet frame's head relative to the anchors (`down` also covers the idle row, frames 7..10). */
  bob: number[];
  /** Same for the shoulder line: the head can move alone (nap), the shoulders cannot. */
  shoulderBob: number[];
}

const ACCESSORIES: Record<AccessoryKind, AccessoryJson> = {
  [AccessoryKind.HEADPHONES]: headphonesData as AccessoryJson,
  [AccessoryKind.CAPE]: capeData as AccessoryJson,
  [AccessoryKind.CROWN]: crownData as AccessoryJson,
};

export const ANCHORS = anchorsData as AnchorsJson;

/** Left is the right sheet flipped, and so are its accessories. */
function facingKey(dir: Direction): FacingKey {
  if (dir === Direction.DOWN) return 'down';
  if (dir === Direction.UP) return 'up';
  return 'right';
}

function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

function resolve(json: AccessoryJson, pixels: string[][], tier: ModelTier | undefined): SpriteData {
  const palette = { ...json.palette, ...(tier === undefined ? {} : json.variants?.[tier]) };
  return pixels.map((row) => row.map((key) => palette[key] ?? ''));
}

// Module constants: one SpriteData per (accessory, direction, tier), built once.
// getCachedSprite keys its canvases on SpriteData identity, so rebuilding or
// re-flipping per frame would allocate a canvas per draw.
const spriteMemo = new Map<string, SpriteData>();

export function getAccessorySprite(
  kind: AccessoryKind,
  dir: Direction,
  tier: ModelTier | undefined,
): SpriteData {
  const key = `${kind}:${dir}:${tier ?? ''}`;
  const cached = spriteMemo.get(key);
  if (cached) return cached;
  const json = ACCESSORIES[kind];
  const sprite = resolve(json, json.directions[facingKey(dir)].pixels, tier);
  const built = dir === Direction.LEFT ? flipHorizontal(sprite) : sprite;
  spriteMemo.set(key, built);
  return built;
}

export interface AccessoryPlacement {
  sprite: SpriteData;
  /** Rows (sprite pixels) from the character sprite's top edge to the accessory's top edge; may be negative. */
  dy: number;
}

/**
 * Where an accessory sits on the character's current sheet frame. The
 * accessory is as wide as the character sprite, so only the vertical offset is
 * needed: the anchor row of the direction, plus that frame's bob, minus the
 * accessory's own anchor row.
 */
export function accessoryPlacement(
  kind: AccessoryKind,
  dir: Direction,
  sheetFrame: number,
  tier: ModelTier | undefined,
): AccessoryPlacement {
  const json = ACCESSORIES[kind];
  const key = facingKey(dir);
  const anchors = ANCHORS[key];
  const anchorY = json.anchor === 'head' ? anchors.headTopY : anchors.shoulderY;
  const bob = (json.anchor === 'head' ? anchors.bob : anchors.shoulderBob)[sheetFrame] ?? 0;
  return {
    sprite: getAccessorySprite(kind, dir, tier),
    dy: anchorY + bob - json.directions[key].row,
  };
}

/**
 * Z-sort key of an accessory around the character body at `charZY`.
 * Order for down/left/right: rarity outline < cape < body < headphones/crown.
 * A cape on a character facing up hangs over the back, so it sorts after the body.
 */
export function accessoryZ(kind: AccessoryKind, dir: Direction, charZY: number): number {
  if (kind === AccessoryKind.CAPE) {
    return dir === Direction.UP ? charZY + CAPE_OVER_Z_OFFSET : charZY - CAPE_BEHIND_Z_OFFSET;
  }
  return charZY + ACCESSORY_FRONT_Z_OFFSET;
}

/**
 * Top-left of a character sprite on the canvas, in device pixels: bottom-centre
 * anchored on (x, y), sitting characters shifted down so they sit in the chair.
 * Equipment is placed relative to this, so it follows the sitting offset.
 */
export function characterDrawOrigin(
  ch: { x: number; y: number; state: CharacterState; drawSink?: number },
  spriteWidthPx: number,
  spriteHeightPx: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): { drawX: number; drawY: number } {
  const sittingOffset = seatedDrawOffsetPx(ch);
  return {
    drawX: Math.round(offsetX + ch.x * zoom - spriteWidthPx / 2),
    drawY: Math.round(offsetY + (ch.y + sittingOffset) * zoom - spriteHeightPx),
  };
}

// ── Sparkles ────────────────────────────────────────────────────

export const SPARKLE_SPRITE: SpriteData = (
  sparkleData as { palette: Record<string, string>; pixels: string[][] }
).pixels.map((row) =>
  row.map((key) => (sparkleData as { palette: Record<string, string> }).palette[key] ?? ''),
);

/** Alpha of one sparkle at `timeMs`: a triangle wave between the floor and 1, offset by its phase. */
export function sparkleAlpha(timeMs: number, phaseMs: number): number {
  const t = (((timeMs + phaseMs) % SPARKLE_PERIOD_MS) + SPARKLE_PERIOD_MS) % SPARKLE_PERIOD_MS;
  const half = SPARKLE_PERIOD_MS / 2;
  const wave = t < half ? t / half : (SPARKLE_PERIOD_MS - t) / half;
  return SPARKLE_MIN_ALPHA + (1 - SPARKLE_MIN_ALPHA) * wave;
}
