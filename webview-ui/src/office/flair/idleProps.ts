import { spriteAtArtDensity } from '../../../../core/src/assets/artDensity.js';
import idlePropsData from '../sprites/flair/idle-props.json';
import type { SpriteData } from '../types.js';
import { ANCHORS } from './accessories.js';

/**
 * The book and the mug an idle agent holds. Palette-free overlays drawn over the character at
 * fixed offsets from the sprite's top-left, so every one of the 12 sheets shares them and the
 * sheet only has to draw the hands around the empty space.
 */

interface PropsJson {
  /** Art px per world px of the pixel maps; absent = legacy 1x. Offsets are world px. */
  density?: number;
  palette: Record<string, string>;
  book: { dx: number; dy: number; a: string[][]; b: string[][] };
  mug: { dx: number; dy: number; pixels: string[][] };
}

const props = idlePropsData as PropsJson;

function resolve(pixels: string[][]): SpriteData {
  const sprite = pixels.map((row) => row.map((key) => props.palette[key] ?? ''));
  return spriteAtArtDensity(sprite, props.density, 'idle prop sprite');
}

// Built once: getCachedSprite keys its canvases on SpriteData identity.
export const BOOK_SPRITES: readonly [SpriteData, SpriteData] = [
  resolve(props.book.a),
  resolve(props.book.b),
];
export const MUG_SPRITE: SpriteData = resolve(props.mug.pixels);

export interface PropPlacement {
  sprite: SpriteData;
  /** Offset from the character sprite's top-left, in WORLD px. */
  dx: number;
  dy: number;
}

/** The book for page `page` (0 cover, 1 page-turn) on sheet frame `sheetFrame`: it rides with the sprite's bob. */
export function bookPlacement(page: number, sheetFrame: number): PropPlacement {
  return {
    sprite: BOOK_SPRITES[page % 2],
    dx: props.book.dx,
    dy: props.book.dy + (ANCHORS.down.bob[sheetFrame] ?? 0),
  };
}

export function mugPlacement(): PropPlacement {
  return { sprite: MUG_SPRITE, dx: props.mug.dx, dy: props.mug.dy };
}
