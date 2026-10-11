import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

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

  it('writes char_0..5 as 112x96 sheets whose 21 frames all decode non-empty', () => {
    for (let i = 0; i < 6; i++) {
      const buf = fs.readFileSync(path.join(runA, `webview-ui/public/assets/characters/char_${i}.png`));
      const png = PNG.sync.read(buf);
      expect([png.width, png.height], `char_${i} size`).toEqual([112, 96]);
      const sheet = decodeCharacterPng(buf);
      for (const dir of ['down', 'up', 'right'] as const) {
        expect(sheet[dir]).toHaveLength(7);
        sheet[dir].forEach((frame, f) => {
          expect(frame).toHaveLength(32);
          expect(frame[0]).toHaveLength(16);
          const opaque = frame.flat().filter((px) => px !== '').length;
          expect(opaque, `char_${i} ${dir} frame ${f}`).toBeGreaterThan(40);
        });
      }
    }
  });

  it('anchors.json head rows match the generated frames', () => {
    const anchors = JSON.parse(
      fs.readFileSync(path.join(runA, 'webview-ui/src/office/sprites/flair/anchors.json'), 'utf8'),
    ) as Record<string, { headTopY: number; shoulderY: number; bob: number[] }>;
    const sheet = decodeCharacterPng(
      fs.readFileSync(path.join(runA, 'webview-ui/public/assets/characters/char_0.png')),
    );
    for (const dir of ['down', 'up', 'right'] as const) {
      const a = anchors[dir];
      expect(a.bob).toHaveLength(7);
      sheet[dir].forEach((frame, f) => {
        const top = frame.findIndex((row) => row.some((px) => px !== ''));
        expect(top, `${dir} frame ${f}`).toBe(a.headTopY + a.bob[f]);
      });
      expect(a.shoulderY).toBeGreaterThan(a.headTopY);
    }
  });
});
