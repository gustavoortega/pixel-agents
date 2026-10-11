/**
 * Art density at the asset boundary: 1x files decode to the same art-density sprites as their 2x
 * twins, 2x sheets are sliced on the 2x grid, and a furniture PNG at neither density is refused by
 * name. Fixtures are PNGs built here, so each court reads real decoder output from real bytes.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { ART_DENSITY } from '../../core/src/assets/constants.js';
import {
  decodeCharacterPng,
  decodeFloorPng,
  decodeFurniturePng,
  parseWallPng,
} from '../../core/src/assets/pngDecoder.js';
import { loadFurnitureAssets } from '../src/assetLoader.js';

type Px = (x: number, y: number) => [number, number, number, number];

function png(width: number, height: number, px: Px): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = px(x, y);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  return PNG.sync.write(img);
}

/** Every pixel its own color, from its position: a slice taken from the wrong place shows up. */
const positional: Px = (x, y) => [x, y, 77, 255];
const hexOf = (x: number, y: number) =>
  `#${[x, y, 77].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** A deterministic sheet with clear, opaque and translucent pixels. */
const noisy: Px = (x, y) => {
  const h = (x * 73856093) ^ (y * 19349663);
  const a = [0, 255, 255, 128][h & 3];
  return [(h >>> 3) & 255, (h >>> 11) & 255, (h >>> 19) & 255, a];
};

describe('character sheets', () => {
  it('decode a 112x128 sheet byte-identical to its nearest-neighbour 224x256 twin', () => {
    // The twin is built here, pixel by pixel, not with the production upscaler.
    const legacy = png(112, 128, noisy);
    const twin = png(224, 256, (x, y) => noisy(Math.floor(x / 2), Math.floor(y / 2)));
    const fromLegacy = decodeCharacterPng(legacy);
    expect(fromLegacy).toEqual(decodeCharacterPng(twin));
    // 7 down frames + the 6-pose idle row (every cell of the fixture is drawn)
    expect(fromLegacy.down).toHaveLength(13);
    expect(fromLegacy.down[0]).toHaveLength(64);
    expect(fromLegacy.down[0][0]).toHaveLength(32);
  });

  it('ends the idle row at the last drawn pose, so a 4-pose sheet keeps the runtime fallbacks', () => {
    // Idle row (y 96..127) drawn only in its first four 16 px cells, as sheets were before the
    // nap-breathing and sip poses.
    const fourPoses = png(112, 128, (x, y) => (y >= 96 && x >= 64 ? [0, 0, 0, 0] : noisy(x, y)));
    expect(decodeCharacterPng(fourPoses).down).toHaveLength(7 + 4);
  });
});

describe('wall and floor slicing', () => {
  it('cuts wall piece (r, c) of a 128x256 sheet from the 32x64 block at (c*32, r*64)', () => {
    const pieces = parseWallPng(png(128, 256, positional));
    expect(pieces).toHaveLength(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const piece = pieces[r * 4 + c];
        expect(piece).toHaveLength(64);
        expect(piece[0]).toHaveLength(32);
        // corners and an inner pixel of the block
        for (const [x, y] of [
          [0, 0],
          [31, 63],
          [17, 40],
        ]) {
          expect(piece[y][x], `piece ${r},${c} at ${x},${y}`).toBe(hexOf(c * 32 + x, r * 64 + y));
        }
      }
    }
  });

  it('reads a 32x32 floor file as its whole block and a 16x16 one as its 2x upscale', () => {
    const hd = decodeFloorPng(png(32, 32, positional));
    expect(hd).toHaveLength(32);
    expect(hd[31][31]).toBe(hexOf(31, 31));
    expect(hd[20][9]).toBe(hexOf(9, 20));

    const legacy = decodeFloorPng(png(16, 16, positional));
    expect(legacy).toHaveLength(32);
    expect(legacy[31][31]).toBe(hexOf(15, 15));
    expect(legacy[20][9]).toBe(hexOf(4, 10));
  });
});

describe('furniture dims check', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  /** An assets root with one 2x1-tile item whose manifest says 32x16 world px. */
  function rootWith(id: string, pngW: number, pngH: number): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-density-'));
    roots.push(root);
    const dir = path.join(root, 'assets', 'furniture', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id,
        name: id,
        category: 'decor',
        type: 'asset',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        canPlaceOnWalls: false,
        canPlaceOnSurfaces: false,
        backgroundTiles: 0,
      }),
    );
    fs.writeFileSync(path.join(dir, `${id}.png`), png(pngW, pngH, positional));
    return root;
  }

  it('loads a PNG at 1x or 2x of the world size as art-density sprites', async () => {
    for (const [w, h] of [
      [32, 16],
      [64, 32],
    ]) {
      const loaded = await loadFurnitureAssets(rootWith('SHELF', w, h));
      const sprite = loaded?.sprites.get('SHELF');
      expect(sprite, `${w}x${h}`).toHaveLength(16 * ART_DENSITY);
      expect(sprite?.[0]).toHaveLength(32 * ART_DENSITY);
    }
  });

  it('refuses a PNG at neither size, naming the item', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loaded = await loadFurnitureAssets(rootWith('ODD_SHELF', 48, 24));
      expect(loaded?.sprites.has('ODD_SHELF')).toBe(false);
      expect(warn.mock.calls.flat().join(' ')).toContain('ODD_SHELF');
      // The decoder's own error names it too: the Vite plugin and browserMock log only that.
      expect(() => decodeFurniturePng(png(48, 24, positional), 'ODD_SHELF', 32, 16)).toThrow(
        /ODD_SHELF/,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
