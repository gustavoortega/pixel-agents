/**
 * The README hero scene: four named agents in one room, staged for a screenshot or a GIF.
 *
 * Dev-only. Reached through `?scene=hero` on the Vite dev SPA and imported by browserMock.ts
 * alone, so the standalone server build and the VS Code build never contain it. No DOM here:
 * the module returns messages and drives an OfficeState-shaped object through injected callbacks.
 */

import type { ServerMessage } from '../../core/src/messages.js';
import { NAP_AFTER_IDLE_SEC } from './constants.js';
import { fitView } from './office/camera.js';
import { overrideOfficeClock } from './office/clock.js';
import type { ActiveFx } from './office/fx/fxEngine.js';
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

/** Afternoon light: the window shafts are on and the room is not yet in dusk tint. */
export const HERO_HOUR = 16;
export const HERO_MINUTE = 30;

/** A pop plays for FX_POP_MS (0.9 s); one every 1.5 s keeps it on screen most of the time. */
export const HERO_XP_POP_MS = 1500;
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
 * Seats by chair uid in hero-layout.json. Linus (napping) sits face-on: the nap pose is only drawn
 * from the front. Grace takes a back-view chair: a face-on agent's plate sits right above the head
 * and covers the small storm cloud, a back-view agent's plate sits below the feet.
 */
export const HERO_SEATS: Readonly<Record<number, string>> = {
  1: 'f-v9-0008',
  2: 'f-v9-0014',
  3: 'f-v9-0017',
  4: 'f-v9-0002',
};

/** Agent that earns the "+120 XP" pop every HERO_XP_POP_MS. */
export const HERO_XP_AGENT_ID = 1;
export const HERO_XP_AMOUNT = 120;
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

/** 16:30 today; the seconds follow the real clock so lights and shimmer keep moving. */
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
  const pop = (): void => {
    os.fx.active.push({
      kind: 'pop',
      agentId: HERO_XP_AGENT_ID,
      startedAt: nowMs(),
      amount: HERO_XP_AMOUNT,
      level: 0,
    });
  };
  const hold = (): void => {
    os.selectedAgentId = null;
    const napper = os.characters.get(HERO_NAP_AGENT_ID);
    if (napper) {
      // The pose is only re-decided a few seconds after the status changes; the scene must nap at once.
      napper.pose = IdlePose.NAPPING;
      if (napper.idleSec < NAP_AFTER_IDLE_SEC) napper.idleSec = NAP_AFTER_IDLE_SEC;
    }
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
  };
}
