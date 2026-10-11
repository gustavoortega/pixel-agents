/**
 * The README hero scene: what it stages in the real office, and that it stays a dev-only path.
 *
 * Run with: npm test
 */
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import type { ModelTier } from '../../core/src/provider.js';
import {
  HERO_AGENTS,
  HERO_SEATS,
  HERO_XP_AGENT_ID,
  heroMessages,
  heroZoomFor,
  parseHeroScene,
  seatHeroAgents,
  startHeroStage,
} from '../src/heroScene.js';
import { officeNow } from '../src/office/clock.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { IdlePose, WorkStatus } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

const SRC = path.resolve(__dirname, '..', 'src');
const LAYOUT_PATH = path.join(SRC, '..', 'public', 'assets', 'scenes', 'hero-layout.json');

beforeAll(loadRealAssets);

/** What useExtensionMessages does with these messages, reduced to the office calls it makes. */
function apply(os: OfficeState, msg: ServerMessage): void {
  if (msg.type === 'agentModel')
    os.setAgentModel(msg.id, msg.model, msg.tier as ModelTier | undefined);
  else if (msg.type === 'agentSessionTitle') os.setSessionTitle(msg.id, msg.title);
  else if (msg.type === 'agentRoster') os.setRoster(msg.id, msg);
  else if (msg.type === 'rosterEvent') os.setRosterEvent(msg.id, msg, Date.now());
  else if (msg.type === 'agentToolStart') {
    os.setAgentTool(msg.id, msg.toolName ?? null);
    os.setAgentActive(msg.id, true);
  } else if (msg.type === 'agentStatus') os.setAgentActive(msg.id, msg.status === 'active');
}

describe('hero scene staging', () => {
  let os: OfficeState;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 9, 5, 7));
    const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf-8')) as OfficeLayout;
    os = new OfficeState(layout);
    seatHeroAgents(os);
    for (const msg of heroMessages()) apply(os, msg);
    stop = startHeroStage(os, (msg) => apply(os, msg));
    os.selectedAgentId = 4; // what the last agentCreated does
    // One second of the loop at 20 fps: the nap and the cloud must be there at once, with the stage's own timers running.
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(50);
      os.update(0.05);
    }
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('seats the four agents in their chairs, working, reading, storming and napping', () => {
    expect([...os.characters.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const a of HERO_AGENTS) expect(os.characters.get(a.id)?.seatId).toBe(HERO_SEATS[a.id]);
    expect(os.characters.get(1)?.agentStatus).toBe(WorkStatus.ACTIVE);
    expect(os.characters.get(2)?.currentTool).toBe('Read');
    expect(os.characters.get(3)?.agentStatus).toBe(WorkStatus.ACTIVE);
    expect(os.characters.get(4)?.pose).toBe(IdlePose.NAPPING);
    expect(os.selectedAgentId).toBeNull();
  });

  it('puts the owl on the busiest agent only and a storm cloud over the frustrated one only', () => {
    expect([...os.companions].map(([id, c]) => [id, c.kind])).toEqual([[1, 'owl']]);
    const now = Date.now();
    expect(os.weather.stormAlpha(3, now)).toBeGreaterThan(0);
    for (const id of [1, 2, 4]) expect(os.weather.stormAlpha(id, now)).toBeNull();
  });

  it('keeps the XP pop on screen most of the time and the storm going past its 20 s life', () => {
    let popFrames = 0;
    let stormFrames = 0;
    const frames = 500;
    for (let i = 0; i < frames; i++) {
      vi.advanceTimersByTime(50);
      os.update(0.05);
      if (os.fx.active.some((a) => a.kind === 'pop' && a.agentId === HERO_XP_AGENT_ID)) popFrames++;
      if (os.weather.stormAlpha(3, Date.now()) !== null) stormFrames++;
    }
    expect(popFrames / frames).toBeGreaterThan(0.5);
    // A frame or two of calm is the restart; anything more is the cloud going away.
    expect(stormFrames / frames).toBeGreaterThan(0.95);
  });

  it('pins the clock to 16:30 while staged and gives the real one back after', () => {
    expect([officeNow().getHours(), officeNow().getMinutes()]).toEqual([16, 30]);
    stop();
    expect([officeNow().getHours(), officeNow().getMinutes()]).toEqual([9, 5]);
    stop = () => {};
  });
});

describe('hero zoom', () => {
  const room = { cols: 18, rows: 12 };
  it('is the largest zoom level at which the whole room fits the viewport', () => {
    // 1550x784 CSS px at dpr 2: 3100x1568 device px against a 288x192 world px room.
    expect(heroZoomFor(room, { width: 1550, height: 784 }, 2)).toBe(8);
    expect(heroZoomFor(room, { width: 1280, height: 800 }, 1)).toBe(4);
  });
});

describe('hero scene request', () => {
  it('turns on for ?scene=hero only, and &hud=0 hides the HUD', () => {
    expect(parseHeroScene('?scene=hero')).toEqual({ hud: true });
    expect(parseHeroScene('?scene=hero&hud=0')).toEqual({ hud: false });
    expect(parseHeroScene('?scene=other')).toBeNull();
    expect(parseHeroScene('')).toBeNull();
  });
});

describe('hero layout', () => {
  it('holds furniture and tiles of the one room and nothing else', () => {
    const raw = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      [
        'areaTiles',
        'areas',
        'carpetTiles',
        'cols',
        'furniture',
        'layoutRevision',
        'pets',
        'rows',
        'tileColors',
        'tiles',
        'version',
      ].sort(),
    );
    expect((raw.areas as { label: string }[]).map((a) => a.label)).toEqual(['Studio']);
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/tiendanube|\/Users\/|@/i);
    const furniture = raw.furniture as Record<string, unknown>[];
    // Nothing on or past the bottom wall row: that is where the neighbouring room's pieces were.
    expect(furniture.every((f) => (f.row as number) < (raw.rows as number) - 1)).toBe(true);
    for (const f of furniture) {
      expect(Object.keys(f).every((k) => ['uid', 'type', 'col', 'row', 'color'].includes(k))).toBe(
        true,
      );
    }
  });
});

describe('dev-only isolation', () => {
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return sources(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  }
  const importers = (pattern: RegExp): string[] =>
    sources(SRC)
      .filter((f) => pattern.test(fs.readFileSync(f, 'utf-8')))
      .map((f) => path.relative(SRC, f))
      .sort();

  it('only the dev browser mock imports the scene, and only the scene overrides the clock', () => {
    expect(importers(/['"](\.\.?\/)+heroScene(\.[jt]s)?['"]/)).toEqual(['browserMock.ts']);
    expect(importers(/overrideOfficeClock/)).toEqual(['heroScene.ts', 'office/clock.ts']);
  });

  it('loads the browser mock behind import.meta.env.DEV', () => {
    for (const f of importers(/import\(['"]\.\/browserMock/)) {
      const lines = fs.readFileSync(path.join(SRC, f), 'utf-8').split('\n');
      const at = lines.findIndex((l) => /import\(['"]\.\/browserMock/.test(l));
      expect(lines.slice(Math.max(0, at - 6), at).join('\n')).toContain('import.meta.env.DEV');
    }
  });
});
