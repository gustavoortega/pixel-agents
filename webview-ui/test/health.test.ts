/**
 * Agent health on the client: the line the full box shows for each reason, and OfficeState
 * keeping a health per agent only while that agent has a character.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { HealthReason } from '../../core/src/messages.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { healthLabel } from '../src/office/health.js';
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

test('healthLabel: one line per reason, the count only where it means something', () => {
  const cases: Array<[HealthReason, number, string]> = [
    ['tests_failing_no_edits', 3, 'tests failing, no edits'],
    ['no_progress', 12, 'no progress for 12 min'],
    ['same_call_repeated', 5, 'same call repeated 5 times'],
    ['process_gone', 0, 'process gone'],
  ];
  for (const [reason, count, expected] of cases) {
    assert.equal(healthLabel({ reason, count }), expected, reason);
  }
});

test('a health for an agent with no character is dropped; a known one is kept until cleared', () => {
  const os = new OfficeState(floorLayout());
  const stuck = { state: 'stuck', reason: 'tests_failing_no_edits', count: 3 } as const;

  os.setHealth(7, stuck);
  assert.equal(os.health.has(7), false, 'no character for 7 yet');

  os.addAgent(7);
  os.setHealth(7, stuck);
  assert.deepEqual(os.health.get(7), stuck);

  os.setHealth(7, undefined);
  assert.equal(os.health.has(7), false);
});

test('removeAgent drops the health with the character', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(7);
  os.setHealth(7, { state: 'dead', reason: 'process_gone', count: 0 });

  os.removeAgent(7);
  assert.equal(os.health.has(7), false);
});
