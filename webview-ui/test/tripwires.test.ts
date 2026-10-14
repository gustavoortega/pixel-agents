/**
 * Tripwire alarm client logic: the overlay line, when the alarm sound plays,
 * and OfficeState keeping alarms by agent id (an alarm can arrive before the
 * buffered `agentCreated` has produced the character).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import {
  shouldPlayTripwireSound,
  type TripwireAlarm,
  tripwireLabel,
  type TripwireSeverity,
} from '../src/office/toolUtils.js';
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

test('tripwireLabel shows the count only past the first hit', () => {
  const cases: Array<[string, number, string]> = [
    ['Dotenv file access', 1, 'Dotenv file access'],
    ['Dotenv file access', 2, 'Dotenv file access ×2'],
    ['AWS write operation', 12, 'AWS write operation ×12'],
  ];
  for (const [name, count, expected] of cases) {
    assert.equal(tripwireLabel(name, count), expected);
  }
});

test('the alarm sound plays on the first hit and on escalation, never on a count bump', () => {
  const medium: TripwireAlarm = { ruleName: 'r', severity: 'medium', count: 1 };
  const cases: Array<[TripwireAlarm | undefined, TripwireSeverity, boolean]> = [
    [undefined, 'low', true],
    [medium, 'medium', false],
    [medium, 'low', false],
    [medium, 'high', true],
    [{ ...medium, severity: 'high' }, 'high', false],
  ];
  for (const [prev, next, expected] of cases) {
    assert.equal(
      shouldPlayTripwireSound(prev, { severity: next }),
      expected,
      `prev=${prev?.severity} next=${next}`,
    );
  }
});

test('an alarm set before the character exists survives addAgent, and removeAgent drops it', () => {
  const os = new OfficeState(floorLayout());
  const alarm = { ruleName: 'Dotenv file access', severity: 'medium', count: 2 } as const;
  os.setTripwire(7, alarm);

  os.addAgent(7);
  assert.deepEqual(os.tripwires.get(7), alarm);

  os.removeAgent(7);
  assert.equal(os.tripwires.has(7), false);
});

test('setTripwire with no alarm clears it', () => {
  const os = new OfficeState(floorLayout());
  os.setTripwire(7, { ruleName: 'r', severity: 'low', count: 1 });
  os.setTripwire(7, undefined);

  assert.equal(os.tripwires.has(7), false);
});
