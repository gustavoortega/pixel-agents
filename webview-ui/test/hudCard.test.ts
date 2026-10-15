/**
 * The stage's chrome: the clock reads the office clock and counts only agents whose status is
 * active (waiting and idle do not count), the zoom level reads as plain "Nx", and no version text
 * floats over the office.
 *
 * Run with: npm test
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';

import { HudCard } from '../src/components/HudCard.js';
import { StageClock } from '../src/components/StageClock.js';
import { VersionIndicator } from '../src/components/VersionIndicator.js';
import { overrideOfficeClock } from '../src/office/clock.js';
import { applyAgentStatus } from '../src/office/engine/agentStatus.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function office(): OfficeState {
  const cols = 9;
  const rows = 7;
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
  return new OfficeState(layout);
}

afterEach(() => {
  overrideOfficeClock(null);
  vi.useRealTimers();
});

// Q2.3: a staged scene pins the office clock (its light, its ages); the clock on the stage must
// show that time, not the machine's.
test('the stage clock shows the office time and counts only agents whose status is active', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 9, 5));
  overrideOfficeClock(() => new Date(2026, 9, 12, 15, 20));
  const os = office();
  for (const id of [1, 2, 3, 4]) os.addAgent(id);
  const statuses = ['active', 'active', 'waiting', 'idle'] as const;
  statuses.forEach((status, i) => applyAgentStatus(os, i + 1, status, false, true));

  const html = renderToStaticMarkup(createElement(StageClock, { characters: os.characters }));

  expect(html).toContain('15:20');
  expect(html).not.toContain('09:05');
  expect(html).toContain('2 active');
});

test('the zoom controls read the level as Nx', () => {
  const html = renderToStaticMarkup(
    createElement(HudCard, { zoom: 6, onZoomChange: () => {}, fitActive: false, onFit: () => {} }),
  );

  expect(html).toContain('3x');
});

test('with the update already seen, nothing in the office overlay prints the version', () => {
  const html = renderToStaticMarkup(
    createElement(VersionIndicator, {
      currentVersion: '1.4.0',
      lastSeenVersion: '1.4',
      onDismiss: () => {},
      onOpenChangelog: () => {},
    }),
  );

  expect(html).not.toMatch(/v?1\.4/);
});
