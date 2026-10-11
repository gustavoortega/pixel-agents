import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

import { ART_DENSITY, CHAR_FRAME_H, CHAR_FRAME_W } from '../../core/src/assets/constants.js';
import { decodeCharacterPng } from '../../core/src/assets/pngDecoder.js';
import { buildAssets } from '../../scripts/cozy-art/generate.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const tmpDirs: string[] = [];

/** Regenerate into a fresh temp dir the way `npm run cozy:assets -- --out` does. */
function regenerate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-assets-'));
  tmpDirs.push(dir);
  for (const [rel, bytes] of buildAssets()) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return dir;
}

afterAll(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('cozy art pack', () => {
  const runA = regenerate();
  const runB = regenerate();
  const rels = [...buildAssets().keys()];

  it('regenerates byte-identical files, twice, and matches the committed ones', () => {
    for (const rel of rels) {
      const a = fs.readFileSync(path.join(runA, rel));
      expect(a.equals(fs.readFileSync(path.join(runB, rel))), `${rel} differs between runs`).toBe(
        true,
      );
      expect(
        a.equals(fs.readFileSync(path.join(REPO_ROOT, rel))),
        `${rel} is stale: run npm run cozy:assets`,
      ).toBe(true);
    }
  });

  it('writes char_0..11 as 112x128 sheets whose 25 frames (21 + the 4-frame idle row) all decode non-empty', () => {
    for (let i = 0; i < 12; i++) {
      const buf = fs.readFileSync(
        path.join(runA, `webview-ui/public/assets/characters/char_${i}.png`),
      );
      const png = PNG.sync.read(buf);
      expect([png.width, png.height], `char_${i} size`).toEqual([112, 128]);
      const sheet = decodeCharacterPng(buf);
      for (const dir of ['down', 'up', 'right'] as const) {
        // The idle row is decoded as frames 7..10 of `down`.
        expect(sheet[dir]).toHaveLength(dir === 'down' ? 11 : 7);
        sheet[dir].forEach((frame, f) => {
          // Decoded frames are art px: the 1x sheet comes back upscaled to ART_DENSITY.
          expect(frame).toHaveLength(CHAR_FRAME_H * ART_DENSITY);
          expect(frame[0]).toHaveLength(CHAR_FRAME_W * ART_DENSITY);
          const opaque = frame.flat().filter((px) => px !== '').length;
          expect(opaque, `char_${i} ${dir} frame ${f}`).toBeGreaterThan(40);
        });
      }
    }
  });

  it('gives sheet n the skin tone n mod 5 and a distinct hair and outfit', () => {
    // The runtime never hue-shifts skin, so the ramp is fixed per sheet.
    const rgb = [
      [246, 217, 184],
      [242, 201, 160],
      [201, 141, 94],
      [141, 90, 59],
      [90, 58, 40],
    ];
    const ramp = rgb.map(
      (c) =>
        '#' +
        c
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
    );
    const looks = new Set<string>();
    for (let n = 0; n < 12; n++) {
      const sheet = decodeCharacterPng(
        fs.readFileSync(path.join(runA, `webview-ui/public/assets/characters/char_${n}.png`)),
      );
      const colors = new Set(sheet.down[1].flat().filter((px) => px !== ''));
      for (const [i, tone] of ramp.entries()) {
        expect(colors.has(tone), `char_${n} skin tone ${tone}`).toBe(i === n % 5);
      }
      // Hair and outfit are the sheet's non-skin, non-shared colors: the whole palette identifies the look.
      looks.add([...colors].sort().join());
    }
    expect(looks.size, 'every sheet has its own palette').toBe(12);
  });

  it('bakes the baseboard color into exactly the three rows above the wall outline', () => {
    const png = PNG.sync.read(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/walls/wall_0.png')),
    );
    const BASEBOARD = [0x6b, 0x41, 0x28];
    const rowsWithColor = new Set<number>();
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (BASEBOARD.every((v, k) => png.data[i + k] === v)) rowsWithColor.add(y % 32);
      }
    }
    expect([...rowsWithColor].sort((a, b) => a - b)).toEqual([28, 29, 30]);
    // The isolated-wall piece (mask 0, top-left cell) has a plain face: its inner pixels carry it.
    for (const y of [28, 29, 30]) {
      const i = (y * png.width + 8) * 4;
      expect(Array.from(png.data.slice(i, i + 3)), `row ${y}`).toEqual(BASEBOARD);
    }
  });

  it('draws carpet_0 as a plain rug: two gray levels and no loose accent dots', () => {
    const png = PNG.sync.read(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/carpets/carpet_0.png')),
    );
    const gray = new Map<number, number>(); // x,y -> level
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i + 3] > 0) gray.set(y * png.width + x, png.data[i]);
      }
    }
    const levels = [...new Set(gray.values())].sort((a, b) => a - b);
    expect(levels, 'main and accent only').toHaveLength(2);
    const accent = levels[1];
    let isolated = 0;
    for (const [k, v] of gray) {
      if (v !== accent) continue;
      const x = k % png.width;
      const y = Math.floor(k / png.width);
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && gray.get((y + dy) * png.width + x + dx) === accent) neighbours++;
        }
      }
      if (neighbours === 0) isolated++;
    }
    expect(isolated, 'accent pixels with no accent neighbour (weave dots)').toBe(0);
  });

  it('anchors.json head rows match the generated frames', () => {
    const anchors = JSON.parse(
      fs.readFileSync(path.join(runA, 'webview-ui/src/office/sprites/flair/anchors.json'), 'utf8'),
    ) as Record<
      string,
      { headTopY: number; shoulderY: number; bob: number[]; shoulderBob: number[] }
    >;
    const sheet = decodeCharacterPng(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/characters/char_0.png')),
    );
    for (const dir of ['down', 'up', 'right'] as const) {
      const a = anchors[dir];
      expect(a.bob).toHaveLength(sheet[dir].length);
      expect(a.shoulderBob).toHaveLength(sheet[dir].length);
      sheet[dir].forEach((frame, f) => {
        const top = frame.findIndex((row) => row.some((px) => px !== ''));
        // anchors are world px, frames art px
        expect(top / ART_DENSITY, `${dir} frame ${f}`).toBe(a.headTopY + a.bob[f]);
      });
      expect(a.shoulderY).toBeGreaterThan(a.headTopY);
    }
  });
  it('keeps floor_0 soft: luminance spread of at most 16 levels', () => {
    // The floor is colorized at runtime from its luminance, so the spread IS the contrast.
    const png = PNG.sync.read(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/floors/floor_0.png')),
    );
    const levels = new Set<number>();
    for (let i = 0; i < png.data.length; i += 4) {
      levels.add(png.data[i]);
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(16);
  });

  it.each([
    ['WINDOW', 'wall', true, 0, 32, 32],
    ['FLOOR_LAMP', 'decor', false, 1, 16, 32],
    ['FAIRY_LIGHTS', 'wall', true, 0, 64, 16],
  ])(
    'ships %s with a manifest that matches its generated PNG',
    (id, category, onWalls, bg, w, h) => {
      const dir = `webview-ui/public/assets/furniture/${id}`;
      const manifest = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, dir, 'manifest.json'), 'utf8'),
      );
      expect(manifest).toMatchObject({
        id,
        category,
        type: 'asset',
        canPlaceOnWalls: onWalls,
        canPlaceOnSurfaces: false,
        backgroundTiles: bg,
        width: w,
        height: h,
        footprintW: w / 16,
        footprintH: h / 16,
      });
      const png = PNG.sync.read(fs.readFileSync(path.join(runA, dir, `${id}.png`)));
      expect([png.width, png.height]).toEqual([w, h]);
      let opaque = 0;
      for (let i = 3; i < png.data.length; i += 4) {
        if (png.data[i] > 0) opaque++;
      }
      expect(opaque, `${id} is not blank`).toBeGreaterThan(40);
    },
  );
});
