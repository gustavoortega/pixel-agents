/**
 * The hero's companion sits on the hero's OWN desk. In a layout v8 pod the opposite desk's PC is
 * the first monitor along the seat's facing line, so a line-of-sight search put the owl on the
 * wrong desk; the seat's own PC and its desk cells decide it now.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { TILE_SIZE } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const COLS = 8;
const ROWS = 12;
const c = 1;
const r = 3;

/** Layout v8 pod: desk A rows r+1..r+2 (cols c..c+2) with the face-on seat and its PC_BACK,
 *  desk B rows r+3..r+4 with PC_FRONT_OFF and the back-view seat below. */
const pod: PlacedFurniture[] = [
  { uid: 'da', type: 'DESK_FRONT', col: c, row: r + 1 },
  { uid: 'ca', type: 'CUSHIONED_CHAIR_FRONT', col: c + 1, row: r + 1 },
  { uid: 'pa', type: 'PC_BACK', col: c + 2, row: r + 1 },
  { uid: 'db', type: 'DESK_FRONT', col: c, row: r + 3 },
  { uid: 'pb', type: 'PC_FRONT_OFF', col: c + 1, row: r + 3 },
  { uid: 'cb', type: 'CUSHIONED_CHAIR_BACK', col: c + 1, row: r + 5 },
];

describe('hero companion in a face-to-face pod', () => {
  it('sits on the hero desk, off the seat line, never on the opposite desk', () => {
    const os = new OfficeState({
      version: 1,
      cols: COLS,
      rows: ROWS,
      tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
      furniture: pod,
    } as OfficeLayout);
    os.addAgent(1, 0, 0, 'ca', true, undefined, undefined, true);
    os.setAgentModel(1, 'm', 3);
    os.update(0.016);

    const comp = os.companions.get(1)!;
    expect(comp.visible).toBe(true);
    const col = Math.floor(comp.x / TILE_SIZE);
    const row = Math.floor(comp.y / TILE_SIZE);
    // desk A, not desk B (rows r+3..r+4)
    expect(col).toBeGreaterThanOrEqual(c);
    expect(col).toBeLessThanOrEqual(c + 2);
    expect(row).toBeGreaterThanOrEqual(r + 1);
    expect(row).toBeLessThanOrEqual(r + 2);
    // not on the seat's own column, which is right in front of the agent
    expect(col).not.toBe(c + 1);
    expect(comp.deskZY).not.toBeNull();
  });
});
