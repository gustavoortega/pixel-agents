import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import {
  monitorSceneMessages,
  SCENE_AGENT_COUNT,
  SCENE_HELPER_COUNT,
  SCENE_LEAD_ID,
} from '../../helpers/monitor-scene';

/**
 * The monitor's office on the real standalone page: the desk that lights for an agent needing
 * you (read off the canvas through the test hook, since it has no DOM), and the tags beside the
 * rail, which never cover each other or a face. Messages reach the page's own socket handler
 * (`__pixelAgentsDeliver`), as the server would send them.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type OfficeWindow = Window & {
  __pixelAgentsDeliver?: (msg: unknown) => void;
  __pixelAgentsTestHooks?: {
    selectAgent?: (id: number | null) => void;
    openSheet?: () => void;
    getDeskHighlights?: () => Array<{ id: number; tone: 'wait' | 'stuck'; rect: Box }>;
    getAgentSeats?: () => Array<{ id: number; seatId: string | null }>;
    getSeats?: () => Array<{ uid: string; col: number; row: number }>;
    getTagLayout?: () => {
      heads: Array<{ id: number; rect: Box }>;
      banners: Array<{ leadId: number; rect: Box }>;
      plaques: Array<{ label: string; rect: Box }>;
    };
  };
};

async function deliver(page: Page, messages: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate((msgs) => {
    const send = (window as OfficeWindow).__pixelAgentsDeliver;
    if (!send) throw new Error('message delivery missing');
    for (const m of msgs) send(m);
  }, messages);
}

async function select(page: Page, id: number | null, sheet = false): Promise<void> {
  await page.evaluate(
    ({ agentId, open }) => {
      const hooks = (window as OfficeWindow).__pixelAgentsTestHooks;
      if (!hooks?.selectAgent || !hooks.openSheet) throw new Error('selection hooks missing');
      hooks.selectAgent(agentId);
      if (open) hooks.openSheet();
    },
    { agentId: id, open: sheet },
  );
}

const TILE = 16;

test.describe('Standalone / monitor office', () => {
  test('Q3.1 the desk lights gold for a permission and a question, red when stuck, at each own seat @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Four agents; the one listed first needs nothing, so a light by list order lands wrong.
    const ids = { calm: 9101, permission: 9102, question: 9103, stuck: 9104 };
    await deliver(page, [
      ...Object.values(ids).map((id) => ({ type: 'agentCreated', id, folderName: 'repo' })),
      { type: 'agentStatus', id: ids.calm, status: 'idle' },
      {
        type: 'agentToolStart',
        id: ids.permission,
        toolId: 'q31-push',
        status: 'Running: git push',
        toolName: 'Bash',
      },
      { type: 'agentToolPermission', id: ids.permission },
      { type: 'agentStatus', id: ids.question, status: 'waiting', awaitingInput: true },
      {
        type: 'agentHealth',
        id: ids.stuck,
        state: 'stuck',
        reason: 'tests_failing_no_edits',
        count: 4,
      },
    ]);
    // Past the two seconds the waiting bubble lives: the question stays lit after it fades.
    await page.waitForTimeout(3_000);
    const lit = async () =>
      page.evaluate(() => {
        const hooks = (window as OfficeWindow).__pixelAgentsTestHooks;
        if (!hooks?.getDeskHighlights || !hooks.getAgentSeats || !hooks.getSeats) {
          throw new Error('desk highlight hooks missing');
        }
        const seats = new Map(hooks.getSeats().map((s) => [s.uid, s]));
        const seatOf = new Map(hooks.getAgentSeats().map((a) => [a.id, a.seatId]));
        return hooks.getDeskHighlights().map((h) => {
          const seat = seatOf.get(h.id) ? seats.get(seatOf.get(h.id)!) : undefined;
          return { id: h.id, tone: h.tone, rect: h.rect, seat: seat ?? null };
        });
      });
    await expect
      .poll(async () =>
        (await lit())
          .filter((h) => (Object.values(ids) as number[]).includes(h.id))
          .map((h) => `${h.id}:${h.tone}`)
          .sort(),
      )
      .toEqual([`${ids.permission}:wait`, `${ids.question}:wait`, `${ids.stuck}:stuck`]);
    for (const h of (await lit()).filter((l) => (Object.values(ids) as number[]).includes(l.id))) {
      // Each frame holds its own agent's seat tile.
      expect(h.seat, `agent ${h.id} has a seat`).not.toBeNull();
      const cx = (h.seat!.col + 0.5) * TILE;
      const cy = (h.seat!.row + 0.5) * TILE;
      expect(h.rect.x < cx && cx < h.rect.x + h.rect.w, `agent ${h.id} seat x`).toBe(true);
      expect(h.rect.y < cy && cy < h.rect.y + h.rect.h, `agent ${h.id} seat y`).toBe(true);
    }
  });
});

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every drawn tag (DOM) against every other and every face (the hook: faces are canvas), and
 *  the tags, banners and plaques against the stage clock drawn over the map. */
async function tagCollisions(page: Page): Promise<{ tags: number; hits: string[] }> {
  const { tags, heads, boards, clock } = await page.evaluate(() => {
    const hooks = (window as OfficeWindow).__pixelAgentsTestHooks;
    if (!hooks?.getTagLayout) throw new Error('tag layout hook missing');
    const plates = [
      ...document.querySelectorAll('[data-testid="agent-overlay"] .nameplate-tag'),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      const id = Number(el.closest('[data-testid="agent-overlay"]')?.getAttribute('data-agent-id'));
      return { id, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    const layout = hooks.getTagLayout();
    const clockEl = document.querySelector('[data-testid="stage-clock"]');
    const c = clockEl?.getBoundingClientRect();
    return {
      tags: plates,
      heads: layout.heads,
      boards: [
        ...layout.banners.map((b) => ({ id: `banner ${b.leadId}`, rect: b.rect })),
        ...layout.plaques.map((p) => ({ id: `plaque ${p.label}`, rect: p.rect })),
      ],
      clock: c ? { x: c.x, y: c.y, w: c.width, h: c.height } : null,
    };
  });
  const hits: string[] = [];
  for (const [i, t] of tags.entries()) {
    for (const u of tags.slice(i + 1)) if (overlaps(t.rect, u.rect)) hits.push(`${t.id}/${u.id}`);
    for (const f of heads) if (overlaps(t.rect, f.rect)) hits.push(`${t.id} on face ${f.id}`);
    if (clock && overlaps(t.rect, clock)) hits.push(`${t.id} under the clock`);
  }
  for (const b of boards)
    if (clock && overlaps(b.rect, clock)) hits.push(`${b.id} under the clock`);
  return { tags: tags.length, hits };
}

for (const dpr of [1, 2] as const) {
  test.describe(`Standalone / monitor office tags at dpr ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test(`Q3.2 in the monitor scene at 1920 no tag covers another or a face, with the lead's sheet shut and open (dpr ${dpr}) @area:standalone`, async ({
      page,
      standalone,
    }) => {
      void standalone;
      await page.setViewportSize({ width: 1920, height: 1080 });
      await deliver(page, monitorSceneMessages(Date.now()));
      await select(page, null);
      // Every agent tagged, no helper (their lead is not selected).
      await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT);
      // Seats settle within a second; then the layout holds.
      await page.waitForTimeout(1_500);
      expect((await tagCollisions(page)).hits).toEqual([]);

      // The lead's sheet open: its helpers' tags join in.
      await select(page, SCENE_LEAD_ID, true);
      await expect
        .poll(async () => (await tagCollisions(page)).tags)
        .toBe(SCENE_AGENT_COUNT + SCENE_HELPER_COUNT);
      await page.waitForTimeout(1_500);
      expect((await tagCollisions(page)).hits).toEqual([]);
    });
  });
}
