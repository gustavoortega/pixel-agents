/**
 * Status truth in the webview: what an `agentStatus` does to a character, and
 * which characters start working. Unknown status must never render as working.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { applyAgentStatus } from '../src/office/engine/agentStatus.js';
import { reconcileExistingAgents } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

function floorLayout(): OfficeLayout {
  const cols = 9;
  const rows = 7;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

function office(): OfficeState {
  return new OfficeState(floorLayout());
}

test('a launched terminal starts working, an external or restored agent starts idle', () => {
  const os = office();
  os.addAgent(1);
  os.addAgent(2, undefined, undefined, undefined, true, undefined, undefined, false);
  assert.equal(os.characters.get(1)?.isActive, true);
  // no seat in this room, so the working agent stands rather than types over bare floor
  assert.equal(os.characters.get(1)?.state, CharacterState.IDLE);
  assert.equal(os.characters.get(2)?.isActive, false);
  assert.equal(os.characters.get(2)?.state, CharacterState.IDLE);
});

test('existingAgents restores every agent as idle until the server says otherwise', () => {
  const os = office();
  reconcileExistingAgents(os, [5], {}, {}, true, []);
  assert.equal(os.characters.get(5)?.isActive, false);
});

test('active turns the character on; idle turns it off and shows no bubble', () => {
  const os = office();
  os.addAgent(1);
  assert.equal(applyAgentStatus(os, 1, 'active', false, false), false);
  assert.equal(os.characters.get(1)?.isActive, true);

  assert.equal(applyAgentStatus(os, 1, 'idle', false, true), false);
  assert.equal(os.characters.get(1)?.isActive, false);
  assert.equal(os.characters.get(1)?.bubbleType, null);
});

test('waiting shows the bubble and chimes; a following idle clears the bubble', () => {
  const os = office();
  os.addAgent(1);
  assert.equal(applyAgentStatus(os, 1, 'waiting', true, true), true);
  assert.equal(os.characters.get(1)?.bubbleType, 'waiting');
  assert.equal(os.characters.get(1)?.isActive, false);

  applyAgentStatus(os, 1, 'idle', false, false);
  assert.equal(os.characters.get(1)?.bubbleType, null);
});

test('a status this build does not know reads as not working, without a bubble', () => {
  const os = office();
  os.addAgent(1);
  applyAgentStatus(os, 1, 'something-newer', false, false);
  assert.equal(os.characters.get(1)?.isActive, false);
  assert.equal(os.characters.get(1)?.bubbleType, null);
});

test('an agent adopted already waiting gets its bubble but no chime', () => {
  const os = office();
  os.addAgent(1);
  assert.equal(applyAgentStatus(os, 1, 'waiting', false, false), false);
  assert.equal(os.characters.get(1)?.bubbleType, 'waiting');
});
