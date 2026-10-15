import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash, sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import type { RecordedServerMessage } from '../../helpers/standalone';
import { getClaudeProjectDir } from '../../helpers/team';
import { setSettings } from '../../helpers/webview';

/**
 * The inspector sheet against the real server, opened the way a user does: an agent selected
 * (the test hook sets what a canvas or ticket click sets), then Enter.
 */

type InspectorWindow = Window & {
  __pixelAgentsTestHooks?: { selectAgent?: (id: number) => void };
};

/** A transcript the way Claude Code writes it: append-only JSONL under the project's folder. */
function seedTranscript(
  home: string,
  workspace: string,
  sessionId: string,
  records: Array<Record<string, unknown>>,
): string {
  const dir = getClaudeProjectDir(home, workspace);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

/** Select the agent, then Enter: the sheet opens on it. */
async function openSheetOn(page: Page, id: number): Promise<void> {
  await page.evaluate((agentId) => {
    const hooks = (window as InspectorWindow).__pixelAgentsTestHooks;
    if (!hooks?.selectAgent) throw new Error('selectAgent test hook missing');
    hooks.selectAgent(agentId);
    // A focused button would take Enter for itself.
    (document.activeElement as HTMLElement | null)?.blur();
  }, id);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="monitor-sheet"][data-open="true"]')).toBeVisible();
}

/** Start a hook session with one harmless tool call. */
async function startAgent(
  standalone: { hookServerConfig: Parameters<typeof sendHookEvent>[0]; workspaceDir: string },
  sessionId: string,
): Promise<void> {
  await sendHookEvent(
    standalone.hookServerConfig,
    sessionStartStartup(sessionId, standalone.workspaceDir),
  );
  await sendHookEvent(standalone.hookServerConfig, {
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: path.join(standalone.workspaceDir, 'README.md') },
  });
}

function idForTitle(messages: RecordedServerMessage[], title: string): number | undefined {
  const m = messages.find((msg) => msg.type === 'agentSessionTitle' && msg.title === title);
  return m?.id as number | undefined;
}

test.describe('Standalone / inspector', () => {
  test('C7.1 opening the inspector on the selected agent shows its branch from its transcript @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { watchAllSessions: true });
    const sessions = [
      { title: 'Retry failed webhooks', branch: 'fix/retry-backoff' },
      { title: 'Pick a date library', branch: 'feat/date-picker' },
    ].map((s) => ({ ...s, id: crypto.randomUUID() }));
    for (const s of sessions) {
      const at = new Date(Date.now() - 30 * 60_000).toISOString();
      const transcript = seedTranscript(standalone.tmpHome, standalone.workspaceDir, s.id, [
        { type: 'custom-title', customTitle: s.title, sessionId: s.id },
        {
          type: 'user',
          uuid: crypto.randomUUID(),
          sessionId: s.id,
          timestamp: at,
          cwd: standalone.workspaceDir,
          gitBranch: s.branch,
          message: { role: 'user', content: 'start' },
        },
      ]);
      await sendHookEvent(
        standalone.hookServerConfig,
        sessionStartStartup(s.id, standalone.workspaceDir, transcript),
      );
      await sendHookEvent(standalone.hookServerConfig, {
        session_id: s.id,
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: path.join(standalone.workspaceDir, 'README.md') },
      });
    }

    // Both agents known by title: the second one is the one inspected, never the first.
    const seen: RecordedServerMessage[] = [];
    await expect
      .poll(
        async () => {
          seen.push(...(await standalone.drainMessages()));
          return sessions.map((s) => idForTitle(seen, s.title) !== undefined);
        },
        { timeout: 20_000 },
      )
      .toEqual([true, true]);
    const [first, second] = sessions;
    await openSheetOn(page, idForTitle(seen, second.title)!);

    const sheet = page.locator('[data-testid="monitor-sheet"][data-open="true"]');
    const hero = sheet.getByTestId('inspector-hero');
    await expect(hero).toContainText(second.title);
    await expect(hero).not.toContainText(first.title);
    await expect(sheet.getByTestId('inspector-branch')).toHaveText(second.branch, {
      timeout: 15_000,
    });
  });

  test('C7.4 acknowledging a tripwire from the inspector clears it @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { watchAllSessions: true });
    const sessionId = crypto.randomUUID();
    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    // Two hits of the dotenv rule: an ack must carry the count it saw, or the server keeps it.
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(sessionId, 'cat .env'));
    await sendHookEvent(standalone.hookServerConfig, preToolUseBash(sessionId, 'cat .env'));

    const seen: RecordedServerMessage[] = [];
    await expect
      .poll(
        async () => {
          seen.push(...(await standalone.drainMessages()));
          return seen.some((m) => m.type === 'agentTripwire' && m.count === 2);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const id = seen.find((m) => m.type === 'agentTripwire')!.id as number;
    await openSheetOn(page, id);

    const line = page.getByTestId('inspector-tripwire');
    const ticket = page.locator(`[data-testid="monitor-ticket"][data-agent-id="${id}"]`);
    await expect(line).toContainText('Dotenv file access');
    await expect(line).toContainText('×2');
    await expect(ticket).toHaveAttribute('data-kind', 'stuck');
    await line.click();

    await expect(line).toHaveCount(0);
    // The rail's ticket was the alarm: the ack takes it off the rail too.
    await expect(ticket).toHaveCount(0);
    await expect
      .poll(async () => {
        seen.push(...(await standalone.drainMessages()));
        return seen.some((m) => m.type === 'agentTripwireClear' && m.id === id);
      })
      .toBe(true);
  });
});

/** B1/A12: from 1600 px wide the sheet takes layout width, so the map re-fits beside it. */
for (const dpr of [1, 2] as const) {
  test.describe(`Standalone / inspector layout at dpr ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test(`at 1920x1080 the open sheet takes layout width beside the stage, and opening it closes Usage (dpr ${dpr}) @area:standalone`, async ({
      page,
      standalone,
    }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await setSettings(page, { watchAllSessions: true });
      await startAgent(standalone, crypto.randomUUID());
      const seen: RecordedServerMessage[] = [];
      await expect
        .poll(async () => {
          seen.push(...(await standalone.drainMessages()));
          return seen.some((m) => m.type === 'agentCreated');
        })
        .toBe(true);
      const id = seen.find((m) => m.type === 'agentCreated')!.id as number;

      await page.getByRole('button', { name: 'Usage', exact: true }).click();
      const usage = page.getByRole('dialog', { name: 'Token usage' });
      await expect(usage).toBeVisible();
      await openSheetOn(page, id);
      await expect(usage).toHaveCount(0);

      const sheet = page.locator('[data-testid="monitor-sheet"][data-open="true"]');
      await expect(sheet).toHaveAttribute('data-sheet', 'inline');
      // Layout space, not a cover: the office's canvas (the stage) ends where the sheet begins.
      // How the office is framed in it is Q4.6's.
      const canvas = page.locator('canvas').first();
      await expect
        .poll(async () => {
          const [c, s] = [await canvas.boundingBox(), await sheet.boundingBox()];
          return c && s ? c.x + c.width <= s.x + 0.5 : false;
        })
        .toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  });
}

type CameraWindow = Window & {
  __pixelAgentsTestHooks?: {
    getSelection?: () => { selectedAgentId: number | null; cameraFollowId: number | null };
  };
};

function selection(page: Page) {
  return page.evaluate(() => (window as CameraWindow).__pixelAgentsTestHooks?.getSelection?.());
}

/** One working agent in a window of this size, its fit settled; returns its id. */
async function oneAgentAt(
  page: Page,
  standalone: Parameters<typeof startAgent>[0] & {
    drainMessages: () => Promise<RecordedServerMessage[]>;
  },
  width = 1920,
  height = 1080,
): Promise<number> {
  await page.setViewportSize({ width, height });
  await setSettings(page, { watchAllSessions: true });
  await startAgent(standalone, crypto.randomUUID());
  const seen: RecordedServerMessage[] = [];
  await expect
    .poll(async () => {
      seen.push(...(await standalone.drainMessages()));
      return seen.some((m) => m.type === 'agentCreated');
    })
    .toBe(true);
  await expect(page.locator('[data-testid="agent-overlay"]').first()).toBeVisible();
  // A focused button would take the keys for itself.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return seen.find((m) => m.type === 'agentCreated')!.id as number;
}

const fitButton = (page: Page) =>
  page.getByRole('button', { name: 'Fit the view to the rooms in use' });

test.describe('Standalone / inspector camera', () => {
  test('Q4.4 selecting an agent while the whole map fits keeps the fit: there is nothing to follow @area:standalone', async ({
    page,
    standalone,
  }) => {
    const id = await oneAgentAt(page, standalone);
    await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
    const level = await page.getByTestId('zoom-level').textContent();

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => selection(page)).toEqual({ selectedAgentId: id, cameraFollowId: null });
    await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('zoom-level')).toHaveText(level!);
  });

  test('Q4.5 Fit takes the camera back from a follow @area:standalone', async ({
    page,
    standalone,
  }) => {
    const id = await oneAgentAt(page, standalone);
    const level = await page.getByTestId('zoom-level').textContent();
    // Zoomed in, the map is bigger than the stage: a selection follows the agent.
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => selection(page)).toEqual({ selectedAgentId: id, cameraFollowId: id });

    await fitButton(page).click();

    await expect(page.getByTestId('zoom-level')).toHaveText(level!);
    await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => selection(page)).toEqual({ selectedAgentId: id, cameraFollowId: null });
  });
});

/** The zoom badge once the view holds still: a fit lands a frame or two after it starts, a
 *  follow eases in, and a quiet office draws once a second. */
async function settledLevel(page: Page): Promise<string> {
  const level = page.getByTestId('zoom-level');
  const map = page.getByTestId('map-vignette');
  const view = async () => JSON.stringify([await level.textContent(), await map.boundingBox()]);
  let before = await view();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(1_200);
        const [prev, next] = [before, await view()];
        before = next;
        return prev === next;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return (await level.textContent())!;
}

type Box = { x: number; y: number; width: number; height: number };

/** Select the agent with the keys (→), then open its sheet (Enter). */
async function openByKeys(page: Page, id: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await selection(page))?.selectedAgentId).toBe(id);
  await page.keyboard.press('Enter');
}

/**
 * Q4: opening the sheet keeps the office's size. The zoom never drops below the one it had (nor
 * under 1x); the whole map stays framed when only its outer wall is cut (at most 5% of its width
 * a side), else the camera follows the inspected agent. Closing gives the previous fit back.
 */
for (const dpr of [1, 2] as const) {
  test.describe(`Standalone / inspector sheet fit at dpr ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test(`Q4.1 at 1280x800 the overlay sheet keeps the zoom and frames the selected agent beside it (dpr ${dpr}) @area:standalone`, async ({
      page,
      standalone,
    }) => {
      const id = await oneAgentAt(page, standalone, 1280, 800);
      await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
      const before = await settledLevel(page);
      await openByKeys(page, id);
      const sheet = page.locator('[data-testid="monitor-sheet"][data-open="true"]');
      await expect(sheet).toHaveAttribute('data-sheet', 'overlay');

      expect(await settledLevel(page)).toBe(before);
      const plate = page.locator(`[data-testid="agent-overlay"][data-agent-id="${id}"]`);
      const rail = page.getByTestId('monitor-rail');
      await expect
        .poll(async () => {
          const [p, s, r] = [
            await plate.boundingBox(),
            await sheet.boundingBox(),
            await rail.boundingBox(),
          ];
          if (!p || !s || !r) return 'missing';
          const inside =
            p.x >= r.x + r.width - 0.5 &&
            p.x + p.width <= s.x + 0.5 &&
            p.y >= -0.5 &&
            p.y + p.height <= 800.5;
          return inside ? 'inside' : `plate ${p.x},${p.y} ${p.width}x${p.height} sheet at ${s.x}`;
        })
        .toBe('inside');

      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="monitor-sheet"][data-open="false"]')).toHaveCount(1);
      expect(await settledLevel(page)).toBe(before);
      await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
    });

    test(`Q4.6 at 1920x1080 the inline sheet keeps the zoom, the whole map framed with at most its outer wall cut (dpr ${dpr}) @area:standalone`, async ({
      page,
      standalone,
    }) => {
      const id = await oneAgentAt(page, standalone);
      await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
      const before = await settledLevel(page);
      await openByKeys(page, id);
      const sheet = page.locator('[data-testid="monitor-sheet"][data-open="true"]');
      await expect(sheet).toHaveAttribute('data-sheet', 'inline');

      const map = page.getByTestId('map-vignette');
      const rail = page.getByTestId('monitor-rail');
      // Framed, not followed: the fit stays on, at the zoom the office had.
      expect(await settledLevel(page)).toBe(before);
      await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
      const [m, s, r] = (await Promise.all([
        map.boundingBox(),
        sheet.boundingBox(),
        rail.boundingBox(),
      ])) as Box[];
      const cutLeft = r.x + r.width - m.x;
      const cutRight = m.x + m.width - s.x;
      const edge = 0.05 * m.width + 0.5;
      expect(cutLeft).toBeLessThanOrEqual(edge);
      expect(cutRight).toBeLessThanOrEqual(edge);
      expect(Math.abs(cutLeft - cutRight)).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(-0.5);
      expect(m.y + m.height).toBeLessThanOrEqual(1080.5);

      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="monitor-sheet"][data-open="false"]')).toHaveCount(1);
      expect(await settledLevel(page)).toBe(before);
      await expect(fitButton(page)).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

/**
 * R2: the clock belongs to the office column. At 1280 the overlay sheet covers the stage's right
 * part, so the clock keeps to what is left of it, and the badge a dropped host raises sits clear
 * of both.
 */
test.describe('Standalone / inspector and the stage clock', () => {
  test('at 1280x800 with the sheet open and the host gone the clock stays inside the uncovered stage, clear of the sheet and the connection badge @area:standalone', async ({
    page,
    standalone,
  }) => {
    const id = await oneAgentAt(page, standalone, 1280, 800);
    await openByKeys(page, id);
    await expect(page.locator('[data-testid="monitor-sheet"][data-open="true"]')).toHaveAttribute(
      'data-sheet',
      'overlay',
    );
    // A crash, so the page keeps retrying and the badge stays up.
    await standalone.stopHost({ crash: true });
    await expect(page.getByTestId('connection-indicator')).toBeVisible({ timeout: 15_000 });

    const [clock, badge, sheet, rail] = (await Promise.all(
      ['stage-clock', 'connection-indicator', 'monitor-sheet', 'monitor-rail'].map((t) =>
        page.getByTestId(t).boundingBox(),
      ),
    )) as Array<Box | null>;
    expect(clock && badge && sheet && rail, 'clock, badge, sheet and rail on screen').toBeTruthy();
    const overlap = (a: Box, b: Box) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(clock!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width);
    expect(clock!.x + clock!.width).toBeLessThanOrEqual(sheet!.x - 16 + 0.5);
    expect(clock!.y).toBeGreaterThanOrEqual(0);
    expect(overlap(clock!, sheet!), 'clock under the sheet').toBe(false);
    expect(overlap(clock!, badge!), 'clock under the connection badge').toBe(false);
  });
});
