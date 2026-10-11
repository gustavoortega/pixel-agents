/**
 * Regenerates the cozy art pack from the pixel maps in scripts/cozy-art.
 *
 *   npm run cozy:assets              write into the repository
 *   npm run cozy:assets -- --out D   write into directory D (same layout, D is the repo root)
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildAssets } from './cozy-art/generate';

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const root = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(__dirname, '..');
  const files = buildAssets();
  for (const [rel, bytes] of files) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  console.log(`cozy:assets wrote ${files.size} files under ${root}`);
}

main();
