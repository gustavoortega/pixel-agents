/**
 * The rail's pixel art: the face crop of a character frame, and every glyph the monitor's
 * components print being one FS Pixel Sans draws (the font has × › – but no ✓ ▪ ⏎, which a
 * browser would fill from another font, breaking the pixel look).
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEAD_CROP_ROWS, HEAD_CROP_TOP, headCrop } from '../src/office/sprites/spriteCache.js';

describe('headCrop', () => {
  // A 32x64 frame whose every pixel names its own row, so the crop shows which rows it took.
  const frame = Array.from({ length: 64 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => (x === 0 || x === 31 ? '' : `#r${y}`)),
  );

  it('keeps the head rows (6..31), centred in a 32x32 square with clear rows around them', () => {
    const crop = headCrop(frame);
    expect(crop).toHaveLength(32);
    expect(crop.every((row) => row.length === 32)).toBe(true);
    const rows = crop.map((row) => row[1]);
    const pad = (32 - HEAD_CROP_ROWS) / 2;
    expect(rows.slice(0, pad).every((c) => c === '')).toBe(true);
    expect(rows.slice(pad, pad + HEAD_CROP_ROWS)).toEqual(
      Array.from({ length: HEAD_CROP_ROWS }, (_, i) => `#r${HEAD_CROP_TOP + i}`),
    );
    expect(rows.slice(pad + HEAD_CROP_ROWS).every((c) => c === '')).toBe(true);
    // Columns are untouched: transparent edges stay transparent.
    expect(crop[pad][0]).toBe('');
  });
});

/** Code points the font maps, read from its cmap (formats 4 and 12). */
function fontCodePoints(file: string): Set<number> {
  const b = fs.readFileSync(file);
  const tables = b.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + 16 * i;
    if (b.toString('ascii', at, at + 4) === 'cmap') cmap = b.readUInt32BE(at + 8);
  }
  if (cmap < 0) throw new Error('no cmap');
  const set = new Set<number>();
  const subtables = b.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const start = cmap + b.readUInt32BE(cmap + 4 + 8 * i + 4);
    const format = b.readUInt16BE(start);
    if (format === 4) {
      const segX2 = b.readUInt16BE(start + 6);
      const ends = start + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(ends + 2 * s);
        const first = b.readUInt16BE(starts + 2 * s);
        const delta = b.readInt16BE(deltas + 2 * s);
        const range = b.readUInt16BE(ranges + 2 * s);
        for (let c = first; c <= end && c !== 0xffff; c++) {
          let glyph =
            range === 0
              ? (c + delta) & 0xffff
              : b.readUInt16BE(ranges + 2 * s + range + 2 * (c - first));
          if (range !== 0 && glyph !== 0) glyph = (glyph + delta) & 0xffff;
          if (glyph !== 0) set.add(c);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(start + 12);
      for (let g = 0; g < groups; g++) {
        const at = start + 16 + 12 * g;
        const first = b.readUInt32BE(at);
        const end = b.readUInt32BE(at + 4);
        const glyph = b.readUInt32BE(at + 8);
        for (let c = first; c <= end; c++) if (glyph + (c - first) !== 0) set.add(c);
      }
    }
  }
  return set;
}

const SRC = path.join(__dirname, '../src/components');
/** The monitor's own components (W2 and W3 add theirs by the same names). */
const MONITOR_FILES = fs
  .readdirSync(SRC)
  .filter((f) => /^(Monitor|Pace|attention|railArt|limitsPace)/.test(f));

/** Every non-ASCII character a source prints, literal or written as a \u escape. Comments are
 *  not printed, so they are dropped first. */
function printedChars(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const escaped = [...code.matchAll(/\\u([0-9a-fA-F]{4})|\\u\{([0-9a-fA-F]+)\}/g)].map((m) =>
    String.fromCodePoint(parseInt(m[1] ?? m[2], 16)),
  );
  const literal = [...code].filter((c) => c.codePointAt(0)! > 0x7e);
  return [...new Set([...escaped, ...literal])];
}

describe('monitor glyphs', () => {
  const font = fontCodePoints(
    path.join(__dirname, '../public/fonts/FSPixelSansUnicode-Regular.ttf'),
  );

  it('reads the font: it has the separators the monitor uses and lacks the check mark', () => {
    expect(['×', '·', '–', '›'].every((c) => font.has(c.codePointAt(0)!))).toBe(true);
    expect(font.has('✓'.codePointAt(0)!)).toBe(false);
  });

  it.each(MONITOR_FILES)('%s prints only glyphs FS Pixel Sans has', (file) => {
    const missing = printedChars(fs.readFileSync(path.join(SRC, file), 'utf8')).filter(
      (c) => !font.has(c.codePointAt(0)!),
    );
    expect(missing).toEqual([]);
  });
});
