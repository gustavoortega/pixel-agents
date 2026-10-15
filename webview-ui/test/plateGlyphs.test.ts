/**
 * Every character the plates, the medal and the crew banner can print is in the bundled pixel
 * font (FS Pixel Sans has no ✓, ▪ or ⏎: a missing glyph falls back to another font and breaks the
 * pixel look). Read straight from the font's cmap, so the check needs no list kept by hand.
 *
 * Run with: npm run test:webview
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const FONT = path.join(__dirname, '../public/fonts/FSPixelSansUnicode-Regular.ttf');
const SOURCES = [
  'src/office/components/ToolOverlay.tsx',
  'src/office/components/CrewBanner.tsx',
  'src/office/components/Medal.tsx',
  'src/office/components/PixelIcons.tsx',
  'src/office/toolUtils.ts',
  'src/office/plateState.ts',
  'src/office/crewBanner.ts',
  'src/office/nameplate.ts',
].map((f) => path.join(__dirname, '..', f));
/** Bidi isolates around a helper's label: formatting, never drawn. */
const FORMAT = new Set([0x2068, 0x2069]);

/** Code points the font maps (cmap formats 4 and 12). */
function fontCodePoints(file: string): Set<number> {
  const b = fs.readFileSync(file);
  const tables = b.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + 16 * i;
    if (b.toString('latin1', at, at + 4) === 'cmap') cmap = b.readUInt32BE(at + 8);
  }
  const out = new Set<number>();
  const subtables = b.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const st = cmap + b.readUInt32BE(cmap + 4 + 8 * i + 4);
    const format = b.readUInt16BE(st);
    if (format === 4) {
      const segs = b.readUInt16BE(st + 6) / 2;
      for (let s = 0; s < segs; s++) {
        const end = b.readUInt16BE(st + 14 + 2 * s);
        const start = b.readUInt16BE(st + 16 + 2 * segs + 2 * s);
        if (start !== 0xffff) for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(st + 12);
      for (let g = 0; g < groups; g++) {
        const start = b.readUInt32BE(st + 16 + 12 * g);
        const end = b.readUInt32BE(st + 20 + 12 * g);
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

/** The non-ASCII characters a source can print: its code without comments, escapes decoded. */
function printedCharacters(file: string): Set<number> {
  const code = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
  const out = new Set<number>();
  for (const ch of code) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x7e && !FORMAT.has(cp)) out.add(cp);
  }
  return out;
}

describe('plate glyphs', () => {
  const font = fontCodePoints(FONT);

  it('the font has the glyphs the plates rely on and lacks the ones they draw as pixels', () => {
    for (const ch of ['›', '·', '×', '↻', '…']) {
      expect(font.has(ch.codePointAt(0)!), ch).toBe(true);
    }
    expect(font.has(0x2713), 'no check mark: done is a pixel check').toBe(false);
  });

  it.each(SOURCES.map((f) => [path.basename(f), f]))(
    '%s prints only glyphs in the font',
    (_, f) => {
      const missing = [...printedCharacters(f)].filter((cp) => !font.has(cp));
      expect(missing.map((cp) => `U+${cp.toString(16).toUpperCase()}`)).toEqual([]);
    },
  );
});
