/**
 * The inspector sheet as rendered markup, from a real OfficeState fed wire-shaped messages:
 * artifact links open in a new tab without a referrer or an opener and mask in privacy mode
 * (C7.2), an agent with no artifacts has no Artifacts section at all (C7.3), the context ring's
 * color follows the threshold table (Q4.2), and every glyph the sheet prints is one the pixel font
 * has (A13).
 *
 * Run with: npm test
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { monitorLayout } from '../src/components/monitorLayout.js';
import { MonitorSheet } from '../src/components/MonitorSheet.js';
import { applyMonitorMessage } from '../src/hooks/monitorMessages.js';
import { overrideOfficeClock } from '../src/office/clock.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, ToolActivity } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const NOW = new Date(2026, 9, 12, 15, 20, 0).getTime();
const MIN = 60_000;

beforeEach(() => overrideOfficeClock(() => new Date(NOW)));
afterEach(() => overrideOfficeClock(null));

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

function sheet(
  os: OfficeState,
  agentTools: Record<number, ToolActivity[]> = {},
  windowW = 1920,
): string {
  return renderToStaticMarkup(
    createElement(MonitorSheet, {
      officeState: os,
      monitor: { version: os.monitorVersion, selectedAgentId: os.selectedAgentId },
      layout: monitorLayout(windowW, 1080),
      inspector: {
        agentTools,
        subagentTools: {},
        subagentCharacters: [],
        onAckTripwire: () => {},
        onOpen: () => {},
        onSheetLayout: () => {},
      },
    }),
  );
}

/** One agent, selected, with the sheet open. */
function inspected(id = 1): OfficeState {
  const os = office();
  os.addAgent(id, 0, 0, undefined, true, 'billing-api');
  os.selectedAgentId = id;
  os.monitorSheetOpen = true;
  return os;
}

describe('C7.2 artifact links', () => {
  it('open in a new tab with no opener and no referrer, and the url text masks', () => {
    const os = inspected();
    applyMonitorMessage(os, {
      type: 'agentArtifacts',
      id: 1,
      count: 1,
      complete: true,
      items: [{ title: 'Refund flow', url: 'https://claude.ai/a/5c1e7b42', publishes: 2, at: NOW }],
    });
    const html = sheet(os);
    const link = /<a [^>]*data-testid="inspector-artifact-link"[^>]*>(.*?)<\/a>/.exec(html);
    expect(link, 'the artifact link').not.toBeNull();
    const tag = link![0].slice(0, link![0].indexOf('>') + 1);
    expect(tag).toContain('href="https://claude.ai/a/5c1e7b42"');
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer"');
    // The url as shown is session text: privacy mode masks every `.pv`.
    expect(link![1]).toMatch(/<span class="[^"]*\bpv\b[^"]*">claude\.ai\/a\/5c1e7b42<\/span>/);
    expect(html).toMatch(/<span class="[^"]*\bpv\b[^"]*">Refund flow<\/span>/);
  });
});

describe('Q4.2 the context ring', () => {
  it.each([
    // [context tokens of 200k] -> percent shown, ring tone
    [36_000, '18', 'gold'],
    [138_000, '69', 'gold'],
    [140_000, '70', 'warm'],
    [168_000, '84', 'warm'],
    [170_000, '85', 'hot'],
    [182_000, '91', 'hot'],
  ] as const)('%i tokens read %s percent on a %s ring', (tokens, pct, tone) => {
    const os = inspected();
    os.setAgentContext(1, tokens, 200_000);
    const html = sheet(os);
    const ring = /<svg class="[^"]*\binsp-ring-(\w+)\b[^"]*"/.exec(html);
    expect(ring?.[1]).toBe(tone);
    expect(html).toContain(`${pct}<small>%</small>`);
  });
});

describe('C7.3 no artifacts, no section', () => {
  it('an agent the server sent no artifacts for shows no Artifacts section, not a 0', () => {
    const os = inspected();
    applyMonitorMessage(os, { type: 'agentSession', id: 1, branch: 'fix/retry' });
    const html = sheet(os);
    expect(html).toContain('fix/retry');
    expect(html).not.toContain('inspector-artifacts');
    expect(html).not.toMatch(/artifact/i);
  });

  it('the clear form after a publish removes the section', () => {
    const os = inspected();
    applyMonitorMessage(os, {
      type: 'agentArtifacts',
      id: 1,
      count: 1,
      complete: true,
      items: [{ title: 'Plan', url: 'https://claude.ai/a/1' }],
    });
    expect(sheet(os)).toContain('inspector-artifacts');
    applyMonitorMessage(os, { type: 'agentArtifacts', id: 1 });
    expect(sheet(os)).not.toContain('inspector-artifacts');
  });
});

describe('privacy', () => {
  it('with no roster name the folder names the agent, masked like the folder', () => {
    const html = sheet(inspected());
    expect(html).toMatch(/<span class="insp-name-text pv">billing-api<\/span>/);
  });
});

describe('A13 glyphs', () => {
  /** What FS Pixel Sans draws beyond ASCII, of what the monitor uses (the font's cmap). */
  const PRESENT = new Set([...'›·–×↑→↓↻↗…']);

  it('every non-ASCII character in a sheet with every section is in the font', () => {
    const os = inspected(4);
    os.setAgentModel(4, 'monitor-tier-3', 3);
    os.setAgentContext(4, 180_000, 200_000);
    os.setSessionTitle(4, 'Review the payments PR');
    os.setAgentCache(4, 3600, NOW - 5 * MIN);
    os.setAgentMode(4, 'auto');
    os.setAgentShells(4, 2);
    os.setTripwire(4, { ruleName: 'Dotenv file access', severity: 'medium', count: 3 });
    os.setHealth(4, { state: 'stuck', reason: 'tests_failing_no_edits', count: 4 });
    for (const msg of [
      { type: 'agentSession', id: 4, startedAt: NOW - 63 * MIN, branch: 'review/pr', costUsd: 0 },
      {
        type: 'agentArtifacts',
        id: 4,
        count: 2,
        complete: false,
        items: [{ title: 'Notes', url: 'https://example.com/n', publishes: 3, at: NOW }],
      },
      { type: 'agentLoop', id: 4, nextAt: NOW + 25 * MIN, wakes: 3 },
      { type: 'agentTests', id: 4, passed: 41, failed: 3, at: NOW },
      {
        type: 'workflowRun',
        id: 4,
        runId: 'r1',
        status: 'running',
        name: 'review-pr',
        phases: [
          { name: 'scan', started: 1, done: 1 },
          { name: 'review', started: 3, done: 0 },
        ],
        started: 4,
        done: 1,
        since: NOW - 21 * MIN,
      },
      { type: 'agentStatus', id: 4, status: 'active', since: NOW - 21 * MIN },
      { type: 'agentToolPermission', id: 4, permissionSince: NOW - 12 * MIN },
    ]) {
      applyMonitorMessage(os, msg);
    }
    const html = sheet(
      os,
      { 4: [{ toolId: 't', status: 'Running: git push', done: false, permissionWait: true }] },
      1280,
    );
    for (const id of [
      'hero',
      'vitals',
      'now',
      'workflow',
      'loop',
      'artifacts',
      'tests',
      'health',
      'tripwire',
    ]) {
      expect(html, id).toContain(`data-testid="inspector-${id}"`);
    }
    const text = html.replace(/<[^>]*>/g, '');
    const missing = [...new Set([...text].filter((ch) => ch.charCodeAt(0) > 0x7e))].filter(
      (ch) => !PRESENT.has(ch),
    );
    expect(missing).toEqual([]);
  });
});
