/**
 * The office a fresh install opens: the bundled default layout, read through the real loader.
 * It must stay at revision 1 (a higher revision resets every user layout with a lower one to the
 * bundled default) and carry generic room names, never the maintainer's own.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { loadDefaultLayout } from '../src/assetLoader.js';

const PUBLIC = path.join(__dirname, '..', '..', 'webview-ui', 'public');

/** Every asset id the furniture manifests declare, nested groups included. */
function furnitureIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.type === 'asset' && typeof rec.id === 'string') ids.add(rec.id);
    if (Array.isArray(rec.members)) rec.members.forEach(walk);
  };
  const dir = path.join(PUBLIC, 'assets', 'furniture');
  for (const item of fs.readdirSync(dir)) {
    const manifest = path.join(dir, item, 'manifest.json');
    if (fs.existsSync(manifest)) walk(JSON.parse(fs.readFileSync(manifest, 'utf-8')));
  }
  return ids;
}

describe('bundled default layout', () => {
  const layout = loadDefaultLayout(PUBLIC) as {
    layoutRevision: number;
    areas: Array<{ label: string }>;
    furniture: Array<{ type: string }>;
  } | null;

  it('loads at revision 1, so it never overwrites a layout someone already has', () => {
    expect(layout).not.toBeNull();
    expect(layout!.layoutRevision).toBe(1);
  });

  it('names its rooms generically', () => {
    expect(layout!.areas.map((a) => a.label)).toEqual(['Studio', 'Lab', 'Den']);
    const raw = JSON.stringify(layout);
    for (const own of ['Tiendanube', '"dv"', '"personal"']) expect(raw).not.toContain(own);
  });

  it('only places furniture the bundled catalog has', () => {
    const ids = furnitureIds();
    // ':left' marks a mirrored placement of the same asset
    const missing = layout!.furniture.map((f) => f.type.split(':')[0]).filter((t) => !ids.has(t));
    expect(missing).toEqual([]);
  });
});
