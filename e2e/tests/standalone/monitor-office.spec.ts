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
    getDeskHighlights?: () => Array<{
      id: number;
      tone: 'wait' | 'stuck';
      rect: Box;
      /** The desk unit as the canvas drew it, page CSS px. */
      page: Box | null;
    }>;
    getAgentSeats?: () => Array<{ id: number; seatId: string | null }>;
    getSeats?: () => Array<{ uid: string; col: number; row: number }>;
    getTagLayout?: () => TagLayout;
  };
};

interface TagLayout {
  tags: Array<{ id: number; rect: Box; anchor: Box; leader: boolean }>;
  heads: Array<{ id: number; rect: Box }>;
  rooms: Array<{ label: string; rect: Box }>;
  banners: Array<{ leadId: number; rect: Box; onWall: boolean; band: Box | null }>;
  plaques: Array<{ label: string; rect: Box }>;
}

async function tagLayout(page: Page): Promise<TagLayout> {
  return page.evaluate(() => {
    const hooks = (window as OfficeWindow).__pixelAgentsTestHooks;
    if (!hooks?.getTagLayout) throw new Error('tag layout hook missing');
    return hooks.getTagLayout();
  });
}

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

/** Every drawn tag (DOM) against every other and every face (the hook: faces are canvas), and the
 *  tags, banners and plaques against the stage clock drawn over the map. */
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

      // The lead's sheet open: its helpers' tags join in, one word on paper each.
      await select(page, SCENE_LEAD_ID, true);
      await expect
        .poll(async () => (await tagCollisions(page)).tags)
        .toBe(SCENE_AGENT_COUNT + SCENE_HELPER_COUNT);
      const helperWords = await page
        .locator('[data-testid="agent-overlay"] .nameplate-tag[data-form="helper"]')
        .allTextContents();
      expect(helperWords).toHaveLength(SCENE_HELPER_COUNT);
      for (const w of helperWords) expect(w.trim()).toMatch(/^\S+$/);
      await page.waitForTimeout(1_500);
      expect((await tagCollisions(page)).hits).toEqual([]);
    });
  });
}

/** How tall type reads in FS Pixel Sans: caps are 7/16 em, where a common font's are about 0.7,
 *  so a size read as `px` needs `px x 0.7 x 16/7` CSS px (the rail's rule, Q2.1). */
const readsAs = (cssPx: number): number => (cssPx * 7) / 16 / 0.7;

/** The gap between two boxes, px: 0 when they meet. */
const gapBetween = (a: Box, b: Box): number =>
  Math.hypot(
    Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)),
    Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)),
  );

const insideBox = (r: Box, b: Box): boolean =>
  r.x >= b.x - 0.5 &&
  r.y >= b.y - 0.5 &&
  r.x + r.w <= b.x + b.w + 0.5 &&
  r.y + r.h <= b.y + b.h + 0.5;

test.describe('Standalone / monitor office text', () => {
  // R1.1: from across the room at 1920 the name reads 14 px, the state and the alert tab 12.
  test('R1.1 at 1920 the tags read 14 px names and 12 px states and alert tabs @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await deliver(page, monitorSceneMessages(Date.now()));
    await select(page, null);
    // The fit lands a frame after the first one, at zoom 3 (1.5x): the type follows the map.
    await expect(page.getByTestId('zoom-level')).toHaveText('1.5x');
    await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT);
    const measure = () =>
      page.evaluate(() => {
        const px = (sel: string) =>
          [...document.querySelectorAll(sel)].map((el) =>
            parseFloat(getComputedStyle(el).fontSize),
          );
        const tag = '[data-testid="agent-overlay"] .nameplate-tag';
        return {
          names: px(`${tag} [data-testid="plate-name"]`),
          states: px(`${tag} [data-testid="plate-state"]`),
          alerts: px(`${tag} [data-testid="plate-alert"]`),
        };
      });
    // Two need you and one is stuck in the scene: three alert tabs, on the tags themselves. The
    // sizes settle with the fit, so poll them instead of waiting a fixed time.
    await expect
      .poll(async () => {
        const m = await measure();
        return {
          counts: [m.names.length, m.alerts.length],
          names: m.names.every((n) => readsAs(n) >= 14),
          small: [...m.states, ...m.alerts].every((v) => readsAs(v) >= 12),
          states: m.states.length > 0,
        };
      })
      .toEqual({ counts: [SCENE_AGENT_COUNT, 3], names: true, small: true, states: true });
  });

  for (const [width, height] of [
    [1920, 1080],
    [1280, 800],
  ] as const) {
    // R1.2: a tag stays in the room its owner stands in, and within 24 px of the desk or sprite it
    // hangs from unless an ink leader joins them.
    test(`R1.2 at ${width} every tag stays in its room and near its agent, or hangs from a leader @area:standalone`, async ({
      page,
      standalone,
    }) => {
      void standalone;
      await page.setViewportSize({ width, height });
      await deliver(page, monitorSceneMessages(Date.now()));
      await select(page, null);
      await expect.poll(async () => (await tagLayout(page)).tags.length).toBe(SCENE_AGENT_COUNT);
      // The lead's sheet open, so its helpers' tags join in (a bare selection shows its full box).
      await select(page, SCENE_LEAD_ID, true);
      await expect
        .poll(async () => (await tagLayout(page)).tags.length)
        .toBe(SCENE_AGENT_COUNT + SCENE_HELPER_COUNT);
      await page.waitForTimeout(1_500);
      const { tags, heads, rooms } = await tagLayout(page);
      const leaders = await page
        .locator('[data-testid="tag-leader"]')
        .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-agent-id'))));
      const far: string[] = [];
      for (const t of tags) {
        const face = heads.find((h) => h.id === t.id);
        // Its owner's room, as the layout draws it; anywhere when the face is in none.
        const centre = { x: face!.rect.x + face!.rect.w / 2, y: face!.rect.y + face!.rect.h / 2 };
        const room = rooms.find((r) => insideBox({ ...centre, w: 0, h: 0 }, r.rect));
        if (room)
          expect(insideBox(t.rect, room.rect), `tag ${t.id} inside ${room.label}`).toBe(true);
        // What it hangs from is its own agent: the desk unit or the sprite holds its face.
        expect(face && insideBox(face.rect, t.anchor), `tag ${t.id} hangs from its agent`).toBe(
          true,
        );
        if (t.leader) expect(leaders, `tag ${t.id} draws its leader`).toContain(t.id);
        else if (gapBetween(t.rect, t.anchor) > 24)
          far.push(`${t.id}: ${gapBetween(t.rect, t.anchor)}`);
      }
      expect(far).toEqual([]);
    });
  }

  // R1.4: the workflow's banner hangs on a wall at the laptop size too (zoom 2), never over desks.
  test('R1.4 at 1280x800 the crew banner hangs inside its wall band @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1280, height: 800 });
    await deliver(page, monitorSceneMessages(Date.now()));
    await select(page, null);
    await expect(page.getByTestId('zoom-level')).toHaveText('1x');
    await expect.poll(async () => (await tagLayout(page)).banners.length).toBe(1);
    const [banner] = (await tagLayout(page)).banners;
    expect(banner.onWall).toBe(true);
    expect(banner.band).not.toBeNull();
    expect(insideBox(banner.rect, banner.band!)).toBe(true);
  });

  // P-C9: a room plaque reads from across the room too: its title is as readable as a state.
  test('R1.6 at 1920 every room plaque title reads 12 px at least @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await deliver(page, monitorSceneMessages(Date.now()));
    await expect(page.getByTestId('zoom-level')).toHaveText('1.5x');
    await expect.poll(async () => (await tagLayout(page)).plaques.length).toBeGreaterThan(0);
    const titles = await page.locator('[data-testid="room-plaque-title"]').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent?.trim() ?? '',
        px: parseFloat(getComputedStyle(el).fontSize),
      })),
    );
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(t.text).not.toBe('');
      expect(readsAs(t.px)).toBeGreaterThanOrEqual(12);
    }
  });
});

const dist = (p: { x: number; y: number }, r: Box): number =>
  Math.hypot(Math.max(0, r.x - p.x, p.x - (r.x + r.w)), Math.max(0, r.y - p.y, p.y - (r.y + r.h)));

/** How much nearer its own face than any other a tag's facing edge must sit. Two heads side by side
 *  on the sofa (32 px wide at 1280) leave a tag one step up from its owner barely 7 px ahead. */
const CLEARLY_NEARER_PX = 4;

/** The desk-seated agents of the monitor scene whose tags never need a leader. Barbara (5) is left
 *  out: her two sub-agents stand beside her, so her tag steps 24 px aside and hangs from one. */
const SEATED_IDS = [1, 2, 3, 4];

/** Everything a tag says about whose it is, read off the page: the drawn tags (DOM), every face and
 *  anchor (the hook), the leaders (DOM). */
async function ownership(page: Page) {
  return page.evaluate(() => {
    const layout = (window as OfficeWindow).__pixelAgentsTestHooks!.getTagLayout!();
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      layout,
      tags: [...document.querySelectorAll('[data-testid="agent-overlay"] .nameplate-tag')].map(
        (el) => ({
          id: Number(el.closest('[data-testid="agent-overlay"]')?.getAttribute('data-agent-id')),
          rect: box(el),
        }),
      ),
      leaders: [...document.querySelectorAll('[data-testid="tag-leader"]')].map((el) => ({
        id: Number(el.getAttribute('data-agent-id')),
        rect: box(el),
      })),
    };
  });
}

for (const [width, height, dpr] of [
  [1920, 1080, 1],
  [1920, 1080, 2],
  [1280, 800, 1],
] as const) {
  test.describe(`Standalone / monitor office tag owners at ${width} dpr ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    // R1.7: from across the room the tag is read as its owner's: its facing edge is clearly nearer
    // the owner's face than any other face, a leader touches the owner and crosses no other face,
    // and an agent at a desk needs no leader at all.
    for (const sheet of [false, true]) {
      test(`R1.7 every tag is nearest its own agent, with the lead's sheet ${sheet ? 'open' : 'shut'} @area:standalone`, async ({
        page,
        standalone,
      }) => {
        void standalone;
        await page.setViewportSize({ width, height });
        await deliver(page, monitorSceneMessages(Date.now()));
        await select(page, null);
        await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT);
        if (sheet) await select(page, SCENE_LEAD_ID, true);
        const count = sheet ? SCENE_AGENT_COUNT + SCENE_HELPER_COUNT : SCENE_AGENT_COUNT;
        await expect.poll(async () => (await tagCollisions(page)).tags).toBe(count);
        await page.waitForTimeout(1_500);
        const { layout, tags, leaders } = await ownership(page);
        const leaderIds = leaders.map((l) => l.id);
        const faces = layout.heads;
        const bad: string[] = [];
        for (const t of tags) {
          if (leaderIds.includes(t.id)) continue;
          const own = faces.find((f) => f.id === t.id)!;
          const above = t.rect.y + t.rect.h <= own.rect.y + own.rect.h / 2;
          const at = {
            x: Math.max(t.rect.x, Math.min(own.rect.x + own.rect.w / 2, t.rect.x + t.rect.w)),
            y: above ? t.rect.y + t.rect.h : t.rect.y,
          };
          const mine = dist(at, own.rect);
          for (const f of faces.filter((o) => o.id !== t.id)) {
            if (dist(at, f.rect) < mine + CLEARLY_NEARER_PX)
              bad.push(`tag ${t.id} is not clearly nearer itself than ${f.id}`);
          }
        }
        for (const l of leaders) {
          const anchor = layout.tags.find((t) => t.id === l.id)?.anchor;
          if (!anchor || gapBetween(l.rect, anchor) > 2)
            bad.push(`leader ${l.id} misses its owner`);
          for (const f of faces.filter((o) => o.id !== l.id))
            if (overlaps(l.rect, f.rect)) bad.push(`leader ${l.id} crosses face ${f.id}`);
        }
        for (const id of SEATED_IDS) {
          if (leaderIds.includes(id)) bad.push(`agent ${id} at its desk hangs from a leader`);
        }
        expect(bad).toEqual([]);
      });
    }
  });
}

test.describe('Standalone / monitor office lit desk tags', () => {
  const outlinePx = 4;
  const grown = (b: Box): Box => ({
    x: b.x - outlinePx,
    y: b.y - outlinePx,
    w: b.w + 2 * outlinePx,
    h: b.h + 2 * outlinePx,
  });
  // The layout's own box: the DOM tag bobs a couple of px and its hard shadow sits inside the box.
  const tagOf = async (page: Page, id: number): Promise<Box> => {
    const t = (await tagLayout(page)).tags.find((l) => l.id === id);
    if (!t) throw new Error(`no tag for ${id}`);
    return t.rect;
  };
  const outlineOf = (page: Page, id: number): Promise<Box> =>
    page.evaluate((agentId) => {
      const h = (window as OfficeWindow).__pixelAgentsTestHooks!.getDeskHighlights!().find(
        (d) => d.id === agentId,
      );
      if (!h?.page) throw new Error(`no lit desk for ${agentId}`);
      return h.page;
    }, id);

  // R1.8: the lit desk's tag sits on its frame: the alert tab, the medal and the name, on the top
  // edge, or under the bottom edge for the agent facing up. No badge exists any more.
  test('R1.8 a lit desk carries its alert on its tag, pinned to the frame @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await deliver(page, monitorSceneMessages(Date.now()));
    await select(page, null);
    await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT);
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId('desk-badge')).toHaveCount(0);
    for (const id of [1, 2]) {
      await expect(
        page.locator(`[data-testid="agent-overlay"][data-agent-id="${id}"] .plate-alert`),
      ).toHaveCount(1);
    }
    // Ada faces the desk: her tag's bottom rests on the frame's top edge. Alan faces away: his
    // tag's top hangs from the frame's bottom edge.
    const ada = await tagOf(page, 1);
    const adaFrame = grown(await outlineOf(page, 1));
    expect(Math.abs(ada.y + ada.h - adaFrame.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(ada.x - adaFrame.x)).toBeLessThanOrEqual(1);
    const alan = await tagOf(page, 2);
    const alanFrame = grown(await outlineOf(page, 2));
    expect(Math.abs(alan.y - (alanFrame.y + alanFrame.h))).toBeLessThanOrEqual(1);
    expect(Math.abs(alan.x - alanFrame.x)).toBeLessThanOrEqual(1);
  });

  test('R1.9 a label wider than its frame stays pinned at the frame corner, with no leader @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    const id = 9301;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await deliver(page, [
      ...monitorSceneMessages(Date.now()),
      { type: 'agentCreated', id, folderName: 'repo' },
      {
        type: 'agentRoster',
        id,
        memberId: 'monitor-long',
        name: 'Bartholomew Montgomery-Fitzgerald',
        level: 5,
        xp: 1,
        xpToNext: 10,
        streak: 0,
        mood: 'neutral',
      },
      {
        type: 'agentToolStart',
        id,
        toolId: 'long-1',
        status: 'Running: git push',
        toolName: 'Bash',
      },
      { type: 'agentToolPermission', id, permissionSince: Date.now() - 60_000 },
    ]);
    await select(page, null);
    await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT + 1);
    await page.waitForTimeout(1_500);
    const tag = await tagOf(page, id);
    const frame = grown(await outlineOf(page, id));
    expect(tag.w).toBeGreaterThan(frame.w);
    // On the top edge, or the bottom one for a seat facing up; at the corner, left or (when the
    // room ends first) right.
    const onEdge =
      Math.abs(tag.y + tag.h - frame.y) <= 1 || Math.abs(tag.y - (frame.y + frame.h)) <= 1;
    const atCorner =
      Math.abs(tag.x - frame.x) <= 1 || Math.abs(tag.x + tag.w - (frame.x + frame.w)) <= 1;
    expect({ onEdge, atCorner }).toEqual({ onEdge: true, atCorner: true });
    await expect(page.locator(`[data-testid="tag-leader"][data-agent-id="${id}"]`)).toHaveCount(0);
  });

  // R1.10: privacy masks a helper's command word: it is session text.
  test('R1.10 with privacy on a helper running a command shows its word under the mask @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await deliver(page, monitorSceneMessages(Date.now()));
    await select(page, null);
    await expect.poll(async () => (await tagCollisions(page)).tags).toBe(SCENE_AGENT_COUNT);
    await select(page, SCENE_LEAD_ID, true);
    await expect
      .poll(async () => (await tagCollisions(page)).tags)
      .toBe(SCENE_AGENT_COUNT + SCENE_HELPER_COUNT);
    // One helper starts a command, as the scene's server would stream it.
    await deliver(page, [
      {
        type: 'subagentToolStart',
        id: SCENE_LEAD_ID,
        parentToolId: 'wf:monitor-run:a2',
        toolId: 'helper-bash',
        status: 'Running: git push',
      },
    ]);
    await page.keyboard.press('p');
    const word = page.locator(
      '[data-testid="agent-overlay"] .nameplate-tag[data-form="helper"][data-plate-state="cmd"] .pv',
    );
    await expect(word).toHaveCount(1);
    await expect(word).toHaveText('git');
  });
});
