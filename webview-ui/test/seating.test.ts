/**
 * Seat z-order by geometry: a face-on agent sits behind its desk (chair < agent < desk), a back-view
 * agent behind its chair, a couch sitter between the two halves of the couch. The court composites
 * the real furniture and character art in the renderer's order (ascending sort depth) and reads
 * the pixels, so it fails when what is on screen is wrong, not when a number changes.
 *
 * Run with: npm test
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { ART_DENSITY } from '../../core/src/assets/constants.js';
import { TILE_SIZE } from '../src/constants.js';
import { getCharacterSprite } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { characterDrawOrigin } from '../src/office/flair/accessories.js';
import { getCharacterSprites } from '../src/office/sprites/spriteData.js';
import type { Character, OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const COLS = 10;
const ROWS = 8;

function office(furniture: PlacedFurniture[]): OfficeState {
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
  } as OfficeLayout);
}

type Label = 'furniture' | 'char';

/** The screen at zoom 1: each pixel remembers who painted it last. */
function composite(os: OfficeState, ch: Character): Array<Array<Label | null>> {
  const px: Array<Array<Label | null>> = Array.from({ length: ROWS * TILE_SIZE }, () =>
    new Array<Label | null>(COLS * TILE_SIZE).fill(null),
  );
  const sprite = getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
  const { drawX, drawY } = characterDrawOrigin(ch, 16, 32, 0, 0, 1);
  const layers = [
    ...os.furniture.map((f) => ({
      zY: f.zY,
      sprite: f.sprite,
      x: f.x,
      y: f.y,
      label: 'furniture' as Label,
    })),
    // the renderer sorts a character at the bottom of its tile + 0.5
    { zY: ch.y + TILE_SIZE / 2 + 0.5, sprite, x: drawX, y: drawY, label: 'char' as Label },
  ].sort((a, b) => a.zY - b.zY);
  const solid = (p: string) => p !== '' && (p.length === 7 || parseInt(p.slice(7, 9), 16) >= 128);
  // Sprites are art px (ART_DENSITY per world px): one screen pixel per world px samples every
  // ART_DENSITY-th art pixel, which is exact for the upscaled 1x art.
  for (const l of layers) {
    for (let dy = 0; dy * ART_DENSITY < l.sprite.length; dy++) {
      const row = l.sprite[dy * ART_DENSITY];
      for (let dx = 0; dx * ART_DENSITY < row.length; dx++) {
        const p = row[dx * ART_DENSITY];
        if (solid(p) && px[l.y + dy]?.[l.x + dx] !== undefined) px[l.y + dy][l.x + dx] = l.label;
      }
    }
  }
  return px;
}

function seat(os: OfficeState, uid: string): Character {
  os.addAgent(1, 0, 0, uid, true, undefined, undefined, true);
  os.update(0.016); // sets the sink of the seat it sits in
  return os.characters.get(1)!;
}

/** The 16 pixel columns of the tile starting at x0. */
function column(x0: number): number[] {
  return Array.from({ length: TILE_SIZE }, (_, i) => x0 + i);
}

describe('face-on desk seat', () => {
  // Desk 3x2 at (2,2): its background row 2 holds the chair at (3,2), the seat.
  const furniture: PlacedFurniture[] = [
    { uid: 'desk', type: 'DESK_FRONT', col: 2, row: 2 },
    { uid: 'chair', type: 'CUSHIONED_CHAIR_FRONT', col: 3, row: 2 },
  ];

  it('hides the sprite behind the desk (bottom 12 px) and leaves the chair showing beside it', () => {
    const os = office(furniture);
    const ch = seat(os, 'chair');
    const px = composite(os, ch);
    const cols = column(3 * TILE_SIZE);
    const deskTop = 2 * TILE_SIZE + 11; // the desk art's first solid row
    // the sprite's frame bottom, at zoom 1, against the desk top: 12 px hidden
    const { drawY } = characterDrawOrigin(ch, 16, 32, 0, 0, 1);
    expect(drawY + 32 - deskTop).toBe(12);
    for (let y = deskTop; y < px.length; y++) {
      for (const x of cols)
        expect(px[y][x], `sprite pixel under the desk top at ${x},${y}`).not.toBe('char');
    }
    expect(
      cols.some((x) => px[deskTop - 1][x] === 'furniture'),
      'chair pixels at deskTop-1',
    ).toBe(true);
    // the agent's chest is in front of the chair back, not behind it
    expect(px[deskTop - 3][3 * TILE_SIZE + 8], 'agent over chair').toBe('char');
  });

  it('puts the agent back to its plain sitting height the moment it stands', () => {
    const os = office(furniture);
    const ch = seat(os, 'chair');
    expect(ch.drawSink).toBeGreaterThan(0);
    expect(os.walkToTile(1, 3, 5)).toBe(true);
    os.update(0.016);
    expect(ch.state).toBe('walk');
    expect(ch.drawSink).toBe(0);
  });
});

describe('back-view seat', () => {
  it('hides the feet behind the chair', () => {
    // Chair back at (3,4), facing up toward a desk above.
    const os = office([
      { uid: 'desk', type: 'DESK_FRONT', col: 2, row: 2 },
      { uid: 'chair', type: 'CUSHIONED_CHAIR_BACK', col: 3, row: 4 },
    ]);
    const ch = seat(os, 'chair');
    const px = composite(os, ch);
    // the middle of the chair back, where it is solid from its first row
    const cols = column(3 * TILE_SIZE).slice(3, 13);
    const chairTop = 4 * TILE_SIZE + 4; // the chair back's first solid row
    for (let y = chairTop; y < px.length; y++) {
      for (const x of cols)
        expect(px[y][x], `sprite pixel over the chair at ${x},${y}`).not.toBe('char');
    }
    expect(px.slice(0, chairTop).some((row) => cols.some((x) => row[x] === 'char'))).toBe(true);
  });
});

describe('couch seat', () => {
  it('sits the agent between the back of the couch and its front, which hides the bottom 10 px', () => {
    const os = office([{ uid: 'sofa', type: 'SOFA_FRONT', col: 2, row: 3 }]);
    const ch = seat(os, 'sofa');
    const px = composite(os, ch);
    const cols = column(2 * TILE_SIZE);
    const cut = 3 * TILE_SIZE + 4; // the couch front starts 4 px into its tile
    const { drawY } = characterDrawOrigin(ch, 16, 32, 0, 0, 1);
    expect(drawY + 32 - cut).toBe(10);
    for (let y = cut + 1; y < px.length; y++) {
      for (const x of cols)
        expect(px[y][x], `sprite pixel over the couch front at ${x},${y}`).not.toBe('char');
    }
    expect(px.slice(0, cut).some((row) => cols.some((x) => row[x] === 'char'))).toBe(true);
  });
});
