/**
 * The README hero scene: four named agents in one room, staged for a screenshot or a GIF. Also the
 * monitor scene (`?scene=monitor`), at the end of the file.
 *
 * Dev-only. Reached through `?scene=hero` or `?scene=monitor` on the Vite dev SPA and imported by
 * browserMock.ts alone, so the standalone server build and the VS Code build never contain it. No
 * DOM here: the module returns messages and drives an OfficeState-shaped object through injected
 * callbacks.
 */

import { WORKFLOW_PARENT_TOOL_ID_PREFIX } from '../../core/src/constants.js';
import type { ServerMessage } from '../../core/src/messages.js';
import { FX_POP_MS, NAP_AFTER_IDLE_SEC } from './constants.js';
import { fitView } from './office/camera.js';
import { officeNow, overrideOfficeClock } from './office/clock.js';
import { requestRedraw } from './office/engine/gameLoop.js';
import type { ActiveFx } from './office/fx/fxEngine.js';
import { forceFullPlates } from './office/nameplate.js';
import { IdlePose } from './office/types.js';

/** Layout the scene loads instead of the bundled default, relative to the assets base. */
export const HERO_LAYOUT_PATH = 'scenes/hero-layout.json';

/**
 * The zoom that fills the viewport with the room: the app's own whole-map fit (the layout is the
 * cropped room, so the whole map is the room). Viewport in CSS px.
 */
export function heroZoomFor(
  map: { cols: number; rows: number },
  viewport: { width: number; height: number },
  dpr: number,
): number {
  return fitView(null, map, viewport, dpr).zoom;
}

/** Morning light: the window shafts are at their .30 peak (the curve holds it until 09:00 and fades after). */
export const HERO_HOUR = 9;
export const HERO_MINUTE = 30;

/**
 * A pop is fully opaque for the first two thirds of FX_POP_MS and gone by the end, so it is
 * replaced before it fades past half opacity (t = 5/6). Only one is ever on screen.
 */
export const HERO_XP_POP_MS = Math.floor((FX_POP_MS * 5) / 6);
const STAGE_TICK_MS = 250;
/** Just under the storm's 20 s life, so the cloud is replaced before it starts to fade. */
export const HERO_STORM_RESTART_MS = 17_000;
/** Long enough for one frame to see the calm mood, which is what restarts the storm. */
const STORM_GAP_MS = 30;

export interface HeroSceneOptions {
  /** `&hud=0` hides the HUD card. */
  hud: boolean;
}

/** `?scene=hero` on the dev SPA turns the scene on; anything else leaves the dev mock alone. */
export function parseHeroScene(search: string): HeroSceneOptions | null {
  const params = new URLSearchParams(search);
  if (params.get('scene') !== 'hero') return null;
  return { hud: params.get('hud') !== '0' };
}

/** The tier numbers are the model tiers: 1 smallest to 4 largest (4 = crown and sparkles). */
interface HeroAgent {
  id: number;
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  streak: number;
  mood: 'neutral' | 'frustrated';
  tier: 1 | 2 | 3 | 4;
  palette: number;
  title: string;
  /** What it is doing; null is idle (the nap). */
  tool: { status: string; toolName: string } | null;
}

/**
 * Agent 1 is the room's hero (highest level, tier 3), so the owl lands on its desk. The folder is
 * a made-up one: the scene carries no real session data.
 */
export const HERO_AGENTS: readonly HeroAgent[] = [
  {
    id: 1,
    name: 'Ada',
    level: 12,
    xp: 640,
    xpToNext: 900,
    streak: 5,
    mood: 'neutral',
    tier: 3,
    palette: 0,
    title: 'Ship the checkout fix',
    tool: { status: 'Editing checkout.ts', toolName: 'Edit' },
  },
  {
    id: 2,
    name: 'Alan',
    level: 7,
    xp: 210,
    xpToNext: 500,
    streak: 2,
    mood: 'neutral',
    tier: 2,
    palette: 1,
    title: 'Read the webhook docs',
    tool: { status: 'Reading webhooks.md', toolName: 'Read' },
  },
  {
    id: 3,
    name: 'Grace',
    level: 9,
    xp: 380,
    xpToNext: 700,
    streak: 0,
    mood: 'frustrated',
    tier: 4,
    palette: 2,
    title: 'Fix the flaky test',
    tool: { status: 'Running: npm test', toolName: 'Bash' },
  },
  {
    id: 4,
    name: 'Linus',
    level: 4,
    xp: 90,
    xpToNext: 300,
    streak: 1,
    mood: 'neutral',
    tier: 1,
    palette: 3,
    title: 'Triage the backlog',
    tool: null,
  },
];

/**
 * Seats by chair uid in hero-layout.json, all on the top row and face-on: the nap pose is only
 * drawn from the front, and the storm cloud is anchored above the plate stack (over Grace's plate,
 * never in her head).
 */
export const HERO_SEATS: Readonly<Record<number, string>> = {
  1: 'f-v9-0008',
  2: 'f-v9-0014',
  3: 'f-v9-0020',
  4: 'f-v9-0002',
};

/** Agent that earns the "+120 PR" pop every HERO_XP_POP_MS. */
export const HERO_XP_AGENT_ID = 1;
export const HERO_XP_AMOUNT = 120;
export const HERO_XP_SIGNAL = 'pr';
/** Agent that naps. */
export const HERO_NAP_AGENT_ID = 4;

function rosterMessage(a: HeroAgent, mood: HeroAgent['mood']): ServerMessage {
  return {
    type: 'agentRoster',
    id: a.id,
    memberId: `hero-${a.name.toLowerCase()}`,
    name: a.name,
    level: a.level,
    xp: a.xp,
    xpToNext: a.xpToNext,
    streak: a.streak,
    mood,
  };
}

/** What the scene sends after the layout loads, in the order the real server would. */
export function heroMessages(): ServerMessage[] {
  const out: ServerMessage[] = [];
  for (const a of HERO_AGENTS) {
    out.push({ type: 'agentCreated', id: a.id, palette: a.palette, hueShift: 0 });
    out.push({ type: 'agentModel', id: a.id, model: `hero-tier-${a.tier}`, tier: a.tier });
    out.push({ type: 'agentSessionTitle', id: a.id, title: a.title });
    out.push(rosterMessage(a, a.mood));
    if (a.tool) {
      out.push({
        type: 'agentToolStart',
        id: a.id,
        toolId: `hero-tool-${a.id}`,
        status: a.tool.status,
        toolName: a.tool.toolName,
      });
    } else {
      out.push({ type: 'agentStatus', id: a.id, status: 'idle' });
    }
  }
  return out;
}

/** 09:30 today; the seconds follow the real clock so lights and shimmer keep moving. */
export function heroClock(realMs: number): Date {
  const d = new Date(realMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    HERO_HOUR,
    HERO_MINUTE,
    d.getSeconds(),
  );
}

/** The slice of OfficeState the stage touches. */
export interface HeroOffice {
  getLayout: () => { cols: number; rows: number };
  /** Pops are pushed here directly: the engine's per-agent cooldown would drop all but one in ten seconds. */
  fx: { active: ActiveFx[] };
  addAgent: (
    id: number,
    palette: number,
    hueShift: number,
    seatId: string,
    skipSpawnEffect: boolean,
  ) => void;
  characters: ReadonlyMap<number, { idleSec: number; pose: IdlePose }>;
  selectedAgentId: number | null;
}

/** Seat the four agents before their `agentCreated` arrives (the handler keeps an existing one). */
export function seatHeroAgents(os: Pick<HeroOffice, 'addAgent'>): void {
  for (const a of HERO_AGENTS) os.addAgent(a.id, a.palette, 0, HERO_SEATS[a.id], true);
}

/**
 * Keeps the scene staged: pins the clock, re-fires the XP pop, deselects the agent the last
 * `agentCreated` selected (a selected plate expands to the full box), and holds the napper asleep
 * (it normally takes ten idle minutes and a pose re-check). Returns a function that stops it all.
 */
export function startHeroStage(
  os: HeroOffice,
  dispatch: (msg: ServerMessage) => void,
  nowMs: () => number = Date.now,
): () => void {
  overrideOfficeClock(() => heroClock(nowMs()));
  forceFullPlates(true);
  const pop = (): void => {
    // One element per pop: the new one replaces the old one that is fading, never stacks over it.
    os.fx.active = os.fx.active.filter(
      (a) => !(a.kind === 'pop' && a.agentId === HERO_XP_AGENT_ID),
    );
    os.fx.active.push({
      kind: 'pop',
      agentId: HERO_XP_AGENT_ID,
      startedAt: nowMs(),
      amount: HERO_XP_AMOUNT,
      signal: HERO_XP_SIGNAL,
      level: 0,
    });
    requestRedraw();
  };
  const hold = (): void => {
    os.selectedAgentId = null;
    const napper = os.characters.get(HERO_NAP_AGENT_ID);
    if (napper) {
      // The pose is only re-decided a few seconds after the status changes; the scene must nap at once.
      napper.pose = IdlePose.NAPPING;
      if (napper.idleSec < NAP_AFTER_IDLE_SEC) napper.idleSec = NAP_AFTER_IDLE_SEC;
    }
    requestRedraw();
  };
  // The storm cloud lasts FX_STORM_MS from the moment a mood begins; flipping the mood restarts it.
  const restormAgent = HERO_AGENTS.find((a) => a.mood === 'frustrated');
  const setMood = (mood: 'neutral' | 'frustrated'): void => {
    if (!restormAgent) return;
    dispatch(rosterMessage(restormAgent, mood));
  };
  const restorm = (): void => {
    setMood('neutral');
    stormGap = setTimeout(() => setMood('frustrated'), STORM_GAP_MS);
  };
  let stormGap: ReturnType<typeof setTimeout> | undefined;
  pop();
  const stormTimer = setInterval(restorm, HERO_STORM_RESTART_MS);
  const popTimer = setInterval(pop, HERO_XP_POP_MS);
  const holdTimer = setInterval(hold, STAGE_TICK_MS);
  return () => {
    clearInterval(popTimer);
    clearInterval(holdTimer);
    clearInterval(stormTimer);
    clearTimeout(stormGap);
    overrideOfficeClock(null);
    forceFullPlates(false);
  };
}

// ── The monitor scene (`?scene=monitor`) ─────────────────────────────────────────

/**
 * Seven agents in the bundled office, staged for the monitor: two waiting on the user, one stuck,
 * a lead running a workflow, one with sub-agents, a loop asleep and one idle. Every name, folder,
 * branch and title is made up: the scene carries no real session data. Every time is relative to
 * the scene's fixed clock, so the minutes read the same in every screenshot.
 */

export const MONITOR_HOUR = 15;
export const MONITOR_MINUTE = 20;
const MIN_MS = 60_000;

/** `?scene=monitor` on the dev SPA turns the scene on; `&hud=0` hides the HUD and the monitor. */
export function parseMonitorScene(search: string): HeroSceneOptions | null {
  const params = new URLSearchParams(search);
  if (params.get('scene') !== 'monitor') return null;
  return { hud: params.get('hud') !== '0' };
}

/** 15:20 today; the seconds follow the real clock, like the hero scene's. */
export function monitorClock(realMs: number): Date {
  const d = new Date(realMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    MONITOR_HOUR,
    MONITOR_MINUTE,
    d.getSeconds(),
  );
}

interface MonitorAgent {
  id: number;
  name: string;
  folder: string;
  branch: string;
  title: string;
  tier: 1 | 2 | 3 | 4;
  contextTokens: number;
  maxContextTokens: number;
  /** Minutes before the scene's clock the transcript started. */
  startedMinAgo: number;
  costUsd?: number;
}

export const MONITOR_AGENTS: readonly MonitorAgent[] = [
  {
    id: 1,
    name: 'Ada',
    folder: 'billing-api',
    branch: 'fix/retry-backoff',
    title: 'Retry failed webhooks',
    tier: 4,
    contextTokens: 620_000,
    maxContextTokens: 1_000_000,
    startedMinAgo: 154,
    costUsd: 4.12,
  },
  {
    id: 2,
    name: 'Alan',
    folder: 'web-app',
    branch: 'feat/date-picker',
    title: 'Pick a date library',
    tier: 2,
    contextTokens: 68_000,
    maxContextTokens: 200_000,
    startedMinAgo: 47,
    costUsd: 0.86,
  },
  {
    id: 3,
    name: 'Grace',
    folder: 'checkout-service',
    branch: 'fix/flaky-cart-test',
    title: 'Fix the flaky cart test',
    tier: 3,
    contextTokens: 156_000,
    maxContextTokens: 200_000,
    startedMinAgo: 95,
    costUsd: 2.4,
  },
  {
    id: 4,
    name: 'Linus',
    folder: 'api-gateway',
    branch: 'review/payments-pr',
    title: 'Review the payments PR',
    tier: 4,
    contextTokens: 910_000,
    maxContextTokens: 1_000_000,
    startedMinAgo: 63,
    costUsd: 6.75,
  },
  {
    id: 5,
    name: 'Barbara',
    folder: 'data-pipeline',
    branch: 'feat/events-v2',
    title: 'Migrate events to v2',
    tier: 3,
    contextTokens: 90_000,
    maxContextTokens: 200_000,
    startedMinAgo: 38,
  },
  {
    id: 6,
    name: 'Dennis',
    folder: 'infra',
    branch: 'chore/deps-sweep',
    title: 'Nightly dependency sweep',
    tier: 1,
    contextTokens: 36_000,
    maxContextTokens: 200_000,
    startedMinAgo: 212,
    costUsd: 0.31,
  },
  {
    id: 7,
    name: 'Hedy',
    folder: 'mobile-app',
    branch: 'main',
    title: 'Tidy the onboarding copy',
    tier: 2,
    contextTokens: 54_000,
    maxContextTokens: 200_000,
    startedMinAgo: 88,
  },
];

/** The workflow the lead (Linus) runs: one agent done in `scan`, three at work in `review`. */
export const MONITOR_WORKFLOW = {
  leadId: 4,
  runId: 'monitor-run',
  name: 'review-pr',
  helpers: [
    { agentId: 'a2', label: 'security pass', group: 'review', startedMinAgo: 17 },
    { agentId: 'a3', label: 'api contract check', group: 'review', startedMinAgo: 12 },
    { agentId: 'a4', label: 'test coverage', group: 'review', startedMinAgo: 6 },
  ],
} as const;

/** Barbara's two sub-agents: the spawn's tool id, task, current tool, minutes since it started. */
const MONITOR_SUBAGENTS = [
  ['monitor-5-sub-1', 'Map the call sites', 'Reading events.ts', 11],
  ['monitor-5-sub-2', 'Draft the migration', 'Editing migrate.sql', 4],
] as const;

/**
 * When, on the scene's clock, the helper a message creates started, or undefined for a message
 * that creates none. The wire carries no helper start: the page stamps one only on a spawn it sees
 * live, so the stage dispatches these at that earlier office time.
 */
export function monitorHelperStart(msg: ServerMessage, baseMs: number): number | undefined {
  let min: number | undefined;
  if (msg.type === 'subagentPresent') {
    const wf = MONITOR_WORKFLOW;
    min = wf.helpers.find(
      (h) => msg.parentToolId === `${WORKFLOW_PARENT_TOOL_ID_PREFIX}${wf.runId}:${h.agentId}`,
    )?.startedMinAgo;
  } else if (msg.type === 'agentToolStart') {
    min = MONITOR_SUBAGENTS.find(([toolId]) => msg.toolId === toolId)?.[3];
  }
  return min === undefined ? undefined : baseMs - min * MIN_MS;
}

/**
 * What the scene sends after the layout loads, in the order the real server would, with every
 * time relative to `baseMs` (the scene's clock, on the minute).
 */
export function monitorMessages(baseMs: number): ServerMessage[] {
  const ago = (min: number): number => baseMs - min * MIN_MS;
  const out: ServerMessage[] = [
    {
      type: 'providerCapabilities',
      readingTools: ['Read', 'Grep', 'Glob'],
      subagentToolNames: ['Task', 'Agent'],
    },
    // The status line wrapper is on, so the official limits are live.
    { type: 'hooksStatus', providerId: 'claude-statusline', installed: true },
    {
      type: 'usageLimits',
      receivedAt: ago(1),
      fiveHour: { usedPercentage: 64, resetsAt: baseMs + 130 * MIN_MS },
      sevenDay: { usedPercentage: 41, resetsAt: baseMs + 3 * 24 * 60 * MIN_MS },
    },
  ];
  for (const a of MONITOR_AGENTS) {
    out.push({
      type: 'agentCreated',
      id: a.id,
      folderName: a.folder,
      palette: a.id - 1,
      hueShift: 0,
    });
    out.push({ type: 'agentModel', id: a.id, model: `monitor-tier-${a.tier}`, tier: a.tier });
    out.push({ type: 'agentSessionTitle', id: a.id, title: a.title });
    out.push({
      type: 'agentContextUsage',
      id: a.id,
      contextTokens: a.contextTokens,
      maxContextTokens: a.maxContextTokens,
    });
    out.push({
      type: 'agentRoster',
      id: a.id,
      memberId: `monitor-${a.name.toLowerCase()}`,
      name: a.name,
      level: 3 + a.id,
      xp: 40 * a.id,
      xpToNext: 400,
      streak: a.id % 3,
      mood: a.id === 3 ? 'frustrated' : 'neutral',
    });
    out.push({
      type: 'agentSession',
      id: a.id,
      startedAt: ago(a.startedMinAgo),
      branch: a.branch,
      sessionId8: `5e55${a.id.toString(16).padStart(4, '0')}`,
      ...(a.costUsd === undefined ? {} : { costUsd: a.costUsd, costAt: ago(2) }),
    });
  }

  // Ada: waiting on a permission prompt for `git push`, 12 minutes.
  out.push({
    type: 'agentToolStart',
    id: 1,
    toolId: 'monitor-1-push',
    status: 'Running: git push',
    toolName: 'Bash',
  });
  out.push({ type: 'agentStatus', id: 1, status: 'active', since: ago(31) });
  out.push({ type: 'agentToolPermission', id: 1, permissionSince: ago(12) });

  // Alan: stopped on a question, 4 minutes.
  out.push({ type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true, since: ago(4) });

  // Grace: the same tests failing four runs in a row.
  out.push({
    type: 'agentToolStart',
    id: 3,
    toolId: 'monitor-3-test',
    status: 'Running: npm test',
    toolName: 'Bash',
  });
  out.push({ type: 'agentStatus', id: 3, status: 'active', since: ago(26) });
  out.push({ type: 'agentTests', id: 3, passed: 41, failed: 3, at: ago(1) });
  out.push({
    type: 'agentHealth',
    id: 3,
    state: 'stuck',
    reason: 'tests_failing_no_edits',
    count: 4,
    since: ago(9),
  });

  // Linus: leads the `review-pr` workflow, four agents started, one done.
  const wf = MONITOR_WORKFLOW;
  out.push({
    type: 'agentToolStart',
    id: wf.leadId,
    toolId: 'monitor-4-workflow',
    status: 'Using Workflow',
    toolName: 'Workflow',
  });
  out.push({ type: 'agentStatus', id: wf.leadId, status: 'active', since: ago(21) });
  for (const h of wf.helpers) {
    out.push({
      type: 'subagentPresent',
      id: wf.leadId,
      parentToolId: `${WORKFLOW_PARENT_TOOL_ID_PREFIX}${wf.runId}:${h.agentId}`,
      label: h.label,
      group: h.group,
    });
  }
  // One of them at a tool, so the inspector's rows are not three identical `thinking` chips.
  out.push({
    type: 'subagentToolStart',
    id: wf.leadId,
    parentToolId: `${WORKFLOW_PARENT_TOOL_ID_PREFIX}${wf.runId}:a3`,
    toolId: 'monitor-4-a3-run',
    status: 'Running: npm run lint:openapi',
  });
  out.push({
    type: 'workflowRun',
    id: wf.leadId,
    runId: wf.runId,
    status: 'running',
    name: wf.name,
    phases: [
      { name: 'scan', started: 1, done: 1 },
      { name: 'review', started: 3, done: 0 },
    ],
    started: 4,
    done: 1,
    since: ago(21),
  });
  out.push({
    type: 'agentArtifacts',
    id: wf.leadId,
    count: 2,
    complete: true,
    items: [
      {
        title: 'Payments PR review notes',
        url: 'https://example.com/a/review-notes',
        publishes: 2,
        at: ago(6),
      },
      { title: 'Risk matrix', url: 'https://example.com/a/risk-matrix', publishes: 1, at: ago(18) },
    ],
  });

  // Barbara: two sub-agents at work.
  for (const [toolId, task, tool] of MONITOR_SUBAGENTS) {
    out.push({
      type: 'agentToolStart',
      id: 5,
      toolId,
      status: `Subtask: ${task}`,
      toolName: 'Agent',
    });
    out.push({
      type: 'subagentToolStart',
      id: 5,
      parentToolId: toolId,
      toolId: `${toolId}-tool`,
      status: tool,
    });
  }
  out.push({ type: 'agentStatus', id: 5, status: 'active', since: ago(14) });
  out.push({
    type: 'agentArtifacts',
    id: 5,
    count: 3,
    complete: true,
    items: [
      {
        title: 'Events v2 schema',
        url: 'https://example.com/a/events-schema',
        publishes: 3,
        at: ago(9),
      },
      {
        title: 'Migration plan',
        url: 'https://example.com/a/migration-plan',
        publishes: 1,
        at: ago(25),
      },
      {
        title: 'Rollback checklist',
        url: 'https://example.com/a/rollback',
        publishes: 1,
        at: ago(33),
      },
    ],
  });

  // Dennis: a loop asleep until 25 minutes from now, woken three times so far.
  out.push({ type: 'agentStatus', id: 6, status: 'idle', since: ago(15) });
  out.push({ type: 'agentLoop', id: 6, nextAt: baseMs + 25 * MIN_MS, wakes: 3 });

  // Hedy: idle for 1h08m.
  out.push({ type: 'agentStatus', id: 7, status: 'idle', since: ago(68) });
  return out;
}

/**
 * Pins the scene's clock and returns the minute it starts on (what the messages are relative to),
 * a function that runs `fn` with the office clock held at `ms` (a helper's spawn, stamped by the
 * page from that clock) and a function that restores the real clock.
 */
export function startMonitorStage(nowMs: () => number = Date.now): {
  baseMs: number;
  at: (ms: number, fn: () => void) => void;
  stop: () => void;
} {
  const clock = (): Date => monitorClock(nowMs());
  overrideOfficeClock(clock);
  const start = officeNow();
  start.setSeconds(0, 0);
  return {
    baseMs: start.getTime(),
    at: (ms, fn) => {
      overrideOfficeClock(() => new Date(ms));
      try {
        fn();
      } finally {
        overrideOfficeClock(clock);
      }
    },
    stop: () => overrideOfficeClock(null),
  };
}
