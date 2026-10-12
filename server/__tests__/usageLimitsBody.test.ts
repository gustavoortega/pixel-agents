import { describe, expect, it } from 'vitest';

import { parseUsageLimitsBody } from '../src/usage/usageLimitsBody.js';

const FIVE = { usedPercentage: 37.5, resetsAt: 1_760_000_000 };
const SEVEN = { usedPercentage: 12, resetsAt: 1_760_400_000 };

/**
 * The statusline route's whole input contract, checked by hand because Fastify's AJV would strip extra keys and
 * coerce types instead of refusing them. A wrapper that forwarded more than the two windows must get a 400, and only a
 * finite number already in range is a number.
 */
describe('parseUsageLimitsBody', () => {
  it.each([
    ['an extra top-level key', { fiveHour: FIVE, sevenDay: SEVEN, cwd: '/home/x/repo' }],
    ['an extra window key', { fiveHour: { ...FIVE, model: 'opus' }, sevenDay: SEVEN }],
    ['a missing top-level key', { fiveHour: FIVE }],
    ['a missing window key', { fiveHour: { usedPercentage: 37.5 }, sevenDay: SEVEN }],
    [
      'a string in a number field',
      { fiveHour: { ...FIVE, usedPercentage: '37' }, sevenDay: SEVEN },
    ],
    ['null in a number field', { fiveHour: { ...FIVE, resetsAt: null }, sevenDay: SEVEN }],
    ['NaN', { fiveHour: { ...FIVE, usedPercentage: NaN }, sevenDay: SEVEN }],
    ['a negative percentage', { fiveHour: { ...FIVE, usedPercentage: -1 }, sevenDay: SEVEN }],
    ['a percentage above 1000', { fiveHour: { ...FIVE, usedPercentage: 1000.5 }, sevenDay: SEVEN }],
    [
      'a reset in milliseconds',
      { fiveHour: { ...FIVE, resetsAt: 1_760_000_000_000 }, sevenDay: SEVEN },
    ],
    ['a reset before 2001', { fiveHour: { ...FIVE, resetsAt: 999_999_999 }, sevenDay: SEVEN }],
    ['two null windows', { fiveHour: null, sevenDay: null }],
    ['a window that is an array', { fiveHour: [37.5, 1_760_000_000], sevenDay: SEVEN }],
    ['an array body', [FIVE, SEVEN]],
    ['a string body', 'fiveHour=37'],
    ['a null body', null],
  ])('rejects %s', (_case, body) => {
    expect(parseUsageLimitsBody(body)).toBeNull();
  });

  it.each([
    ['both windows', { fiveHour: FIVE, sevenDay: SEVEN }, { fiveHour: FIVE, sevenDay: SEVEN }],
    // 0 is a real value, not an absent one.
    [
      'a zero percentage',
      { fiveHour: { ...FIVE, usedPercentage: 0 }, sevenDay: SEVEN },
      { fiveHour: { ...FIVE, usedPercentage: 0 }, sevenDay: SEVEN },
    ],
    ['one null window', { fiveHour: null, sevenDay: SEVEN }, { fiveHour: null, sevenDay: SEVEN }],
    [
      'the range edges',
      { fiveHour: { usedPercentage: 1000, resetsAt: 1e9 }, sevenDay: SEVEN },
      { fiveHour: { usedPercentage: 1000, resetsAt: 1e9 }, sevenDay: SEVEN },
    ],
  ])('accepts %s', (_case, body, expected) => {
    expect(parseUsageLimitsBody(body)).toEqual(expected);
  });
});
