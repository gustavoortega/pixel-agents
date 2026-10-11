/**
 * One world -> device rule for the canvas and the DOM overlays: scale, then round once. A half
 * world px is one art px at ART_DENSITY 2, so rounding before scaling would move sprites and
 * their plates apart by up to half a world px.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { characterDrawOrigin } from '../src/office/flair/accessories.js';
import { overlayProjection } from '../src/office/projection.js';
import { CharacterState } from '../src/office/types.js';

describe('worldToDevice', () => {
  // 2x2 tiles at zoom 4 fill a 128x128 container exactly, so the map offset is 0.
  const layout = { cols: 2, rows: 2 };
  const zoom = 4;

  it('puts an entity at world x 10.5 on device x 42, sprite and plate alike', () => {
    const ch = { x: 10.5, y: 20, state: CharacterState.IDLE };
    const spriteW = 16 * zoom;
    const { drawX } = characterDrawOrigin(ch, spriteW, 32 * zoom, 0, 0, zoom);
    expect(drawX + spriteW / 2).toBe(42);

    const project = overlayProjection(layout, { width: 128, height: 128 }, zoom, { x: 0, y: 0 }, 1);
    expect(project.toScreenX(10.5)).toBe(42);
    // DOM px are device px over dpr
    const hiDpi = overlayProjection(layout, { width: 64, height: 64 }, zoom, { x: 0, y: 0 }, 2);
    expect(hiDpi.toScreenX(10.5)).toBe(21);
  });
});
