import { describe, expect, it } from 'vitest';

import { parseTestSummary } from '../src/testSummary.js';

/** A block of output lines with no summary in them. */
const noise = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `    at frame${i} (src/a.ts:${i}:1)`).join('\n');

describe('parseTestSummary', () => {
  it.each([
    [
      'vitest, red',
      ' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 10 passed (12)\n   Duration  1.20s',
      { passed: 10, failed: 2 },
    ],
    [
      'vitest, green',
      '      Tests  12 passed (12)\n   Start at  10:00:00',
      { passed: 12, failed: 0 },
    ],
    [
      'jest',
      'Test Suites: 1 failed, 2 passed, 3 total\nTests:       1 failed, 5 passed, 6 total\nTime:        2.1 s',
      { passed: 5, failed: 1 },
    ],
    ['pytest', '==== 2 failed, 8 passed, 1 warning in 0.12s ====', { passed: 8, failed: 2 }],
    ['mocha passing', '  5 passing (20ms)\n', { passed: 5, failed: 0 }],
    [
      'mocha failing, details below it',
      `  2 failing\n\n  1) suite\n${noise(5)}`,
      { passed: 0, failed: 2 },
    ],
    ['cargo', 'test result: FAILED. 3 passed; 1 failed; 0 ignored', { passed: 3, failed: 1 }],
    ["a 'tests' word before passed", '5 tests passed', { passed: 5, failed: 0 }],
    ["a 'test' word before failed", '1 test failed', { passed: 0, failed: 1 }],
    ['case-insensitive', 'RESULTS: 4 PASSED, 1 FAILED', { passed: 4, failed: 1 }],
    [
      'the newest summary wins',
      'Tests  3 failed (3)\nre-run\nTests  3 passed (3)',
      { passed: 3, failed: 0 },
    ],
    ['nothing counted', 'Tests  0 passed (0)', null],
    ['go ok', 'ok  \tgithub.com/x/y\t0.012s', null],
    ['go FAIL', '--- FAIL: TestX (0.00s)\nFAIL\nFAIL\tgithub.com/x/y\t0.01s', null],
    ['a build error', 'Exit code 2\nsrc/a.ts(3,1): error TS2304: Cannot find name x.', null],
    ['a summary 41 lines from the end', `Tests  2 failed (2)\n${noise(40)}`, null],
    [
      'a summary 40 lines from the end',
      `Tests  2 failed (2)\n${noise(39)}`,
      { passed: 0, failed: 2 },
    ],
  ])('%s', (_name, text, expected) => {
    expect(parseTestSummary(text)).toEqual(expected);
  });
});
