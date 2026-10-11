import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

import { ART_DENSITY, CHAR_FRAME_H, CHAR_FRAME_W } from '../../core/src/assets/constants.js';
import { decodeCharacterPng } from '../../core/src/assets/pngDecoder.js';
import { EYE_COLORS, HUE_LOCKED, SKIN_RAMPS } from '../../core/src/assets/skinTones.js';
import { CHAR_LOOKS, paletteFor } from '../../scripts/cozy-art/characters.js';
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

  it('writes char_0..11 as 224x256 HD sheets whose 27 frames (21 + the 6-frame idle row) all hold a figure', () => {
    for (let i = 0; i < 12; i++) {
      const buf = fs.readFileSync(
        path.join(runA, `webview-ui/public/assets/characters/char_${i}.png`),
      );
      const png = PNG.sync.read(buf);
      // Density 2: twice the 112x128 legacy sheet.
      expect([png.width, png.height], `char_${i} size`).toEqual([224, 256]);
      // Nothing semi-transparent: the engine draws the shadow, the sheet never bakes one.
      const alphas = new Set<number>();
      for (let k = 3; k < png.data.length; k += 4) alphas.add(png.data[k]);
      expect(
        [...alphas].sort((a, b) => a - b),
        `char_${i} alpha levels`,
      ).toEqual([0, 255]);
      const sheet = decodeCharacterPng(buf);
      for (const dir of ['down', 'up', 'right'] as const) {
        expect(sheet[dir]).toHaveLength(dir === 'down' ? 13 : 7);
        sheet[dir].forEach((frame, f) => {
          // Decoded frames are art px, read straight off the 2x sheet.
          expect(frame).toHaveLength(CHAR_FRAME_H * ART_DENSITY);
          expect(frame[0]).toHaveLength(CHAR_FRAME_W * ART_DENSITY);
          const opaque = frame.flat().filter((px) => px !== '').length;
          expect(opaque, `char_${i} ${dir} frame ${f}`).toBeGreaterThan(400);
        });
      }
    }
  });

  it("paints skin only from sheet n's tone (n mod 5) and keeps every other color out of the hue lock", () => {
    // The runtime skips HUE_LOCKED pixels when it hue-shifts a repeated palette: a skin pixel outside
    // the set would turn green, an outfit pixel inside it would never shift.
    const looks = new Set<string>();
    for (let n = 0; n < 12; n++) {
      const tone = SKIN_RAMPS[n % 5];
      const allowed = new Set([...Object.values(tone), ...Object.values(EYE_COLORS)]);
      const sheet = decodeCharacterPng(
        fs.readFileSync(path.join(runA, `webview-ui/public/assets/characters/char_${n}.png`)),
      );
      const colors = new Set(
        [...sheet.down, ...sheet.up, ...sheet.right].flatMap((f) => f.flat()).filter((px) => px),
      );
      expect(colors.has(tone.base), `char_${n} wears tone ${tone.base}`).toBe(true);
      for (const c of colors) {
        if (HUE_LOCKED.has(c)) expect(allowed.has(c), `char_${n} locked color ${c}`).toBe(true);
      }
      // Palette entries the frames may not use yet obey the same rule.
      const locked = Object.values(paletteFor(CHAR_LOOKS[n]))
        .map((c) => c.toUpperCase())
        .filter((c) => HUE_LOCKED.has(c));
      expect(new Set(locked), `char_${n} palette`).toEqual(allowed);
      // One palette key per locked color: an outfit or hair key equal to this tone's skin also fails.
      expect(locked, `char_${n} palette keys on locked colors`).toHaveLength(allowed.size);
      // Hair and outfit are the sheet's non-skin, non-shared colors: the whole palette identifies the look.
      looks.add([...colors].sort().join());
    }
    expect(looks.size, 'every sheet has its own palette').toBe(12);
  });

  it('bakes the baseboard color into exactly the six art rows above the wall outline', () => {
    const png = PNG.sync.read(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/walls/wall_0.png')),
    );
    const BASEBOARD = [0x6b, 0x41, 0x28];
    const rowsWithColor = new Set<number>();
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (BASEBOARD.every((v, k) => png.data[i + k] === v)) rowsWithColor.add(y % 64);
      }
    }
    const rows = [56, 57, 58, 59, 60, 61];
    expect([...rowsWithColor].sort((a, b) => a - b)).toEqual(rows);
    // The isolated-wall piece (mask 0, top-left cell) has a plain face: its inner pixels carry it.
    for (const y of rows) {
      const i = (y * png.width + 16) * 4;
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

  it('anchors.json gives the head and shoulder rows of every frame in world px', () => {
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
      // Same landmarks as the 1x sheet, in world px: the engine's offsets keep lining up.
      expect([a.headTopY, a.shoulderY], dir).toEqual([3, 15]);
    }
  });

  it('resolves every flair pixel key in its palette, tier variants included', () => {
    const dir = path.join(runA, 'webview-ui/src/office/sprites/flair');
    const maps: Array<[string, string[][], Record<string, string>]> = [];
    for (const name of fs.readdirSync(dir).filter((f) => f !== 'anchors.json')) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const pals = [
        j.palette,
        ...Object.values(j.variants ?? {}),
        ...(j.book ? [...j.book.covers, ...j.mug.bodies] : []),
      ].map((v) => ({
        ...j.palette,
        ...(v as Record<string, string>),
      }));
      const all: string[][][] = [
        ...Object.values(j.directions ?? {}).map((d) => (d as { pixels: string[][] }).pixels),
        ...(j.frames ? [...j.frames.idle, ...j.frames.move] : []),
        ...(j.book ? [j.book.a, j.book.b, j.mug.pixels, ...j.steam.frames] : []),
        ...(j.pixels ? [j.pixels] : []),
        ...(j.small ? [j.small, j.large] : []),
      ];
      expect(all.length, name).toBeGreaterThan(0);
      for (const px of all) for (const pal of pals) maps.push([name, px, pal]);
    }
    for (const [name, px, pal] of maps) {
      const missing = new Set(px.flat().filter((k) => !(k in pal)));
      expect([...missing], name).toEqual([]);
    }
  });

  describe('idle props read at a glance', () => {
    const props = JSON.parse(
      fs.readFileSync(
        path.join(runA, 'webview-ui/src/office/sprites/flair/idle-props.json'),
        'utf8',
      ),
    );
    const resolve = (px: string[][]) => px.map((row) => row.map((k) => props.palette[k] ?? ''));
    const isGray = (c: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      return Math.max(r, g, b) - Math.min(r, g, b) < 24 && r < 200;
    };
    const isCream = (c: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      return r > 230 && g > 215 && b > 180 && r >= b;
    };

    it.each(['a', 'b'])(
      'book %s shows at least two gray text lines on cream on each page',
      (page) => {
        const px = resolve(props.book[page]);
        const half = px[0].length / 2;
        for (const [from, to] of [
          [0, half],
          [half, px[0].length],
        ]) {
          const lines = px.filter((row) => {
            const cells = row.slice(from, to);
            return cells.some(
              (c, x) =>
                c && isGray(c) && isCream(cells[x - 1] ?? '') && cells.slice(x).some(isCream),
            );
          });
          expect(lines.length, `book ${page} page ${from}..${to}`).toBeGreaterThanOrEqual(2);
        }
      },
    );

    it('mug has a handle column outside the body', () => {
      const px = resolve(props.mug.pixels);
      const lastOpaque = (row: string[]) => row.reduce((m, c, x) => (c ? x : m), -1);
      const bodyRight = Math.max(...px.slice(0, 3).map(lastOpaque)); // the rim spans the body only
      const handleRight = Math.max(...px.map(lastOpaque));
      expect(handleRight, 'handle sticks out past the rim').toBeGreaterThan(bodyRight + 1);
      // and a gap (the hole of the handle) between body and handle on some row
      expect(px.some((row) => row[bodyRight + 1] === '' && row[handleRight] !== '')).toBe(true);
    });
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
    ['FLOOR_LAMP', 'decor', false, 1, 16, 32],
    ['FAIRY_LIGHTS', 'wall', true, 0, 64, 16],
  ])(
    'ships %s with a manifest in world px and a density 2 PNG',
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
      expect([png.width, png.height]).toEqual([w * 2, h * 2]);
      let opaque = 0;
      for (let i = 3; i < png.data.length; i += 4) {
        if (png.data[i] > 0) opaque++;
      }
      expect(opaque, `${id} is not blank`).toBeGreaterThan(40);
    },
  );

  it('ships WINDOW as a wall-placed day/night pair whose night frame alone shows the night sky', () => {
    const dir = 'webview-ui/public/assets/furniture/WINDOW';
    // A day/night state pair that still places like a wall item.
    expect(
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, dir, 'manifest.json'), 'utf8')),
    ).toMatchObject({
      id: 'WINDOW',
      category: 'wall',
      type: 'group',
      groupType: 'state',
      canPlaceOnWalls: true,
      canPlaceOnSurfaces: false,
      backgroundTiles: 0,
    });
    // The night sky color, counted per frame: the runtime swap must change what the glass shows.
    const NIGHT_SKY = [0x1f, 0x2a, 0x4a];
    const skyPixels = (file: string): number => {
      const png = PNG.sync.read(fs.readFileSync(path.join(runA, dir, file)));
      expect([png.width, png.height], file).toEqual([64, 64]);
      let n = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        if (NIGHT_SKY.every((v, k) => png.data[i + k] === v)) n++;
      }
      return n;
    };
    expect(skyPixels('WINDOW.png')).toBe(0);
    expect(skyPixels('WINDOW_NIGHT.png')).toBeGreaterThan(400);
  });

  it('ships every environment PNG at density 2 and generates all of them', () => {
    // Furniture manifests stay in world px; the art is twice that. Tiles and pets have
    // fixed legacy sizes the engine detects density from.
    const assets = path.join(REPO_ROOT, 'webview-ui/public/assets');
    const generated = new Set(rels);
    const size = (rel: string): number[] => {
      const png = PNG.sync.read(fs.readFileSync(path.join(REPO_ROOT, rel)));
      return [png.width, png.height];
    };
    type Member = { file?: string; width?: number; height?: number; members?: Member[] };
    const furnitureDir = path.join(assets, 'furniture');
    const members = new Set<string>();
    for (const id of fs.readdirSync(furnitureDir)) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(furnitureDir, id, 'manifest.json'), 'utf8'),
      ) as Member & { id: string; density?: number };
      expect(manifest.density, `${id} density`).toBe(2);
      const walk = (m: Member, fallbackFile?: string): void => {
        if (m.members) {
          m.members.forEach((child) => walk(child));
          return;
        }
        const rel = `webview-ui/public/assets/furniture/${id}/${m.file ?? fallbackFile}`;
        expect(generated.has(rel), `${rel} is generated`).toBe(true);
        expect(size(rel), rel).toEqual([m.width! * 2, m.height! * 2]);
        members.add(rel);
      };
      walk(manifest, `${manifest.id}.png`);
    }
    // No shipped furniture PNG escapes the check by missing from its manifest.
    const onDisk = (fs.readdirSync(furnitureDir, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.png'))
      .map((f) => `webview-ui/public/assets/furniture/${f.split(path.sep).join('/')}`);
    expect([...members].sort()).toEqual(onDisk.sort());
    const fixed: Array<[RegExp, number[]]> = [
      [/^floors\/floor_\d+\.png$/, [32, 32]],
      [/^walls\/wall_\d+\.png$/, [128, 256]],
      [/^carpets\/carpet_\d+\.png$/, [128, 128]],
      [/^pets\/[^/]+\/pet\.png$/, [192, 192]],
    ];
    for (const dir of ['floors', 'walls', 'carpets', 'pets']) {
      const files = fs.readdirSync(path.join(assets, dir), { recursive: true }) as string[];
      for (const f of files.filter((name) => name.endsWith('.png'))) {
        const rel = `${dir}/${f.split(path.sep).join('/')}`;
        const full = `webview-ui/public/assets/${rel}`;
        expect(generated.has(full), `${full} is generated`).toBe(true);
        expect(size(full), full).toEqual(fixed.find(([re]) => re.test(rel))![1]);
      }
    }
  });
});
