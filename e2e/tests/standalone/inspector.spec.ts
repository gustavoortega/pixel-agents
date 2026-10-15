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

    test(`at 1920x1080 the open sheet sits beside the map, and opening it closes Usage (dpr ${dpr}) @area:standalone`, async ({
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
      const map = page.getByTestId('map-vignette');
      await expect
        .poll(async () => {
          const [m, s] = [await map.boundingBox(), await sheet.boundingBox()];
          if (!m || !s) return 'missing';
          const apart = m.x + m.width <= s.x + 0.5 || s.x + s.width <= m.x + 0.5;
          return apart ? 'apart' : `map ${m.x}+${m.width} sheet ${s.x}+${s.width}`;
        })
        .toBe('apart');
      // Layout space, not a cover: the office's canvas (the stage) ends where the sheet begins.
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
