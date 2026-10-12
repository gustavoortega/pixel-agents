import { Parser } from '@asyncapi/parser';
import Ajv from 'ajv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SHADOW_ID_BASE } from '../src/constants.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  adoptExternalSessionFromHook,
  reassignAgentToFile,
  setDismissalTracker,
} from '../src/fileWatcher.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { SessionRouter } from '../src/sessionRouter.js';
import { processTranscriptLine, setHookProvider } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/does-not-exist.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

// ── Transcript records ──

let toolSeq = 0;
type Rec = Record<string, unknown>;

function toolUse(name: string, input: Rec, id = `toolu_${++toolSeq}`): { id: string; rec: Rec } {
  return {
    id,
    rec: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
  };
}
function toolResult(id: string, text: string, isError = false): Rec {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: [{ type: 'text', text }],
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  };
}
const prompt = (): Rec => ({ type: 'user', message: { content: 'fix the tests' } });
const turnEnd = (): Rec => ({ type: 'system', subtype: 'turn_duration', durationMs: 1000 });

const RED = ' Test Files  1 failed (1)\n      Tests  2 failed | 5 passed (7)\n   Duration  1.2s';
const GREEN = ' Test Files  1 passed (1)\n      Tests  7 passed (7)';
const NO_SUMMARY = 'Exit code 2\nsrc/a.ts(3,1): error TS2304: Cannot find name x.';

/** The record with each tool_result's text as one plain string: how Claude Code writes every
 *  shell result. */
function plainResults(record: Rec): Rec {
  const content = (record.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return record;
  return {
    ...record,
    message: {
      content: content.map((block: Rec) =>
        block.type === 'tool_result' && Array.isArray(block.content)
          ? {
              ...block,
              content: (block.content as Array<{ text: string }>).map((b) => b.text).join(''),
            }
          : block,
      ),
    },
  };
}

/** A Bash test run and its result. */
function run(output: string): Rec[] {
  const call = toolUse('Bash', { command: 'npm test', description: 'Run the tests' });
  return [call.rec, toolResult(call.id, output, output !== GREEN)];
}
function edit(ok = true): Rec[] {
  const call = toolUse('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' });
  const text = ok ? 'The file src/a.ts has been updated.' : 'String to replace not found in file.';
  return [call.rec, toolResult(call.id, text, !ok)];
}
function read(file = 'src/a.ts'): Rec[] {
  const call = toolUse('Read', { file_path: file });
  return [call.rec, toolResult(call.id, '1\tconst x = 1;')];
}
/** The same call made again: same name, same input. */
function repeat(name: string, input: Rec): Rec[] {
  const call = toolUse(name, input);
  return [call.rec, toolResult(call.id, 'ok')];
}

const stuck = (count: number) => ({
  type: 'agentHealth',
  id: 1,
  state: 'stuck',
  reason: 'tests_failing_no_edits',
  count,
});
const looping = (count: number) => ({
  type: 'agentHealth',
  id: 1,
  state: 'looping',
  reason: 'same_call_repeated',
  count,
});
const CLEAR = { type: 'agentHealthClear', id: 1 };

/** One agent fed transcript records, with every health message it broadcast. */
function harness(overrides: Partial<AgentState> = {}) {
  const store = new AgentStateStore();
  const agent = createTestAgent(overrides);
  store.set(agent.id, agent);
  const health: Rec[] = [];
  store.on('broadcast', (msg) => {
    if (String(msg.type).startsWith('agentHealth')) health.push(msg);
  });
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const feed = (...records: Array<Rec | Rec[]>) => {
    for (const record of records.flat()) {
      processTranscriptLine(
        agent.id,
        JSON.stringify(record),
        store,
        waitingTimers,
        permissionTimers,
      );
    }
  };
  return { store, agent, health, feed };
}

describe('health detectors on the transcript', () => {
  beforeEach(() => {
    setHookProvider(claudeProvider);
    // The heuristic timers the parser starts must not fire into later tests.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Results count from the transcript in hooks mode too. Each mode reads one shape of result:
  // text blocks, or a plain string as every shell result is written.
  describe.each([
    ['heuristic mode, results as text blocks', false, (records: Rec[]) => records],
    ['hooks mode, results as plain strings', true, (records: Rec[]) => records.map(plainResults)],
  ])(
    'C1 stuck: red runs with no successful edit between them, %s',
    (_mode, hookDelivered, shape) => {
      it.each([
        ['three red runs', [run(RED), read(), run(RED), read(), run(RED)], [stuck(3)]],
        ['two red runs', [run(RED), read(), run(RED)], []],
        ['a successful edit between them', [run(RED), edit(), run(RED), read(), run(RED)], []],
        [
          'a failed edit between them',
          [run(RED), edit(false), run(RED), read(), run(RED)],
          [stuck(3)],
        ],
        [
          'a Bash with no summary between them',
          [run(RED), run(NO_SUMMARY), run(RED), read(), run(RED)],
          [stuck(3)],
        ],
        ['a green run between them', [run(RED), read(), run(RED), run(GREEN), run(RED)], []],
      ])('%s', (_name, records, expected) => {
        const { health, feed } = harness({ hookDelivered });
        feed(prompt(), ...shape(records.flat()));
        expect(health).toEqual(expected);
      });
    },
  );

  describe('C3 looping: the same call four times in a row', () => {
    const POLL = { command: 'sleep 5 && curl -s localhost:3000/health', timeout: 60000 };
    it.each([
      ['four identical calls', [0, 1, 2, 3].map(() => repeat('Bash', POLL)), [looping(4)]],
      ['three identical calls', [0, 1, 2].map(() => repeat('Bash', POLL)), []],
      [
        'a different input on the fourth',
        [...[0, 1, 2].map(() => repeat('Bash', POLL)), repeat('Bash', { command: 'ls' })],
        [],
      ],
      [
        'the same input under another description each time',
        ['Poll', 'Wait for the server', 'Check health', 'Poll again'].map((description) =>
          repeat('Bash', { ...POLL, description }),
        ),
        [looping(4)],
      ],
      [
        'the same input with its keys in another order, nested ones included',
        [
          { table: 'users', where: { id: 1, active: true } },
          { where: { active: true, id: 1 }, table: 'users' },
          { table: 'users', where: { active: true, id: 1 } },
          { where: { id: 1, active: true }, table: 'users' },
        ].map((input) => repeat('mcp__db__query', input)),
        [looping(4)],
      ],
      [
        'a prompt between the repeats',
        [
          repeat('Bash', POLL),
          repeat('Bash', POLL),
          [prompt()],
          repeat('Bash', POLL),
          repeat('Bash', POLL),
        ],
        [],
      ],
      [
        'a turn end between the repeats',
        [
          repeat('Bash', POLL),
          repeat('Bash', POLL),
          [turnEnd()],
          repeat('Bash', POLL),
          repeat('Bash', POLL),
        ],
        [],
      ],
    ])('%s', (_name, records, expected) => {
      const { health, feed } = harness();
      feed(prompt(), ...records);
      expect(health).toEqual(expected);
    });

    it('counts a call once in hooks mode: its PreToolUse hook does not count beside its record', () => {
      const { store, agent, health, feed } = harness();
      const handler = new HookEventHandler(
        store,
        new Map(),
        new Map(),
        claudeProvider,
        new SessionRouter(),
      );
      handler.registerAgent(agent.sessionId, agent.id);
      feed(prompt());
      for (let i = 0; i < 4; i++) {
        handler.handleEvent('claude', {
          hook_event_name: 'PreToolUse',
          session_id: agent.sessionId,
          tool_name: 'Bash',
          tool_input: POLL,
        });
        const call = toolUse('Bash', POLL);
        feed(call.rec);
        handler.handleEvent('claude', {
          hook_event_name: 'PostToolUse',
          session_id: agent.sessionId,
        });
        feed(toolResult(call.id, 'ok'));
      }
      expect(health).toEqual([looping(4)]);
    });
  });

  describe('C4 a mark clears on the event that ends it', () => {
    const stuckSetup = [prompt(), run(RED), read(), run(RED), read(), run(RED)];
    const loopSetup = [prompt(), ...[0, 1, 2, 3].map(() => repeat('Read', { file_path: 'a.ts' }))];
    it.each([
      ['stuck, then a green run', stuckSetup, stuck(3), [run(GREEN)]],
      ['stuck, then a successful edit', stuckSetup, stuck(3), [edit()]],
      ['stuck, then a new prompt', stuckSetup, stuck(3), [prompt()]],
      ['looping, then a different call', loopSetup, looping(4), [read('b.ts')]],
      ['looping, then a turn end', loopSetup, looping(4), [turnEnd()]],
      ['looping, then a new prompt', loopSetup, looping(4), [prompt()]],
    ])('%s', (_name, setup, shown, clearing) => {
      const { health, feed } = harness();
      feed(...setup);
      expect(health).toEqual([shown]);
      feed(...clearing);
      expect(health).toEqual([shown, CLEAR]);
    });
  });

  // The id guard alone. Real mirrors live in SubagentWatch's own store, whose translate() passes
  // on tool activity only; the guard keeps the detectors from tracking them at all.
  it('C8 guard: an agent with a shadow id (a sub-agent mirror) is never tracked', () => {
    const { health, feed } = harness({ id: SHADOW_ID_BASE });
    feed(prompt(), ...[0, 1, 2, 3].map(() => repeat('Read', { file_path: 'a.ts' })));
    expect(health).toEqual([]);
  });
});

describe('C5 the wire carries a fixed vocabulary, never session text', () => {
  const SECRET_COMMAND = 'curl -H "Authorization: Bearer s3cr3t-token" https://api.internal/x';

  beforeEach(() => {
    setHookProvider(claudeProvider);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** AgentHealth and AgentHealthClear as core/asyncapi.yaml declares them. */
  async function schemaValidators() {
    const spec = fs.readFileSync(path.resolve(__dirname, '../../core/asyncapi.yaml'), 'utf8');
    const { document } = await new Parser().parse(spec);
    const schemas = document!.components().schemas();
    // The parser adds x-parser-* keys to every schema; they are not JSON Schema keywords.
    const ajv = new Ajv({ strict: false });
    return {
      health: ajv.compile(schemas.get('AgentHealth')!.json()),
      clear: ajv.compile(schemas.get('AgentHealthClear')!.json()),
    };
  }

  it('a looping shell call is reported without its command', () => {
    const { health, feed } = harness();
    feed(prompt(), ...[0, 1, 2, 3].map(() => repeat('Bash', { command: SECRET_COMMAND })));
    expect(health).toEqual([looping(4)]);
    const wire = JSON.stringify(health);
    expect(wire).not.toContain('s3cr3t');
    expect(wire).not.toContain('curl');
  });

  it('every health message the server sends fits the schema, and a free-text reason does not', async () => {
    const { health, feed } = harness();
    feed(prompt(), ...[0, 1, 2, 3].map(() => repeat('Bash', { command: SECRET_COMMAND })));
    feed(turnEnd());
    expect(health.map((m) => m.type)).toEqual(['agentHealth', 'agentHealthClear']);

    const validate = await schemaValidators();
    expect(validate.health(health[0])).toBe(true);
    expect(validate.clear(health[1])).toBe(true);
    expect(validate.health({ ...health[0], reason: `same call: ${SECRET_COMMAND}` })).toBe(false);
    expect(validate.health({ ...health[0], detail: SECRET_COMMAND })).toBe(false);
  });
});

describe('health across a new session or a replayed history', () => {
  let tmp: string;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-health-'));
    pollingTimers = new Map();
    setHookProvider(claudeProvider);
    setDismissalTracker(new DismissalTracker());
    // Starts at the real time, so a just-written transcript still reads as fresh.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const timer of pollingTimers.values()) clearInterval(timer);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const writeJsonl = (file: string, records: Rec[]) =>
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  it('C4 a looping mark is cleared on the wire when the character moves to a new session', () => {
    const oldFile = path.join(tmp, 'old.jsonl');
    const newFile = path.join(tmp, 'new.jsonl');
    writeJsonl(oldFile, [prompt()]);
    writeJsonl(newFile, [prompt()]);
    // Hooks mode: no heuristic timers left running after the test.
    const { store, health, feed } = harness({
      jsonlFile: oldFile,
      projectDir: tmp,
      hookDelivered: true,
    });
    feed(prompt(), ...[0, 1, 2, 3].map(() => repeat('Read', { file_path: 'a.ts' })));
    expect(health).toEqual([looping(4)]);

    reassignAgentToFile(
      1,
      newFile,
      store,
      new Map(),
      pollingTimers,
      new Map(),
      new Map(),
      () => {},
    );
    expect(health).toEqual([looping(4), CLEAR]);
  });

  /** Adopt a transcript that was just created: it replays from its first line. */
  function adoptFresh(records: Rec[]): Rec[] {
    const file = path.join(tmp, 'fresh.jsonl');
    writeJsonl(file, records);
    const store = new AgentStateStore();
    const health: Rec[] = [];
    store.on('broadcast', (msg) => {
      if (String(msg.type).startsWith('agentHealth')) health.push(msg);
    });
    adoptExternalSessionFromHook(
      'fresh',
      file,
      tmp,
      new Set(),
      { current: 1 },
      store,
      new Map(),
      pollingTimers,
      new Map(),
      new Map(),
      () => {},
    );
    return health;
  }

  it('a replayed history sends one compare at its end, never the marks it passed through', () => {
    const loop = [0, 1, 2, 3].map(() => repeat('Read', { file_path: 'a.ts' }));
    expect(adoptFresh([prompt(), ...loop.flat(), ...read('b.ts')])).toEqual([]);
    expect(adoptFresh([prompt(), ...loop.flat()])).toEqual([looping(4)]);
  });
});
