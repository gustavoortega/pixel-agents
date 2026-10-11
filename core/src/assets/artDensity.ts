/**
 * Art density detection and slicing, on plain RGBA buffers.
 *
 * Pure on purpose: the pngjs decoder (server, Vite plugin) and the browser fallback in
 * browserMock.ts both feed it, so a 1x file and its 2x redraw decode the same way everywhere and
 * the browser bundle never pulls in pngjs.
 *
 * Every decoder returns SpriteData at ART_DENSITY. A legacy 1x file is upscaled nearest-neighbour
 * first, so it renders exactly as before at the same physical size.
 */

import { rgbaToHex } from './colorUtils.js';
import {
  ART_DENSITY,
  CARPET_GRID_COLS,
  CARPET_MARCHING_SQUARES_COUNT,
  CARPET_TILE_SIZE,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHAR_IDLE_FRAMES,
  CHAR_IDLE_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_IMAGE_HEIGHT,
  PET_IMAGE_WIDTH,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  PNG_ALPHA_THRESHOLD,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from './constants.js';
import type { CharacterDirectionSprites, PetSpriteFrames } from './types.js';

/** Decoded RGBA pixels, row-major, 4 bytes per pixel (pngjs and canvas ImageData both fit). */
export interface RgbaImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/**
 * Density of a file from one measured extent and its legacy (1x) value: 1 or ART_DENSITY.
 * Anything else is an error naming `what`, because a guessed density would slice garbage.
 */
export function detectDensity(actual: number, legacy: number, what: string): number {
  if (actual === legacy) return 1;
  if (actual === legacy * ART_DENSITY) return ART_DENSITY;
  throw new Error(
    `${what}: ${actual} px, expected ${legacy} (1x) or ${legacy * ART_DENSITY} (${ART_DENSITY}x)`,
  );
}

/** The image at ART_DENSITY: 1x art is upscaled nearest-neighbour, art already there is returned. */
export function toArtDensity(img: RgbaImage, density: number): RgbaImage {
  if (density === ART_DENSITY) return img;
  const f = ART_DENSITY / density;
  const width = img.width * f;
  const height = img.height * f;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / f);
    for (let x = 0; x < width; x++) {
      const src = (sy * img.width + Math.floor(x / f)) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = img.data[src];
      data[dst + 1] = img.data[src + 1];
      data[dst + 2] = img.data[src + 2];
      data[dst + 3] = img.data[src + 3];
    }
  }
  return { width, height, data };
}

type HexOf = (r: number, g: number, b: number, a: number) => string;

/** One string per distinct color for a whole decode, so a sheet holds a few dozen strings, not
 *  one per pixel. */
function hexInterner(): HexOf {
  const memo = new Map<number, string>();
  return (r, g, b, a) => {
    if (a < PNG_ALPHA_THRESHOLD) return '';
    const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    let hex = memo.get(key);
    if (hex === undefined) {
      hex = rgbaToHex(r, g, b, a);
      memo.set(key, hex);
    }
    return hex;
  };
}

/** The w x h block at (x, y), in the image's own pixels. Outside the image reads as clear. */
function slice(img: RgbaImage, x: number, y: number, w: number, h: number, hex: HexOf): string[][] {
  const sprite: string[][] = [];
  for (let r = 0; r < h; r++) {
    const row: string[] = [];
    const py = y + r;
    for (let c = 0; c < w; c++) {
      const px = x + c;
      if (px >= img.width || py >= img.height) {
        row.push('');
        continue;
      }
      const i = (py * img.width + px) * 4;
      row.push(hex(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

/** A transparent sprite of w x h WORLD px, at art density. */
export function emptyArtSprite(w: number, h: number): string[][] {
  return Array.from({ length: h * ART_DENSITY }, () => new Array<string>(w * ART_DENSITY).fill(''));
}

/**
 * Character sheet: 7 frames x CHAR_FRAME_W wide, rows down/up/right plus the optional idle row,
 * appended to `down` as frames 7..10. Density comes from the width: legacy sheets are 96 or 128
 * tall depending on the idle row, so the height is ambiguous and the width is not.
 */
export function decodeCharacterSheet(img: RgbaImage): CharacterDirectionSprites {
  const density = detectDensity(img.width, CHAR_FRAMES_PER_ROW * CHAR_FRAME_W, 'character sheet');
  const art = toArtDensity(img, density);
  const fw = CHAR_FRAME_W * ART_DENSITY;
  const fh = CHAR_FRAME_H * ART_DENSITY;
  const hex = hexInterner();
  const out: CharacterDirectionSprites = { down: [], up: [], right: [] };
  CHARACTER_DIRECTIONS.forEach((dir, d) => {
    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++)
      out[dir].push(slice(art, f * fw, d * fh, fw, fh, hex));
  });
  if (art.height >= (CHAR_IDLE_ROW + 1) * fh) {
    for (let f = 0; f < CHAR_IDLE_FRAMES; f++) {
      out.down.push(slice(art, f * fw, CHAR_IDLE_ROW * fh, fw, fh, hex));
    }
  }
  return out;
}

/** Wall set: a 4x4 grid of pieces; the piece for bitmask M is at col M % 4, row floor(M / 4). */
export function decodeWallSet(img: RgbaImage): string[][][] {
  const rows = WALL_BITMASK_COUNT / WALL_GRID_COLS;
  const density = detectDensity(img.height, rows * WALL_PIECE_HEIGHT, 'wall set');
  const art = toArtDensity(img, density);
  const pw = WALL_PIECE_WIDTH * ART_DENSITY;
  const ph = WALL_PIECE_HEIGHT * ART_DENSITY;
  const hex = hexInterner();
  const pieces: string[][][] = [];
  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const c = mask % WALL_GRID_COLS;
    const r = Math.floor(mask / WALL_GRID_COLS);
    pieces.push(slice(art, c * pw, r * ph, pw, ph, hex));
  }
  return pieces;
}

/** Floor pattern: one tile per file. */
export function decodeFloorTile(img: RgbaImage): string[][] {
  const density = detectDensity(img.height, FLOOR_TILE_SIZE, 'floor tile');
  const size = FLOOR_TILE_SIZE * ART_DENSITY;
  return slice(toArtDensity(img, density), 0, 0, size, size, hexInterner());
}

/** Carpet set: 16 marching-squares pieces in a 4x4 grid; case N at col N % 4, row floor(N / 4). */
export function decodeCarpetSet(img: RgbaImage): string[][][] {
  const rows = CARPET_MARCHING_SQUARES_COUNT / CARPET_GRID_COLS;
  const density = detectDensity(img.height, rows * CARPET_TILE_SIZE, 'carpet set');
  const art = toArtDensity(img, density);
  const size = CARPET_TILE_SIZE * ART_DENSITY;
  const hex = hexInterner();
  const pieces: string[][][] = [];
  for (let ms = 0; ms < CARPET_MARCHING_SQUARES_COUNT; ms++) {
    const c = ms % CARPET_GRID_COLS;
    const r = Math.floor(ms / CARPET_GRID_COLS);
    pieces.push(slice(art, c * size, r * size, size, size, hex));
  }
  return pieces;
}

/**
 * Pet sheet. Row 0: walkDown x3 then idleDown x3 (small frames); row 1: walkUp x3 then idleUp x3;
 * row 2: walkRight x3 (large frames). Left is the right row flipped at render time.
 */
export function decodePetSheet(img: RgbaImage): PetSpriteFrames {
  const density = detectDensity(img.height, PET_IMAGE_HEIGHT, 'pet sheet');
  if (img.width !== PET_IMAGE_WIDTH * density) {
    throw new Error(`pet sheet: ${img.width} px wide, expected ${PET_IMAGE_WIDTH * density}`);
  }
  const art = toArtDensity(img, density);
  const sw = PET_FRAME_W_SMALL * ART_DENSITY;
  const lw = PET_FRAME_W_LARGE * ART_DENSITY;
  const fh = PET_FRAME_H * ART_DENSITY;
  const hex = hexInterner();
  const run = (first: number, count: number, w: number, row: number): string[][][] =>
    Array.from({ length: count }, (_, f) => slice(art, (first + f) * w, row * fh, w, fh, hex));
  return {
    walkDown: run(0, PET_WALK_FRAMES_VERT, sw, 0),
    idleDown: run(PET_WALK_FRAMES_VERT, PET_IDLE_FRAMES_VERT, sw, 0),
    walkUp: run(0, PET_WALK_FRAMES_VERT, sw, 1),
    idleUp: run(PET_WALK_FRAMES_VERT, PET_IDLE_FRAMES_VERT, sw, 1),
    walkRight: run(0, PET_WALK_FRAMES_HORIZ, lw, 2),
  };
}

/**
 * Furniture sprite. The manifest's width/height are WORLD px; the PNG must measure them at 1x or
 * at ART_DENSITY. Any other size throws naming the asset, so a half-migrated item fails loudly
 * instead of rendering at the wrong scale.
 */
export function decodeFurnitureImage(
  img: RgbaImage,
  id: string,
  width: number,
  height: number,
): string[][] {
  const density =
    img.width === width && img.height === height
      ? 1
      : img.width === width * ART_DENSITY && img.height === height * ART_DENSITY
        ? ART_DENSITY
        : 0;
  if (density === 0) {
    throw new Error(
      `furniture "${id}": PNG is ${img.width}x${img.height}, expected ${width}x${height} (1x) or ${width * ART_DENSITY}x${height * ART_DENSITY} (${ART_DENSITY}x)`,
    );
  }
  const art = toArtDensity(img, density);
  return slice(art, 0, 0, art.width, art.height, hexInterner());
}

/** A manifest `density` is a declaration to check, never a source of truth: the PNG decides. */
export function validateManifestDensity(density: unknown, id: string): void {
  if (density === undefined) return;
  if (density !== 1 && density !== ART_DENSITY) {
    throw new Error(
      `furniture "${id}": manifest density ${String(density)}, expected 1 or ${ART_DENSITY}`,
    );
  }
}

// ── SpriteData helpers (hex grids) ─────────────────────────────

/** Nearest-neighbour upscale of a hex grid by `factor` (each pixel becomes a factor x factor block). */
export function upscaleSprite(sprite: readonly (readonly string[])[], factor: number): string[][] {
  const out: string[][] = [];
  for (const row of sprite) {
    const wide: string[] = [];
    for (const px of row) for (let i = 0; i < factor; i++) wide.push(px);
    for (let i = 0; i < factor; i++) out.push(i === 0 ? wide : [...wide]);
  }
  return out;
}

/**
 * A JSON-authored sprite at ART_DENSITY. Flair files declare `"density"`; a file without one is
 * legacy 1x art and is upscaled. Offsets in those files are world px at any density, so only the
 * pixel map changes.
 */
export function spriteAtArtDensity(
  sprite: readonly (readonly string[])[],
  declared: number | undefined,
  what: string,
): string[][] {
  const density = declared ?? 1;
  if (density !== 1 && density !== ART_DENSITY) {
    throw new Error(`${what}: density ${density}, expected 1 or ${ART_DENSITY}`);
  }
  return density === ART_DENSITY
    ? sprite.map((row) => [...row])
    : upscaleSprite(sprite, ART_DENSITY / density);
}

/** Width of a sprite in WORLD px (its art width over ART_DENSITY): what placement, z and hit
 *  tests use, whatever the art resolution. */
export function spriteWorldWidth(sprite: readonly (readonly string[])[]): number {
  return (sprite[0]?.length ?? 0) / ART_DENSITY;
}

/** Height of a sprite in WORLD px. */
export function spriteWorldHeight(sprite: readonly (readonly string[])[]): number {
  return sprite.length / ART_DENSITY;
}
