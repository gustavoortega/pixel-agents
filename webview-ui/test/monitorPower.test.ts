/**
 * A PC turns on for the agent at its own seat and only while that agent is working. In a
 * face-to-face pod the seat used to light the opposite desk's PC too.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import {
  getAnimationFrames,
  getCatalogEntry,
  getOnStateType,
} from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const COLS = 14;
const ROWS = 12;

/** Layout v7 pods at c=1 and c=5, r=3, as in the live layout. */
function pod(c: number, r: number): PlacedFurniture[] {
  return [
    { uid: `da${c}`, type: 'DESK_FRONT', col: c, row: r + 1 },
    { uid: `ca${c}`, type: 'CUSHIONED_CHAIR_FRONT', col: c + 1, row: r + 1 },
    { uid: `pa${c}`, type: 'PC_BACK', col: c + 2, row: r + 1 },
    { uid: `db${c}`, type: 'DESK_FRONT', col: c, row: r + 3 },
    { uid: `pb${c}`, type: 'PC_FRONT_OFF', col: c + 1, row: r + 3 },
    { uid: `cb${c}`, type: 'CUSHIONED_CHAIR_BACK', col: c + 1, row: r + 5 },
  ];
}

function office(): OfficeState {
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [...pod(1, 3), ...pod(5, 3)],
  } as OfficeLayout);
}

/** Screens showing: PC_FRONT instances drawn with one of the ON frames. */
function litScreens(os: OfficeState): number {
  const on = new Set(
    (getAnimationFrames(getOnStateType('PC_FRONT_OFF')) ?? []).map(
      (t) => getCatalogEntry(t)!.sprite,
    ),
  );
  return os.furniture.filter((f) => on.has(f.sprite)).length;
}

describe('PC power', () => {
  it('one active agent at the back-view seat lights exactly its own PC, not the neighbour pod', () => {
    const os = office();
    os.addAgent(1, 0, 0, 'cb1', true, undefined, undefined, true);
    os.setAgentActive(1, true);
    os.update(0.016);
    expect(litScreens(os)).toBe(1);
  });

  it('an active agent at the face-on seat does not light the opposite desk PC', () => {
    const os = office();
    os.addAgent(1, 0, 0, 'ca1', true, undefined, undefined, true);
    os.setAgentActive(1, true);
    os.update(0.016);
    expect(litScreens(os)).toBe(0);
  });

  it('an idle agent at the seat leaves its PC off', () => {
    const os = office();
    os.addAgent(1, 0, 0, 'cb1', true, undefined, undefined, true);
    os.setAgentActive(1, false);
    os.update(0.016);
    expect(litScreens(os)).toBe(0);
  });

  it('a helper lights the PC at its seat while it types and not once it idles', () => {
    const os = office();
    os.addAgent(1, 0, 0, 'ca1', true, undefined, undefined, false);
    const sub = os.addSubagent(1, 'tool-1');
    expect(os.characters.get(sub)!.seatId).toBe('cb1');
    os.setAgentActive(sub, true);
    os.update(0.016);
    expect(litScreens(os)).toBe(1);
    os.setAgentActive(sub, false);
    os.update(0.016);
    expect(litScreens(os)).toBe(0);
  });
});
