/**
 * getCachedSprite sizes its canvas in WORLD px times zoom, whatever the art density, and zoom 1
 * draws the 2x2 downsample: upscaled 1x art must come back as its original pixels, so legacy
 * assets look exactly as they did. The DOM is a stub that records the canvases and pixel uploads.
 *
 * Run with: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getCachedSprite } from '../src/office/sprites/spriteCache.js';
import type { SpriteData } from '../src/office/types.js';

const uploads: Array<{ data: Uint8ClampedArray; width: number }> = [];

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
        }),
        putImageData: (img: { data: Uint8ClampedArray; width: number }) => uploads.push(img),
        drawImage: () => undefined,
      }),
    }),
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const hex = (...bytes: number[]) =>
  `#${bytes.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const OPAQUE = [0x10, 0x20, 0x30, 255];
const TRANSLUCENT = [0xa0, 0xb0, 0xc0, 0x80];

/** A 32x64 art sprite (16x32 world px) that is a 1x pattern upscaled by hand: clear, opaque
 *  and translucent pixels. */
const LEGACY_BYTES = Array.from({ length: 32 }, (_, y) =>
  Array.from({ length: 16 }, (_, x) => [[0, 0, 0, 0], OPAQUE, TRANSLUCENT][(x + y) % 3]),
);
const LEGACY: SpriteData = LEGACY_BYTES.map((row) =>
  row.map((b) => (b[3] === 0 ? '' : b[3] === 255 ? hex(b[0], b[1], b[2]) : hex(...b))),
);
const ART: SpriteData = Array.from({ length: 64 }, (_, y) =>
  Array.from({ length: 32 }, (_, x) => LEGACY[Math.floor(y / 2)][Math.floor(x / 2)]),
);

describe('getCachedSprite', () => {
  it('makes a 64x128 canvas at zoom 4 and a 16x32 one at zoom 1 for 32x64 art', () => {
    const z4 = getCachedSprite(ART, 4);
    expect([z4.width, z4.height]).toEqual([64, 128]);
    const z1 = getCachedSprite(ART, 1);
    expect([z1.width, z1.height]).toEqual([16, 32]);
  });

  it('draws upscaled 1x art at zoom 1 as exactly its original pixels', () => {
    uploads.length = 0;
    getCachedSprite(
      ART.map((row) => [...row]),
      1,
    );
    const half = uploads.find((u) => u.width === 16)!;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        expect(Array.from(half.data.slice(i, i + 4)), `${x},${y}`).toEqual(LEGACY_BYTES[y][x]);
      }
    }
  });
});
