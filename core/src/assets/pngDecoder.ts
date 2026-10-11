/**
 * Pure PNG decoding utilities — shared between the extension host, Vite build
 * scripts, and future standalone backend.
 *
 * No VS Code dependency. Only uses pngjs and shared constants.
 */

import { PNG } from 'pngjs';

import type { RgbaImage } from './artDensity.js';
import {
  decodeCarpetSet,
  decodeCharacterSheet,
  decodeFloorTile,
  decodeFurnitureImage,
  decodePetSheet,
  decodeWallSet,
  emptyArtSprite,
} from './artDensity.js';
import { FLOOR_TILE_SIZE, PET_FRAME_H, PET_FRAME_W_LARGE, PET_FRAME_W_SMALL } from './constants.js';
import type { CharacterDirectionSprites, PetSpriteFrames } from './types.js';

// ── Sprite decoding ──────────────────────────────────────────

/**
 * Strip trailing bytes after the PNG IEND chunk.
 *
 * Aseprite-generated PNGs sometimes include trailing null bytes after IEND,
 * which causes `pngjs` to throw. The IEND chunk layout is:
 *   4 bytes length (0x00000000) + 4 bytes type ('IEND') + 4 bytes CRC = 12 bytes
 * Some encoders emit ≤4 bytes of trailing garbage, so we scan from `buf.length - 8`
 * (not `-12`) to find the IEND type marker.
 */
function sanitizePngBuffer(buf: Buffer): Buffer {
  // IEND type bytes: 0x49 0x45 0x4E 0x44 ('I' 'E' 'N' 'D')
  for (let i = buf.length - 8; i >= 8; i--) {
    if (buf[i] === 0x49 && buf[i + 1] === 0x45 && buf[i + 2] === 0x4e && buf[i + 3] === 0x44) {
      const endPos = i + 4 + 4; // past type bytes + 4-byte CRC
      if (buf.length > endPos) {
        return buf.subarray(0, endPos);
      }
      break;
    }
  }
  return buf;
}

function readPng(pngBuffer: Buffer): RgbaImage {
  const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Decode a furniture PNG into SpriteData at ART_DENSITY. `width`/`height` are the manifest's
 * WORLD px; a PNG at neither 1x nor ART_DENSITY of them throws an error naming `id`.
 */
export function decodeFurniturePng(
  pngBuffer: Buffer,
  id: string,
  width: number,
  height: number,
): string[][] {
  return decodeFurnitureImage(readPng(pngBuffer), id, width, height);
}

/** Decode a wall set PNG (4x4 grid of pieces, 1x or ART_DENSITY) into 16 bitmask sprites. */
export function parseWallPng(pngBuffer: Buffer): string[][][] {
  return decodeWallSet(readPng(pngBuffer));
}

/** Decode a carpet PNG (4x4 grid of marching-squares pieces, 1x or ART_DENSITY) into 16 sprites;
 *  case 0 (empty junction) is included but the renderer skips it. */
export function parseCarpetPng(pngBuffer: Buffer): string[][][] {
  return decodeCarpetSet(readPng(pngBuffer));
}

/**
 * Decode a character sheet (7 frames per row; rows down, up, right and the optional front-view
 * idle row, appended to `down` as frames 7..10). A sheet without the idle row decodes as before.
 */
export function decodeCharacterPng(pngBuffer: Buffer): CharacterDirectionSprites {
  return decodeCharacterSheet(readPng(pngBuffer));
}

/** Decode a floor tile PNG. A broken file becomes a clear tile so one bad pattern does not abort
 *  the floor broadcast. */
export function decodeFloorPng(pngBuffer: Buffer): string[][] {
  try {
    return decodeFloorTile(readPng(pngBuffer));
  } catch (err) {
    console.warn(`Failed to parse floor PNG: ${err instanceof Error ? err.message : err}`);
    return emptyArtSprite(FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
  }
}

/**
 * Decode a pet PNG into direction- and state-keyed frames. walkLeft / idleLeft are derived at
 * render time by horizontal flip (webview).
 *
 * Safe-fallback: returns all-empty frames on any decode error so a broken spritesheet doesn't
 * abort the pet asset broadcast.
 */
export function decodePetPng(pngBuffer: Buffer): PetSpriteFrames {
  try {
    return decodePetSheet(readPng(pngBuffer));
  } catch (err) {
    console.warn(
      `[PngDecoder] Failed to parse pet PNG: ${err instanceof Error ? err.message : err}`,
    );
    const small = (): string[][] => emptyArtSprite(PET_FRAME_W_SMALL, PET_FRAME_H);
    const large = (): string[][] => emptyArtSprite(PET_FRAME_W_LARGE, PET_FRAME_H);
    return {
      walkDown: [small(), small(), small()],
      idleDown: [small(), small(), small()],
      walkUp: [small(), small(), small()],
      idleUp: [small(), small(), small()],
      walkRight: [large(), large(), large()],
    };
  }
}
