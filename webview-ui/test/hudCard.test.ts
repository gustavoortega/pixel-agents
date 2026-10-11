/**
 * The top-left HUD card and the canvas overlay: the active count is status truth
 * (waiting and idle do not count), the zoom level reads as plain "Nx", and no
 * version text floats over the office.
 *
 * Run with: npm test
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import { HudCard } from '../src/components/HudCard.js';
import { VersionIndicator } from '../src/components/VersionIndicator.js';
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

function card(os: OfficeState, zoom: number): string {
  return renderToStaticMarkup(
    createElement(HudCard, {
      characters: os.characters,
      zoom,
      onZoomChange: () => {},
      fitActive: false,
      onFit: () => {},
    }),
  );
}

test('the card counts only agents whose status is active, and shows the zoom level as Nx', () => {
  const os = office();
  for (const id of [1, 2, 3, 4]) os.addAgent(id);
  const statuses = ['active', 'active', 'waiting', 'idle'] as const;
  statuses.forEach((status, i) => applyAgentStatus(os, i + 1, status, false, true));

  const html = card(os, 6);

  expect(html).toContain('2 active');
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
