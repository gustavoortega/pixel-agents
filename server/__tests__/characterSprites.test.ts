import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { loadCharacterSprites } from '../src/assetLoader.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHAR_DIR = path.join(REPO_ROOT, 'webview-ui', 'public', 'assets', 'characters');
const tmpDirs: string[] = [];

/** An assets root holding only the listed bundled sheets, copied under their own index. */
function rootWith(indices: number[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'char-sprites-'));
  tmpDirs.push(root);
  const dir = path.join(root, 'assets', 'characters');
  fs.mkdirSync(dir, { recursive: true });
  for (const i of indices) {
    fs.copyFileSync(path.join(CHAR_DIR, `char_${i}.png`), path.join(dir, `char_${i}.png`));
  }
  return root;
}

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('loadCharacterSprites', () => {
  it('loads every bundled sheet, char_0 through char_11', async () => {
    const loaded = await loadCharacterSprites(path.join(REPO_ROOT, 'webview-ui', 'public'));
    expect(loaded?.characters).toHaveLength(12);
  });

  it('stops at the first gap in the numbering', async () => {
    const loaded = await loadCharacterSprites(rootWith([0, 1, 3]));
    expect(loaded?.characters).toHaveLength(2);
  });

  it('returns null when char_0 is missing', async () => {
    expect(await loadCharacterSprites(rootWith([1, 2]))).toBeNull();
  });
});
