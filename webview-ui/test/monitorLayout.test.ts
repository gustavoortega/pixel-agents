/**
 * Where the rail and the inspector sheet go for a window size: the table the monitor's layout
 * rules (rail widths, inline vs overlay sheet, full vs compact plates) come down to.
 *
 * Run with: npm test
 */

import { describe, expect, it } from 'vitest';

import { monitorLayout } from '../src/components/monitorLayout.js';

describe('monitorLayout', () => {
  it.each([
    // [window w, h] -> rail, railPx, sheetMode, sheetPx, fullPlates
    ['second monitor 1920x1080', 1920, 1080, 'wide', 360, 'inline', 420, true],
    ['the wide edge 1600x900', 1600, 900, 'wide', 360, 'inline', 420, true],
    ['just under it 1599x900', 1599, 900, 'mid', 300, 'overlay', 360, true],
    ['laptop 1280x800', 1280, 800, 'mid', 300, 'overlay', 360, true],
    ['the mid edge 1100x800', 1100, 800, 'mid', 300, 'overlay', 360, true],
    ['side window 1099x800', 1099, 800, 'slim', 76, 'overlay', 360, false],
    ['VS Code panel 1100x300', 1100, 300, 'slim', 76, 'overlay', 360, false],
    ['wide but short 1920x419', 1920, 419, 'slim', 76, 'inline', 420, false],
    ['wide at the height edge 1920x420', 1920, 420, 'wide', 360, 'inline', 420, true],
  ] as const)('%s', (_name, w, h, rail, railPx, sheetMode, sheetPx, fullPlates) => {
    expect(monitorLayout(w, h)).toEqual({ rail, railPx, sheetMode, sheetPx, fullPlates });
  });
});
