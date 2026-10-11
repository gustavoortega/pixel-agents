/**
 * Tests for the `migrateLayoutColors` migration path (which wraps
 * the internal `migrateLayout` function — the only public migration entrypoint).
 *
 * Focused on the pet-system extension: legacy layouts (no `pets` field)
 * must be migrated to include `pets: []`. Layouts with existing `pets`
 * must preserve them unchanged.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import * as path from 'path';
import { beforeAll, describe, test } from 'vitest';

import { buildFurnitureCatalog } from '../../core/src/assets/build.js';
import { ART_DENSITY } from '../../core/src/assets/constants.js';
import type { ColorValue } from '../src/components/ui/types.js';
import { TILE_SIZE } from '../src/constants.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import {
  layoutToFurnitureInstances,
  migrateLayoutColors,
} from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout, PlacedFurniture, PlacedPet } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

// ── Helpers ────────────────────────────────────────────────────

function baseLayout(overrides: Partial<OfficeLayout> = {}): OfficeLayout {
  // 4×3 minimum layout. layoutRevision = 1 to skip the OLD_VOID branch and
  // tileColors length-match to skip the tileColors-generation early return.
  const cols = 4;
  const rows = 3;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  const tileColors: Array<ColorValue | null> = new Array(cols * rows).fill(null);
  return {
    version: 1,
    cols,
    rows,
    tiles,
    furniture: [],
    tileColors,
    layoutRevision: 1,
    ...overrides,
  };
}

// ── Migration: pets field absent ──────────────────────────────

test('migrateLayoutColors injects pets:[] when missing on a fresh layout', () => {
  const layout = baseLayout();
  // Sanity precondition: no pets field on the input.
  assert.equal(layout.pets, undefined);
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, []);
});

test('migrateLayoutColors injects pets:[] even when tileColors triggers the early-return path', () => {
  // tileColors already populated with the right length → early-return guard fires.
  // The pets-default block must run BEFORE that early return.
  const layout = baseLayout(); // already has matching tileColors
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, []);
});

test('migrateLayoutColors handles pets: null (corrupted JSON) by defaulting to []', () => {
  const layout = baseLayout({ pets: null as unknown as PlacedPet[] | undefined });
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, []);
});

// ── Migration: pets preserved ─────────────────────────────────

test('migrateLayoutColors preserves an existing non-empty pets array', () => {
  const pets: PlacedPet[] = [
    { id: 'pet-1', petType: 0 },
    { id: 'pet-2', petType: 1 },
  ];
  const layout = baseLayout({ pets });
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, pets);
});

test('migrateLayoutColors preserves an empty pets array (does not overwrite)', () => {
  const layout = baseLayout({ pets: [] });
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, []);
});

// ── Migration: pets + tileColors regeneration interaction ─────

test('migrateLayoutColors injects pets:[] AND regenerates tileColors when missing', () => {
  // Force the tileColors path by stripping tileColors entirely.
  const layout: OfficeLayout = {
    version: 1,
    cols: 4,
    rows: 3,
    tiles: new Array(12).fill(TileType.FLOOR_1),
    furniture: [],
    layoutRevision: 1,
  };
  const migrated = migrateLayoutColors(layout);
  assert.deepEqual(migrated.pets, []);
  assert.ok(Array.isArray(migrated.tileColors));
  assert.equal(migrated.tileColors!.length, 12);
});

// ── Migration: OLD_VOID + pets interaction ────────────────────

test('migrateLayoutColors handles OLD_VOID tile migration AND pets:[] injection together', () => {
  // Mark as legacy: no layoutRevision, contains OLD_VOID=8.
  const cols = 4;
  const rows = 3;
  const tiles: number[] = new Array(cols * rows).fill(TileType.FLOOR_1);
  tiles[0] = 8; // OLD_VOID literal
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture: [],
  };
  const migrated = migrateLayoutColors(layout);
  assert.equal(migrated.tiles[0], TileType.VOID);
  assert.deepEqual(migrated.pets, []);
});

// ── Migration: returned layout retains other fields ───────────

test('migrateLayoutColors preserves furniture and other fields untouched', () => {
  const furniture: PlacedFurniture[] = [{ uid: 'f-1', type: 'desk_basic', col: 1, row: 1 }];
  const layout = baseLayout({ furniture, pets: [{ id: 'p1', petType: 0 }] });
  const migrated = migrateLayoutColors(layout);
  assert.equal(migrated.furniture.length, 1);
  // The migrator may rewrite furniture types, so compare uid/col/row, not the
  // raw type string.
  assert.equal(migrated.furniture[0].uid, 'f-1');
  assert.equal(migrated.furniture[0].col, 1);
  assert.equal(migrated.furniture[0].row, 1);
  assert.deepEqual(migrated.pets, [{ id: 'p1', petType: 0 }]);
  assert.equal(migrated.cols, 4);
  assert.equal(migrated.rows, 3);
  assert.equal(migrated.version, 1);
});

// ── Migration: idempotency ────────────────────────────────────

test('migrateLayoutColors is idempotent (running twice produces equivalent output)', () => {
  const layout = baseLayout();
  const once = migrateLayoutColors(layout);
  const twice = migrateLayoutColors(once);
  assert.deepEqual(twice.pets, once.pets);
  assert.deepEqual(twice.tiles, once.tiles);
  assert.deepEqual(twice.tileColors, once.tileColors);
});

// ── World size of art-density sprites ─────────────────────────

describe('furniture world size', () => {
  beforeAll(loadRealAssets);

  test('a 2x1-tile bookshelf sorts at the bottom of its footprint, not of its art', () => {
    // Its sprite is 64x32 art px at ART_DENSITY 2; in the world it is footprint * 16 = 32x16.
    const [shelf] = layoutToFurnitureInstances([{ uid: 'b', type: 'BOOKSHELF', col: 3, row: 4 }]);
    assert.equal(shelf.zY, (4 + 1) * TILE_SIZE);
  });
});

// ── Couch slices ──────────────────────────────────────────────

describe('couch slices', () => {
  const ASSETS = path.resolve(__dirname, '..', 'public', 'assets');
  const ORIENTATIONS = ['SOFA_FRONT', 'SOFA_BACK', 'SOFA_SIDE', 'SOFA_SIDE:left'];

  /** Stack the slices back at their own y; every art row must come back exactly once. */
  function assertSlicesRebuild(type: string): void {
    const row = 3;
    const full = getCatalogEntry(type)!.sprite;
    const rows: Array<readonly string[] | undefined> = new Array(full.length);
    for (const part of layoutToFurnitureInstances([{ uid: 'c', type, col: 2, row }])) {
      const artTop = (part.y - row * TILE_SIZE) * ART_DENSITY;
      part.sprite.forEach((r, i) => {
        assert.equal(rows[artTop + i], undefined, `${type}: art row ${artTop + i} drawn twice`);
        rows[artTop + i] = r;
      });
    }
    assert.deepEqual(rows, full, `${type}: every art row exactly once`);
  }

  test('rebuild the whole sprite for every orientation, from the bundled 1x art (upscaled)', () => {
    loadRealAssets();
    for (const type of ORIENTATIONS) assertSlicesRebuild(type);
  });

  test('rebuild the whole sprite for every orientation, from 2x art with every row distinct', () => {
    // Upscaled art repeats each row twice, which can hide an off-by-one-art-row cut; here no two
    // art rows are alike.
    const catalog = buildFurnitureCatalog(ASSETS).filter((e) => e.groupId === 'SOFA');
    const sprites = Object.fromEntries(
      catalog.map((e, k) => [
        e.id,
        Array.from({ length: e.height * ART_DENSITY }, (_, y) =>
          Array.from({ length: e.width * ART_DENSITY }, (_, x) => `${k}:${x},${y}`),
        ),
      ]),
    );
    buildDynamicCatalog({ catalog, sprites });
    for (const type of ORIENTATIONS) assertSlicesRebuild(type);
  });
});
