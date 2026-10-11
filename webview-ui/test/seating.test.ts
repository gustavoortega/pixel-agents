/**
 * Seat z-order by geometry: a face-on agent sits behind its desk (chair < agent < desk), a back-view
 * agent behind its chair, a couch sitter between the two halves of the couch. The court composites
 * the real renderScene onto a recording context, replays its drawImage calls in order over the
 * real 2x art and reads the pixels, so it fails when what is on screen is wrong, not when a
 * sort key changes.
 *
 * Run with: npm test
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TILE_SIZE } from '../src/constants.js';
import { getCharacterSprite } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { renderScene } from '../src/office/engine/renderer.js';
import { characterDrawOrigin } from '../src/office/flair/accessories.js';
import { getCachedSprite } from '../src/office/sprites/spriteCache.js';
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

/** A pixel canvas: the fake DOM canvas the sprite cache builds, holding RGBA bytes. */
interface FakeCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  getContext: () => unknown;
}

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    data: new Uint8ClampedArray(0),
    getContext: () => {
      canvas.data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (img: { data: Uint8ClampedArray }) => canvas.data.set(img.data),
        // the cache only scales 1:1 at zoom 1: a plain copy
        drawImage: (src: FakeCanvas) => canvas.data.set(src.data),
        set imageSmoothingEnabled(_: boolean) {},
      };
    },
  };
  return canvas;
}

interface Blit {
  canvas: FakeCanvas;
  x: number;
  y: number;
}

/** A screen context that records every drawImage in call order. */
function screen(): { ctx: Parameters<typeof renderScene>[0]; blits: Blit[] } {
  const blits: Blit[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, prop: string) => {
      if (prop === 'drawImage') {
        return (canvas: FakeCanvas, x: number, y: number) => blits.push({ canvas, x, y });
      }
      // a mirrored sprite would be drawn through a transform this recorder does not apply
      if (prop === 'scale' || prop === 'translate') {
        return () => {
          throw new Error('seating fixtures are not mirrored');
        };
      }
      return prop in target ? target[prop] : () => undefined;
    },
    set: (target, prop: string, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as Parameters<typeof renderScene>[0];
  return { ctx, blits };
}

beforeAll(() => {
  // getCachedSprite builds its canvases through the DOM
  vi.stubGlobal('document', { createElement: fakeCanvas });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * The screen at zoom 1: the real renderScene draws the office, and each pixel remembers who
 * painted it last, in the order the renderer drew them.
 */
function composite(os: OfficeState, ch: Character): Array<Array<Label | null>> {
  const px: Array<Array<Label | null>> = Array.from({ length: ROWS * TILE_SIZE }, () =>
    new Array<Label | null>(COLS * TILE_SIZE).fill(null),
  );
  const labels = new Map<unknown, Label>();
  for (const f of os.furniture) labels.set(getCachedSprite(f.sprite, 1), 'furniture');
  const body = getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift, ch.isSubagent));
  labels.set(getCachedSprite(body, 1), 'char');

  const { ctx, blits } = screen();
  renderScene(ctx, os.furniture, [ch], 0, 0, 1, null, null);

  for (const { canvas, x, y } of blits) {
    const label = labels.get(canvas);
    if (!label) continue; // shadow and other layers are not part of this contract
    for (let i = 0; i < canvas.width * canvas.height; i++) {
      if (canvas.data[i * 4 + 3] < 128) continue;
      const row = px[y + Math.floor(i / canvas.width)];
      if (row?.[x + (i % canvas.width)] !== undefined) row[x + (i % canvas.width)] = label;
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
    // in front of the couch back: mid-body, inside the couch's own rows above the cut
    expect(px[cut - 2][2 * TILE_SIZE + 8], 'sitter over the couch back').toBe('char');
  });
});
