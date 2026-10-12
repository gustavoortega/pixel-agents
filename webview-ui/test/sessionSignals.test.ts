/**
 * OfficeState keeps the session signals (cache clock, permission mode, background
 * shells) by agent id, not on the character: the server can send them before the
 * buffered `agentCreated` has produced the character.
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

const EXPIRES_AT = 1_760_000_000_000;

test('C15 signals sent before the character exists survive addAgent, and removeAgent drops all three', () => {
  const os = new OfficeState(floorLayout());
  os.setAgentCache(7, 3600, EXPIRES_AT);
  os.setAgentMode(7, 'auto');
  os.setAgentShells(7, 2);

  os.addAgent(7);
  assert.deepEqual(os.cacheByAgent.get(7), { ttlSeconds: 3600, expiresAt: EXPIRES_AT });
  assert.equal(os.modeByAgent.get(7), 'auto');
  assert.equal(os.shellsByAgent.get(7), 2);

  os.removeAgent(7);
  assert.equal(os.cacheByAgent.has(7), false);
  assert.equal(os.modeByAgent.has(7), false);
  assert.equal(os.shellsByAgent.has(7), false);
});

test('C15 a message with its field omitted clears the entry, and half a cache clock is none', () => {
  const os = new OfficeState(floorLayout());
  os.setAgentCache(7, 3600, EXPIRES_AT);
  os.setAgentMode(7, 'plan');
  os.setAgentShells(7, 1);

  os.setAgentCache(7, 3600, undefined);
  os.setAgentMode(7, undefined);
  os.setAgentShells(7, 0);

  assert.equal(os.cacheByAgent.has(7), false);
  assert.equal(os.modeByAgent.has(7), false);
  assert.equal(os.shellsByAgent.has(7), false);
});
