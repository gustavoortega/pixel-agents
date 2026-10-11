/**
 * OfficeState keeps session titles by agent id, not on the character: the
 * server can send a title before the buffered `agentCreated` has produced the
 * character, and the label must not lose it.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function floorLayout(cols = 9, rows = 7): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

test('a title set before the character exists survives addAgent, and removeAgent drops it', () => {
  const os = new OfficeState(floorLayout());
  os.setSessionTitle(7, 'Fix login bug');

  os.addAgent(7);
  assert.equal(os.sessionTitles.get(7), 'Fix login bug');

  os.removeAgent(7);
  assert.equal(os.sessionTitles.has(7), false);
});

test('setSessionTitle with no title clears it', () => {
  const os = new OfficeState(floorLayout());
  os.setSessionTitle(7, 'Fix login bug');
  os.setSessionTitle(7, undefined);

  assert.equal(os.sessionTitles.has(7), false);
});
