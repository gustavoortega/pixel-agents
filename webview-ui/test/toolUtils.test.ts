/**
 * Unit tests for `agentLabel`, the text shown under an agent's activity line.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { agentLabel } from '../src/office/toolUtils.js';

test('agentLabel prefers the session title, then the folder, then nothing', () => {
  const cases: Array<[string | undefined, string | undefined, string | null]> = [
    ['Fix login bug', 'my-repo', 'Fix login bug'],
    [undefined, 'my-repo', 'my-repo'],
    ['', 'my-repo', 'my-repo'],
    [undefined, undefined, null],
  ];
  for (const [title, folder, expected] of cases) {
    assert.equal(agentLabel(title, folder), expected, `title=${title} folder=${folder}`);
  }
});
