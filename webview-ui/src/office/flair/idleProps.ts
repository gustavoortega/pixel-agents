import { spriteAtArtDensity } from '../../../../core/src/assets/artDensity.js';
import {
  IDLE_PROP_STEAM_FRAME_SEC,
  NAP_ZZ_BACK_LIFT_PX,
  NAP_ZZ_DRIFT_PX,
  NAP_ZZ_PERIOD_MS,
  NAP_ZZ_RISE_PX,
} from '../../constants.js';
import idlePropsData from '../sprites/flair/idle-props.json';
import zzData from '../sprites/flair/zz.json';
import type { SpriteData } from '../types.js';
import { ANCHORS } from './accessories.js';

/**
 * The book and the mug an idle agent holds, the mug's steam and the napping Zz. Palette-free
 * overlays drawn over the character at fixed offsets from the sprite's top-left, so every one of
 * the 12 sheets shares them and the sheet only has to draw the hands around the empty space.
 */

type PixelMap = ReadonlyArray<ArrayLike<string>>;

interface PropsJson {
  /** Art px per world px of the pixel maps; absent = legacy 1x. Offsets are world px. */
  density?: number;
  palette: Record<string, string>;
  book: {
    dx: number;
    dy: number;
    a: PixelMap;
    b: PixelMap;
    /** Palette overrides, one per cover an agent can carry. */
    covers?: Array<Record<string, string>>;
  };
  mug: {
    dx: number;
    dy: number;
    pixels: PixelMap;
    /** Palette overrides, one per mug body. */
    bodies?: Array<Record<string, string>>;
  };
  steam?: { dx: number; dy: number; frames: PixelMap[] };
}

interface ZzJson {
  density?: number;
  palette: Record<string, string>;
  /** Spawn point, WORLD px from the sprite's top-left. */
  dx: number;
  dy: number;
  small: PixelMap;
  large: PixelMap;
}

const props = idlePropsData as PropsJson;
const zz = zzData as ZzJson;

function resolve(
  pixels: PixelMap,
  palette: Record<string, string>,
  density: number | undefined,
): SpriteData {
  const sprite = Array.from(pixels, (row) => Array.from(row, (key) => palette[key] ?? ''));
  return spriteAtArtDensity(sprite, density, 'idle prop sprite');
}

// Built once: getCachedSprite keys its canvases on SpriteData identity, so every variant is a
// module constant rather than a per-draw recolor.
const COVERS = props.book.covers?.length ? props.book.covers : [{}];
const BODIES = props.mug.bodies?.length ? props.mug.bodies : [{}];
const BOOK_SPRITES: ReadonlyArray<readonly [SpriteData, SpriteData]> = COVERS.map((cover) => {
  const palette = { ...props.palette, ...cover };
  return [
    resolve(props.book.a, palette, props.density),
    resolve(props.book.b, palette, props.density),
  ] as const;
});
const MUG_SPRITES: readonly SpriteData[] = BODIES.map((body) =>
  resolve(props.mug.pixels, { ...props.palette, ...body }, props.density),
);
const STEAM_SPRITES: readonly SpriteData[] = (props.steam?.frames ?? []).map((frame) =>
  resolve(frame, props.palette, props.density),
);
const ZZ_SMALL = resolve(zz.small, zz.palette, zz.density);
const ZZ_LARGE = resolve(zz.large, zz.palette, zz.density);

/**
 * A stable pick of one of `count` variants for an agent: the same agent always holds the same
 * cover and mug, and `salt` keeps the two choices independent.
 */
export function seededVariant(seed: number, salt: number, count: number): number {
  return (Math.imul((seed | 0) ^ salt, 0x9e3779b1) >>> 0) % count;
}
const COVER_SALT = 0x51;
const BODY_SALT = 0xa7;

export interface PropPlacement {
  sprite: SpriteData;
  /** Offset from the character sprite's top-left, in WORLD px. */
  dx: number;
  dy: number;
}

/** The book for page `page` (0 cover, 1 page-turn) on sheet frame `sheetFrame`: it rides with the
 *  sprite's bob. `seed` (the agent id) picks the cover. */
export function bookPlacement(page: number, sheetFrame: number, seed: number): PropPlacement {
  const covers = BOOK_SPRITES[seededVariant(seed, COVER_SALT, BOOK_SPRITES.length)];
  return {
    sprite: covers[page % 2],
    dx: props.book.dx,
    dy: props.book.dy + (ANCHORS.down.bob[sheetFrame] ?? 0),
  };
}

/** The mug in the sip pose; `seed` (the agent id) picks the body. */
export function mugPlacement(seed: number): PropPlacement {
  return {
    sprite: MUG_SPRITES[seededVariant(seed, BODY_SALT, MUG_SPRITES.length)],
    dx: props.mug.dx,
    dy: props.mug.dy,
  };
}

/** The steam loop over the mug, `poseSec` into the pose; null when the art has no steam. */
export function steamPlacement(poseSec: number): PropPlacement | null {
  if (!props.steam || STEAM_SPRITES.length === 0) return null;
  const frame = Math.floor(poseSec / IDLE_PROP_STEAM_FRAME_SEC) % STEAM_SPRITES.length;
  return { sprite: STEAM_SPRITES[frame], dx: props.steam.dx, dy: props.steam.dy };
}

export interface ZzPlacement extends PropPlacement {
  alpha: number;
}

/**
 * The napping Zz at `nowMs`: a small and a large glyph half a cycle apart, each spawned over the
 * bowed head, rising NAP_ZZ_RISE_PX and drifting NAP_ZZ_DRIFT_PX over one cycle while it fades.
 * Never more than two per agent.
 */
/**
 * The spawn point sits over the bowed head of the front-view nap frame. Seen from behind or the side
 * the head stays upright, so the glyphs start NAP_ZZ_BACK_LIFT_PX higher, above the head instead of
 * on the back of it.
 */
export function napZzPlacements(nowMs: number, facesViewer = true): ZzPlacement[] {
  const lift = facesViewer ? 0 : NAP_ZZ_BACK_LIFT_PX;
  return [
    { sprite: ZZ_SMALL, phase: 0 },
    { sprite: ZZ_LARGE, phase: 0.5 },
  ].map(({ sprite, phase }) => {
    const t = (nowMs / NAP_ZZ_PERIOD_MS + phase) % 1;
    return {
      sprite,
      dx: zz.dx + t * NAP_ZZ_DRIFT_PX,
      dy: zz.dy - lift - t * NAP_ZZ_RISE_PX,
      alpha: 1 - t * t,
    };
  });
}
