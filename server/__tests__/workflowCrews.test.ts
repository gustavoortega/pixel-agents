/**
 * Workflow crews: the agents a lead's Workflow run spawns are drawn as helpers,
 * one per live agent, keyed `wf:<runId>:<agentId>`, and cleared by their journal
 * result, by staleness, or by the run's completion.
 *
 * Fixtures follow the real on-disk shapes (Claude Code, Oct 2026) with
 * synthetic text: a run dir `subagents/workflows/wf_<runId>/` holding
 * journal.jsonl, agent-<id>.jsonl and sidecars without a toolUseId; the lead's
 * Workflow tool_result with toolUseResult {runId: "wf_<id>", taskType:
 * "local_workflow", status, transcriptDir}; the completion as a queue-operation
 * <task-notification>. Everything runs through a real AgentRuntime and the real
 * 1 s scan body (scanAllTeammateFiles), with a fake clock.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The VS Code restorer imports `vscode`; restoring an external agent reads only its terminal list.
vi.mock('vscode', () => ({ window: { terminals: [] } }));

import { restoreAgents } from '../../adapters/vscode/agentManager.js';
import type { StateAdapter } from '../../core/src/adapter.js';
import { resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  WORKFLOW_ATTACH_TAIL_BYTES,
  WORKFLOW_IGNORED_RECHECK_MS,
  WORKFLOW_JOURNAL_CHUNK_BYTES,
  WORKFLOW_JOURNAL_MAX_LINE_BYTES,
} from '../src/constants.js';
import { scanAllTeammateFiles } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { processTranscriptLine } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

const LEAD_SESSION = '7c1e5a40-0000-4000-8000-00000000c0de';
const WF_TOOL_ID = 'toolu_01WorkflowLaunchAAAA';
const TASK_TOOL_ID = 'toolu_01TaskParentBBBB';
const RUN = '5b1fa126-e5b';
const MIN = 60_000;

let tmpRoot: string;
let store: AgentStateStore;
let runtime: AgentRuntime;
let lead: AgentState;
let messages: Array<Record<string, unknown>>;

function createLead(projectDir: string): AgentState {
  return {
    id: 1,
    sessionId: LEAD_SESSION,
    terminalRef: undefined,
    isExternal: true,
    projectDir,
    jsonlFile: path.join(projectDir, `${LEAD_SESSION}.jsonl`),
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
  } as AgentState;
}

function runDir(runId = RUN): string {
  return path.join(tmpRoot, LEAD_SESSION, 'subagents', 'workflows', `wf_${runId}`);
}

function transcriptPath(agentId: string, runId = RUN): string {
  return path.join(runDir(runId), `agent-${agentId}.jsonl`);
}

const key = (agentId: string): string => `v2:${agentId.padEnd(64, '0')}`;
const started = (agentId: string, label = `label ${agentId}`, phase: unknown = 'scout') => ({
  type: 'started',
  key: key(agentId),
  agentId,
  label,
  phase,
});
const result = (agentId: string) => ({
  type: 'result',
  key: key(agentId),
  agentId,
  result: { score: 1 },
});

/** Append raw text to the run journal (callers control newlines). */
function appendJournalText(text: string, runId = RUN): void {
  fs.mkdirSync(runDir(runId), { recursive: true });
  fs.appendFileSync(path.join(runDir(runId), 'journal.jsonl'), text);
}

function appendJournal(records: object[], runId = RUN): void {
  appendJournalText(records.map((r) => JSON.stringify(r) + '\n').join(''), runId);
}

/** One sidechain record of a workflow agent calling a tool. */
function toolUseLine(toolId: string, name: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      message: { content: [{ type: 'tool_use', id: toolId, name, input: {} }] },
    }) + '\n'
  );
}

/** A workflow agent's transcript (sidechain records on the lead's session) and its sidecar. */
function writeAgent(agentId: string, opts: { runId?: string; mtimeAgoMs?: number } = {}): string {
  const runId = opts.runId ?? RUN;
  const file = transcriptPath(agentId, runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      agentId,
      sessionId: LEAD_SESSION,
      message: {
        content: [
          { type: 'tool_use', id: `toolu_${agentId}`, name: 'Read', input: { file_path: '/x.ts' } },
        ],
      },
    }) + '\n',
  );
  // Real sidecars carry no toolUseId and no name: never a reason to adopt or to skip.
  fs.writeFileSync(
    path.join(path.dirname(file), `agent-${agentId}.meta.json`),
    JSON.stringify({
      agentType: 'workflow-subagent',
      description: `label ${agentId}`,
      workflowPhase: 'scout',
      spawnDepth: 1,
      requestShape: 'foreground',
      requestNonInteractive: true,
    }),
  );
  if (opts.mtimeAgoMs !== undefined) setMtime(file, opts.mtimeAgoMs);
  return file;
}

function setMtime(file: string, agoMs: number): void {
  const t = (Date.now() - agoMs) / 1000;
  fs.utimesSync(file, t, t);
}

function launchRecord(
  status = 'async_launched',
  toolId = WF_TOOL_ID,
  runId = RUN,
  workflowName: unknown = 'synthetic-crew',
): string {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: [{ type: 'text', text: 'Workflow launched in background. Task ID: wtest01' }],
        },
      ],
    },
    toolUseResult: {
      status,
      taskId: 'wtest01',
      taskType: 'local_workflow',
      workflowName,
      runId: `wf_${runId}`,
      summary: 'synthetic summary',
      transcriptDir: runDir(runId),
      scriptPath: '/tmp/synthetic-crew.js',
    },
  });
}

function notificationRecord(status: string, toolId = WF_TOOL_ID): string {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    sessionId: LEAD_SESSION,
    content:
      `<task-notification>\n<task-id>wtest01</task-id>\n<tool-use-id>${toolId}</tool-use-id>\n` +
      `<output-file>/tmp/out</output-file>\n<status>${status}</status>\n` +
      `<summary>synthetic</summary>\n</task-notification>`,
  });
}

function leadLine(line: string): void {
  processTranscriptLine(1, line, store, runtime.waitingTimers, runtime.permissionTimers);
}

function hook(event: Record<string, unknown>): void {
  runtime.handleHookEvent('claude', { session_id: LEAD_SESSION, ...event });
}

/** The real 1 s project-scan body. */
function tick(advanceMs = 1000): void {
  vi.advanceTimersByTime(advanceMs);
  scanAllTeammateFiles(
    store.nextAgentId,
    store,
    runtime.fileWatchers,
    runtime.pollingTimers,
    runtime.waitingTimers,
    runtime.permissionTimers,
    () => store.persist(),
  );
}

const helperId = (agentId: string, runId = RUN): string => `wf:${runId}:${agentId}`;
const startsFor = (parentToolId: string) =>
  messages.filter((m) => m.type === 'subagentToolStart' && m.parentToolId === parentToolId);
const presencesFor = (parentToolId: string) =>
  messages.filter((m) => m.type === 'subagentPresent' && m.parentToolId === parentToolId);
const clearsFor = (parentToolId: string) =>
  messages.filter((m) => m.type === 'subagentClear' && m.parentToolId === parentToolId);
/** Shadow-store watches on a transcript: the registry the helpers are streamed from. */
const watchesOf = (file: string): number =>
  [...runtime.subagentWatch.store.values()].filter((a) => a.jsonlFile === file).length;

/** A StateAdapter over memory: `saved` holds every saveAgents call. */
function memoryAdapter(
  initial: Array<Record<string, unknown>> = [],
): StateAdapter & { saved: Array<Array<Record<string, unknown>>> } {
  const saved: Array<Array<Record<string, unknown>>> = [];
  return {
    saved,
    loadAgents: () => initial as never,
    saveAgents: (agents) => {
      saved.push(agents as unknown as Array<Record<string, unknown>>);
    },
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: <T>(_key: string, defaultValue: T) => defaultValue,
    setSetting: () => {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-wf-'));
  store = new AgentStateStore();
  runtime = new AgentRuntime(store, claudeProvider);
  lead = createLead(tmpRoot);
  store.set(1, lead);
  messages = [];
  store.on('broadcast', (m) => messages.push(m as Record<string, unknown>));
});

afterEach(() => {
  runtime.dispose();
  vi.useRealTimers();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workflow crews: discovery and teardown', () => {
  it('C1 watches exactly the started-not-finished agent, keyed wf:<run>:<agent>, with toolUseId-less sidecars', () => {
    appendJournal([{ type: 'launched' }, started('a1'), started('a2'), result('a2')]);
    const live = writeAgent('a1');
    const done = writeAgent('a2');

    tick();

    expect(watchesOf(live)).toBe(1);
    expect(watchesOf(done)).toBe(0);
    expect(startsFor(helperId('a1'))).toHaveLength(1);
    expect(messages.filter((m) => m.type === 'subagentToolStart')).toHaveLength(1);
    // A helper, never a character of its own.
    expect([...store.values()].some((a) => a.leadAgentId === 1)).toBe(false);
  });

  it('C2 a result line for a live agent clears its helper and drops its watch', () => {
    appendJournal([started('a1')]);
    const file = writeAgent('a1');
    tick();
    expect(watchesOf(file)).toBe(1);

    appendJournal([result('a1')]);
    tick();

    expect(clearsFor(helperId('a1'))).toHaveLength(1);
    expect(watchesOf(file)).toBe(0);
  });

  it('C3 the lead notification for the Workflow tool clears every helper of the run', () => {
    leadLine(launchRecord());
    appendJournal([started('a1'), started('a2')]);
    const f1 = writeAgent('a1');
    const f2 = writeAgent('a2');
    tick();
    expect(watchesOf(f1) + watchesOf(f2)).toBe(2);

    leadLine(notificationRecord('completed'));

    expect(clearsFor(helperId('a1'))).toHaveLength(1);
    expect(clearsFor(helperId('a2'))).toHaveLength(1);
    expect(watchesOf(f1) + watchesOf(f2)).toBe(0);
    // Their transcripts still look fresh: the completed run must not bring them back.
    tick();
    expect(watchesOf(f1) + watchesOf(f2)).toBe(0);
  });

  it('C4 a transcript quiet for 15 min is cleared; a fresh one is kept', () => {
    appendJournal([started('quiet'), started('busy')]);
    const quiet = writeAgent('quiet');
    const busy = writeAgent('busy');
    tick();
    expect(watchesOf(quiet) + watchesOf(busy)).toBe(2);

    setMtime(quiet, 16 * MIN);
    setMtime(busy, 1 * MIN);
    tick();

    expect(clearsFor(helperId('quiet'))).toHaveLength(1);
    expect(watchesOf(quiet)).toBe(0);
    expect(clearsFor(helperId('busy'))).toHaveLength(0);
    expect(watchesOf(busy)).toBe(1);
  });

  it('C5 a teamed lead gets helpers for its workflow agents, never teammates', () => {
    lead.teamName = 'session-0badc0de';
    // A finished agent is not watched, so nothing but the classification keeps
    // teammate discovery from adopting its transcript.
    appendJournal([started('a1'), started('a2'), result('a2')]);
    const file = writeAgent('a1');
    writeAgent('a2');

    tick();
    tick();

    expect([...store.values()].filter((a) => a.leadAgentId === 1)).toHaveLength(0);
    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('a1'))).toHaveLength(1);
  });

  it('C6 the stream carries the label and the phase as group, on every start', () => {
    appendJournal([started('a1', 'probe:kappa', 'phase-2')]);
    const file = writeAgent('a1');
    tick();
    fs.appendFileSync(file, toolUseLine('toolu_next', 'Grep'));
    vi.advanceTimersByTime(600); // the shadow's 500 ms poll

    const starts = startsFor(helperId('a1'));
    expect(starts).toHaveLength(2);
    for (const m of starts) {
      expect(m.label).toBe('probe:kappa');
      expect(m.group).toBe('phase-2');
    }
  });

  it('C15 label and group are single-spaced, format characters included, and cut by code points to 60 and 40', () => {
    // A bidi override, an isolate, a zero-width space and a byte order mark are runs to collapse
    // like any control character: on the plate an override would reverse the lead's name.
    const label = `a\nb\u0007\t  c\u202E\u2066\u200B ${'\u{1F600}'.repeat(80)}`;
    const phase = `\uFEFFp\r\n${'x'.repeat(80)}`;
    appendJournal([started('a1', label, phase)]);
    writeAgent('a1');

    tick();

    const [start] = startsFor(helperId('a1'));
    expect(start.label).toBe(`a b c ${'\u{1F600}'.repeat(54)}`);
    expect(Array.from(start.label as string)).toHaveLength(60);
    expect(start.group).toBe(`p ${'x'.repeat(38)}`);
  });

  it('C16 a Workflow result with any status but async_launched completes the run', () => {
    appendJournal([started('a1')]);
    const file = writeAgent('a1');
    tick();
    expect(watchesOf(file)).toBe(1);

    // A foreground run: its tool_result is only written once the run is over.
    leadLine(launchRecord('completed'));

    expect(clearsFor(helperId('a1'))).toHaveLength(1);
    expect(watchesOf(file)).toBe(0);
    tick();
    expect(watchesOf(file)).toBe(0);
  });
});

describe('workflow crews: timing and races', () => {
  it('C10 a launch result scans at once, and the timer scan in the same tick shares its watch and stream', () => {
    tick(); // no workflows dir yet: the scan remembers the miss for 5 s
    appendJournal([started('a1')]);
    const file = writeAgent('a1');

    leadLine(launchRecord()); // queues a scan and forgets the miss
    vi.advanceTimersByTime(0); // the queued scan runs, before any timer scan
    expect(watchesOf(file)).toBe(1);

    tick(0); // the timer scan lands in the same tick
    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('a1'))).toHaveLength(1);
  });

  it('C11 a tracked run whose journal is 3 h old keeps an agent whose transcript moved 1 min ago', () => {
    appendJournal([started('long')]);
    const file = writeAgent('long');
    tick();
    expect(watchesOf(file)).toBe(1);

    setMtime(path.join(runDir(), 'journal.jsonl'), 180 * MIN);
    setMtime(file, 1 * MIN);
    tick();

    expect(watchesOf(file)).toBe(1);
    expect(clearsFor(helperId('long'))).toHaveLength(0);
  });

  it('C12 a stale agent that moves again comes back under the same key, as a single helper', () => {
    appendJournal([started('a1')]);
    const file = writeAgent('a1');
    tick();
    setMtime(file, 16 * MIN);
    tick();
    expect(watchesOf(file)).toBe(0);

    fs.appendFileSync(file, toolUseLine('toolu_back', 'Bash'));
    tick(11_000); // past the stale re-check interval

    expect(watchesOf(file)).toBe(1);
    expect(clearsFor(helperId('a1'))).toHaveLength(1);
    // C43: the clear removed the helper; the new attach announces it again.
    expect(presencesFor(helperId('a1'))).toHaveLength(2);
    // Same key on both streams: the webview recreates the same helper, never a second one.
    expect(startsFor(helperId('a1')).length).toBeGreaterThan(1);
    expect(new Set(messages.map((m) => m.parentToolId).filter(Boolean))).toEqual(
      new Set([helperId('a1')]),
    );
  });

  it('C13 a journal rewritten shorter is read again: no duplicate, new agents found', () => {
    // Result payloads are large, so the first journal is the longer one.
    appendJournal([
      { type: 'launched' },
      started('a1'),
      started('a2'),
      { ...result('a2'), result: { notes: 'n'.repeat(600) } },
    ]);
    const f1 = writeAgent('a1');
    tick();
    expect(watchesOf(f1)).toBe(1);

    const journalPath = path.join(runDir(), 'journal.jsonl');
    const before = fs.statSync(journalPath).size;
    fs.writeFileSync(
      journalPath,
      JSON.stringify(started('a1')) + '\n' + JSON.stringify(started('a3')) + '\n',
    );
    expect(fs.statSync(journalPath).size).toBeLessThan(before);
    const f3 = writeAgent('a3');
    tick();

    expect(watchesOf(f1)).toBe(1);
    expect(watchesOf(f3)).toBe(1);
    expect(startsFor(helperId('a1'))).toHaveLength(1);
  });

  it('C20 a result split across two ticks ends the agent on the tick that completes it', () => {
    appendJournal([started('a1')]);
    const file = writeAgent('a1');
    tick();

    const line = JSON.stringify(result('a1')) + '\n';
    appendJournalText(line.slice(0, 20));
    tick();
    expect(watchesOf(file)).toBe(1);

    appendJournalText(line.slice(20));
    tick();
    expect(watchesOf(file)).toBe(0);
    expect(clearsFor(helperId('a1'))).toHaveLength(1);
  });

  it('C20 a started line split across two ticks makes one agent with one watch', () => {
    const file = writeAgent('a1');
    const line = JSON.stringify(started('a1')) + '\n';
    appendJournalText(line.slice(0, 25));
    tick();
    expect(watchesOf(file)).toBe(0);

    appendJournalText(line.slice(25));
    tick();
    tick();

    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('a1'))).toHaveLength(1);
  });

  it('C21 a transcript that appears 3 s after its started line is watched then, once', () => {
    appendJournal([started('late')]);
    tick();
    tick();
    expect(startsFor(helperId('late'))).toHaveLength(0);
    // Nothing is watched on a path that is not on disk yet.
    expect(watchesOf(transcriptPath('late'))).toBe(0);

    vi.advanceTimersByTime(1000);
    const file = writeAgent('late');
    tick();

    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('late'))).toHaveLength(1);
  });

  it('C22 launch, started agent and kill all before the next tick: no helper is ever drawn', () => {
    appendJournal([{ type: 'launched' }, started('a1')]);
    writeAgent('a1');

    // The launch result and the kill notification arrive in one read of the lead's transcript.
    leadLine(launchRecord());
    leadLine(notificationRecord('killed'));
    vi.advanceTimersByTime(0); // the kicked scan
    tick();
    tick();

    expect(messages.some((m) => m.type === 'subagentToolStart')).toBe(false);
  });

  it('C25 a fresh server adopts a 3 h old run whose agent transcript moved 1 min ago', () => {
    appendJournal([started('long')]);
    const file = writeAgent('long', { mtimeAgoMs: 1 * MIN });
    setMtime(path.join(runDir(), 'journal.jsonl'), 180 * MIN);

    tick();

    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('long'))).toHaveLength(1);
  });

  it('C27 a killed run whose journal is 3 h old but whose agent wrote 1 min ago stays killed', () => {
    leadLine(launchRecord());
    appendJournal([started('long')]);
    const file = writeAgent('long');
    tick();
    setMtime(path.join(runDir(), 'journal.jsonl'), 180 * MIN);
    setMtime(file, 1 * MIN);
    tick();
    expect(watchesOf(file)).toBe(1);

    leadLine(notificationRecord('killed'));
    expect(watchesOf(file)).toBe(0);
    // Forgotten on its journal's age, the run would be adopted again on its transcript's: on the
    // next tick, or at the next look at rejected dirs.
    tick();
    tick(WORKFLOW_IGNORED_RECHECK_MS + 1000);

    expect(watchesOf(file)).toBe(0);
    expect(startsFor(helperId('long'))).toHaveLength(1);
  });

  it('C30 a journal longer than one read is read whole in one scan: an agent started and finished a read apart is never drawn', () => {
    // Real result lines carry the agent's whole output: a long run's journal runs to megabytes.
    const bulky = (i: number) => ({
      ...result(`done${i}`),
      result: { notes: 'n'.repeat(100_000) },
    });
    const count = Math.ceil(WORKFLOW_JOURNAL_CHUNK_BYTES / 100_000) + 1;
    appendJournal([
      started('a1'),
      ...Array.from({ length: count }, (_, i) => bulky(i)),
      result('a1'),
    ]);
    const file = writeAgent('a1');

    tick();

    expect(watchesOf(file)).toBe(0);
    expect(startsFor(helperId('a1'))).toHaveLength(0);
  });

  it('C31 journal lines over the ceiling are never parsed, and the lines after them are read in the same scan', () => {
    // One just over the ceiling, one that outgrows it a whole read before its newline.
    appendJournal([
      started('big1', 'x'.repeat(WORKFLOW_JOURNAL_MAX_LINE_BYTES)),
      started('a2'),
      started('big2', 'x'.repeat(WORKFLOW_JOURNAL_MAX_LINE_BYTES + WORKFLOW_JOURNAL_CHUNK_BYTES)),
      started('a3'),
    ]);
    const files = ['big1', 'a2', 'big2', 'a3'].map((id) => writeAgent(id));

    tick();

    expect(files.map(watchesOf)).toEqual([0, 1, 0, 1]);
  });

  it('C37 a transcript over 1 MiB is tailed on attach: its old tools never show, its next one does', () => {
    appendJournal([started('long')]);
    const file = writeAgent('long');
    const filler = JSON.stringify({ type: 'file-history-snapshot', pad: 'p'.repeat(1000) }) + '\n';
    fs.appendFileSync(file, filler.repeat(Math.ceil(WORKFLOW_ATTACH_TAIL_BYTES / filler.length)));
    fs.appendFileSync(file, toolUseLine('toolu_old', 'Grep'));

    tick();
    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('long'))).toHaveLength(0);

    fs.appendFileSync(file, toolUseLine('toolu_new', 'Bash'));
    vi.advanceTimersByTime(600); // the shadow's 500 ms poll

    expect(startsFor(helperId('long')).map((m) => m.toolId)).toEqual(['toolu_new']);
  });
});

describe('workflow crews: presence', () => {
  it('C41 an agent tailed past 1 MiB that only thinks is announced once, with its label and phase', () => {
    appendJournal([started('think', 'final:top10', 'Final')]);
    const file = writeAgent('think');
    const filler = JSON.stringify({ type: 'file-history-snapshot', pad: 'p'.repeat(1000) }) + '\n';
    fs.appendFileSync(file, filler.repeat(Math.ceil(WORKFLOW_ATTACH_TAIL_BYTES / filler.length)));

    tick();
    // No tool call to read: the presence is the only way its helper shows.
    expect(startsFor(helperId('think'))).toHaveLength(0);
    expect(presencesFor(helperId('think'))).toEqual([
      {
        type: 'subagentPresent',
        id: 1,
        parentToolId: helperId('think'),
        label: 'final:top10',
        group: 'Final',
      },
    ]);

    // C42: once per attach, not once per scan.
    tick();
    tick();
    tick();
    expect(presencesFor(helperId('think'))).toHaveLength(1);
  });

  it('C44 a reconnect re-announces every watched workflow agent, and no finished one', () => {
    appendJournal([started('live', 'scan:docs', 'Ground'), started('done'), result('done')]);
    writeAgent('live');
    writeAgent('done');
    tick();

    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => sent.push(m), store);

    expect(sent.filter((m) => m.type === 'subagentPresent')).toEqual([
      {
        type: 'subagentPresent',
        id: 1,
        parentToolId: helperId('live'),
        label: 'scan:docs',
        group: 'Ground',
      },
    ]);
  });
});

describe('workflow crews: run end and resume', () => {
  it('C33 a kill reads the journal first: an agent started since the last scan is never drawn', () => {
    leadLine(launchRecord());
    appendJournal([started('a1')]);
    writeAgent('a1');
    tick();

    appendJournal([started('a2')]);
    const f2 = writeAgent('a2');
    leadLine(notificationRecord('killed'));
    tick();
    tick();

    expect(watchesOf(f2)).toBe(0);
    expect(startsFor(helperId('a2'))).toHaveLength(0);
  });

  it('C34 a resume that reuses the run dir reopens the completed run for its new agents', () => {
    leadLine(launchRecord());
    appendJournal([started('a1')]);
    writeAgent('a1');
    tick();
    appendJournal([result('a1')]);
    leadLine(notificationRecord('completed'));
    tick();

    appendJournal([started('b1')]);
    const b1 = writeAgent('b1');
    tick();

    expect(watchesOf(b1)).toBe(1);
    expect(startsFor(helperId('b1'))).toHaveLength(1);
  });

  it('C35 a late result line never reopens a completed run', () => {
    leadLine(launchRecord());
    appendJournal([started('a1'), started('a2')]);
    writeAgent('a1');
    const f2 = writeAgent('a2');
    tick();

    leadLine(notificationRecord('completed'));
    // The journal flush racing the notification.
    appendJournal([result('a1')]);
    tick();
    tick();

    expect(watchesOf(f2)).toBe(0);
    expect(startsFor(helperId('a2'))).toHaveLength(1);
  });
});

describe('workflow crews: the lead goes', () => {
  it('C29 a lead removed without a session end takes its helpers with it', () => {
    appendJournal([started('a1')]);
    const file = writeAgent('a1');
    tick();
    expect(watchesOf(file)).toBe(1);

    runtime.removeAgent(1);

    expect(watchesOf(file)).toBe(0);
  });

  describe('C28 a session end on a lead that stays (a terminal agent)', () => {
    const RESUMED_RUN = '9c2be0d4-a01';
    let a1: string;

    beforeEach(() => {
      lead.isExternal = false;
      runtime.registerAgent(LEAD_SESSION, 1);
      appendJournal([started('a1')]);
      a1 = writeAgent('a1');
      tick();
      expect(watchesOf(a1)).toBe(1);

      hook({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    });

    it('ends its helpers, and later scans leave that session alone', () => {
      expect(store.has(1)).toBe(true);
      expect(clearsFor(helperId('a1'))).toHaveLength(1);

      tick();
      tick();

      expect(watchesOf(a1)).toBe(0);
      expect(startsFor(helperId('a1'))).toHaveLength(1);
    });

    it('a launch in it again (a resume under the same id) draws the new run, never the ended one', () => {
      appendJournal([started('b1')], RESUMED_RUN);
      const b1 = writeAgent('b1', { runId: RESUMED_RUN });

      leadLine(launchRecord('async_launched', 'toolu_02WorkflowResumeCCCC', RESUMED_RUN));
      vi.advanceTimersByTime(0); // the kicked scan

      expect(watchesOf(b1)).toBe(1);
      expect(watchesOf(a1)).toBe(0);
    });

    it('a launch that resumes the ended run itself draws its new agents, already in the journal', () => {
      // On disk before the first read: a run taken as completed would never reopen for them.
      appendJournal([started('b1')]);
      const b1 = writeAgent('b1');

      leadLine(launchRecord('async_launched', 'toolu_03WorkflowRelaunchDDDD'));
      vi.advanceTimersByTime(0); // the kicked scan

      expect(watchesOf(b1)).toBe(1);
    });
  });
});

describe('workflow crews: SubagentStart/Stop hooks of workflow agents', () => {
  beforeEach(() => {
    runtime.registerAgent(LEAD_SESSION, 1);
    // A real Agent-tool sub-agent is running under an open Task parent.
    lead.activeToolIds.add(TASK_TOOL_ID);
    lead.activeToolNames.set(TASK_TOOL_ID, 'Task');
    lead.activeToolStatuses.set(TASK_TOOL_ID, 'Subtask: synthetic');
    lead.activeSubagentToolIds.set(TASK_TOOL_ID, new Set(['toolu_task_sub']));
  });

  it('C14 a known workflow agent draws no hook row under the open Task, and its Stop clears nothing', () => {
    appendJournal([started('wfa')]);
    writeAgent('wfa');
    tick();
    messages.length = 0;

    hook({ hook_event_name: 'SubagentStart', agent_id: 'wfa', agent_type: 'workflow-subagent' });
    hook({ hook_event_name: 'SubagentStop', agent_id: 'wfa', agent_type: 'workflow-subagent' });

    expect(messages.filter((m) => m.parentToolId === TASK_TOOL_ID)).toEqual([]);
    expect(lead.activeSubagentToolIds.get(TASK_TOOL_ID)).toEqual(new Set(['toolu_task_sub']));
  });

  it('C23 a hook row drawn before the journal is read goes when the journal names the agent', () => {
    hook({ hook_event_name: 'SubagentStart', agent_id: 'early', agent_type: 'workflow-subagent' });
    const [row] = startsFor(TASK_TOOL_ID);
    expect(row).toBeDefined();
    const rowId = row.toolId as string;

    appendJournal([started('early')]);
    const file = writeAgent('early');
    tick();

    expect(lead.activeSubagentToolIds.get(TASK_TOOL_ID)?.has(rowId)).toBe(false);
    expect(messages.some((m) => m.type === 'subagentToolDone' && m.toolId === rowId)).toBe(true);
    expect(clearsFor(TASK_TOOL_ID)).toHaveLength(0);
    expect(watchesOf(file)).toBe(1);
    expect(startsFor(helperId('early'))).toHaveLength(1);

    messages.length = 0;
    hook({ hook_event_name: 'SubagentStop', agent_id: 'early', agent_type: 'workflow-subagent' });
    expect(messages).toEqual([]);
  });

  it.each([
    ['a POSIX path', (agentId: string) => transcriptPath(agentId)],
    [
      'a Windows path',
      (agentId: string) =>
        `C:\\Users\\dev\\.claude\\projects\\p\\${LEAD_SESSION}\\subagents\\workflows\\wf_${RUN}\\agent-${agentId}.jsonl`,
    ],
  ])(
    'C32 a Stop whose transcript is a workflow one (%s) ends only its own row, before the journal names it',
    (_label, pathOf) => {
      hook({ hook_event_name: 'SubagentStart', agent_id: 'x1', agent_type: 'workflow-subagent' });
      const [row] = startsFor(TASK_TOOL_ID);
      expect(row).toBeDefined();

      hook({
        hook_event_name: 'SubagentStop',
        agent_id: 'x1',
        agent_type: 'workflow-subagent',
        agent_transcript_path: pathOf('x1'),
      });

      expect(messages.some((m) => m.type === 'subagentToolDone' && m.toolId === row.toolId)).toBe(
        true,
      );
      expect(clearsFor(TASK_TOOL_ID)).toHaveLength(0);
      expect(lead.activeSubagentToolIds.get(TASK_TOOL_ID)).toEqual(new Set(['toolu_task_sub']));
    },
  );
});

describe('workflow crews: persistence', () => {
  it("C40 the lead's record carries the run of a launch, then the run as completed after its kill", () => {
    const adapter = memoryAdapter();
    store.setAdapter(adapter);

    leadLine(launchRecord());
    expect(adapter.saved.at(-1)?.[0]).toMatchObject({ id: 1, workflowRuns: { [WF_TOOL_ID]: RUN } });

    leadLine(notificationRecord('killed'));
    const record = adapter.saved.at(-1)?.[0];
    expect(record?.completedWorkflowRunIds).toEqual([RUN]);
    expect(record?.workflowRuns).toBeUndefined();
  });

  describe.each([
    ['the standalone runtime', () => runtime.restoreExternalAgents()],
    [
      'the VS Code panel',
      () =>
        restoreAgents(
          store.getAdapter()!,
          store.nextAgentId,
          store.nextTerminalIndex,
          store,
          runtime.knownJsonlFiles,
          runtime.fileWatchers,
          runtime.pollingTimers,
          runtime.waitingTimers,
          runtime.permissionTimers,
          runtime.jsonlPollTimers,
          runtime.projectScanTimer,
          runtime.activeAgentId,
        ),
    ],
  ])('C40 a lead restored by %s', (_label, restore) => {
    it('keeps a completed run completed, and ends a mapped run on its notification', () => {
      const OLD_RUN = '0d9a7e31-c42';
      fs.writeFileSync(lead.jsonlFile, '');
      store.delete(1);
      store.setAdapter(
        memoryAdapter([
          {
            id: 1,
            sessionId: LEAD_SESSION,
            terminalName: '',
            isExternal: true,
            jsonlFile: lead.jsonlFile,
            projectDir: tmpRoot,
            workflowRuns: { [WF_TOOL_ID]: RUN },
            completedWorkflowRunIds: [OLD_RUN],
          },
        ]),
      );

      restore();
      appendJournal([started('old1')], OLD_RUN);
      const old1 = writeAgent('old1', { runId: OLD_RUN });
      appendJournal([started('a1')]);
      const a1 = writeAgent('a1');
      tick();

      expect(watchesOf(old1)).toBe(0);
      expect(watchesOf(a1)).toBe(1);

      leadLine(notificationRecord('completed'));

      expect(watchesOf(a1)).toBe(0);
      expect(clearsFor(helperId('a1'))).toHaveLength(1);
    });
  });
});

describe('workflow crews: the run view', () => {
  const NAME = 'synthetic-crew';
  const RUN2 = '0d9a7e31-c42';
  const TOOL2 = 'toolu_02WorkflowSecondEEEE';

  const runMessages = (runId = RUN) =>
    messages.filter((m) => m.type === 'workflowRun' && m.runId === runId);
  const lastRun = (runId = RUN) => runMessages(runId).at(-1);

  afterEach(() => vi.restoreAllMocks());

  it('C4.0 shows the launch name, phases in first-seen order with their own counts, and the status', () => {
    const launchedAt = Date.now();
    leadLine(launchRecord());
    appendJournal([
      { type: 'launched' },
      started('a1', 'x', 'Ground'),
      started('a2', 'y', 'Plan'),
      started('a3', 'z', 'Ground'),
      result('a1'),
    ]);
    tick(5 * MIN);

    expect(lastRun()).toEqual({
      type: 'workflowRun',
      id: 1,
      runId: RUN,
      status: 'running',
      name: NAME,
      phases: [
        { name: 'Ground', started: 2, done: 1 },
        { name: 'Plan', started: 1, done: 0 },
      ],
      started: 3,
      done: 1,
      since: launchedAt,
    });

    leadLine(notificationRecord('completed'));
    expect(lastRun()).toMatchObject({ status: 'done', started: 3, done: 1 });
  });

  it('C4.0b a run with no agent yet sends no counts, never 0', () => {
    leadLine(launchRecord());
    appendJournal([{ type: 'launched' }]);
    tick();

    const run = lastRun();
    expect(run).toMatchObject({ status: 'running', name: NAME });
    expect(run).not.toHaveProperty('started');
    expect(run).not.toHaveProperty('done');
    expect(run).not.toHaveProperty('phases');
  });

  it('C4.5 sends a run only when its view changed, not on a quiet tick', () => {
    leadLine(launchRecord());
    appendJournal([started('a1')]);
    writeAgent('a1');
    tick();
    const sent = runMessages().length;
    expect(sent).toBeGreaterThan(0);

    tick();
    tick();
    expect(runMessages()).toHaveLength(sent);

    appendJournal([result('a1')]);
    tick();
    expect(runMessages()).toHaveLength(sent + 1);
  });

  it('C4.6 cuts the name like a label: control and format runs become one space, 60 code points', () => {
    leadLine(
      launchRecord('async_launched', WF_TOOL_ID, RUN, `\u202Ereview\u200B\n${'\u00e9'.repeat(70)}`),
    );
    appendJournal([started('a1')]);
    tick();

    expect(lastRun()?.name).toBe(`review ${'\u00e9'.repeat(53)}`);
  });

  it('C4.6b names at most 32 phases but counts every agent', () => {
    leadLine(launchRecord());
    appendJournal(Array.from({ length: 40 }, (_, i) => started(`a${i}`, 'l', `phase ${i}`)));
    tick();

    const run = lastRun();
    expect(run?.phases).toHaveLength(32);
    expect(run?.started).toBe(40);
  });

  it('C4.1 done counts survive helper teardown, a result and a kill alike', () => {
    leadLine(launchRecord());
    appendJournal([started('a1'), started('a2'), started('a3')]);
    const files = ['a1', 'a2', 'a3'].map((id) => writeAgent(id));
    tick();
    expect(files.map(watchesOf)).toEqual([1, 1, 1]);

    appendJournal([result('a1')]);
    tick();
    expect(clearsFor(helperId('a1'))).toHaveLength(1);
    expect(lastRun()).toMatchObject({ started: 3, done: 1 });

    leadLine(notificationRecord('killed'));
    expect(clearsFor(helperId('a2'))).toHaveLength(1);
    expect(lastRun()).toMatchObject({ status: 'done', started: 3, done: 1 });
  });

  it('C4.3 a resume reopening the run with new agents keeps the earlier counts', () => {
    leadLine(launchRecord());
    appendJournal([started('a1', 'x', 'Ground'), started('a2', 'y', 'Ground')]);
    writeAgent('a1');
    writeAgent('a2');
    tick();
    appendJournal([result('a1'), result('a2')]);
    leadLine(notificationRecord('completed'));
    tick();
    expect(lastRun()).toMatchObject({ status: 'done', started: 2, done: 2 });

    appendJournal([started('b1', 'z', 'Plan')]);
    writeAgent('b1');
    tick();

    expect(lastRun()).toMatchObject({
      status: 'running',
      phases: [
        { name: 'Ground', started: 2, done: 2 },
        { name: 'Plan', started: 1, done: 0 },
      ],
      started: 3,
      done: 2,
    });
  });

  it('C4.2 after a restart the run has neither name nor since, and the persisted record holds no name', () => {
    const adapter = memoryAdapter();
    store.setAdapter(adapter);
    leadLine(launchRecord());
    appendJournal([started('a1', 'x', 'Ground'), result('a1'), started('a2', 'y', 'Ground')]);
    writeAgent('a1');
    writeAgent('a2');
    tick();
    expect(lastRun()).toMatchObject({ name: NAME });
    expect(lastRun()).toHaveProperty('since');
    const record = JSON.parse(JSON.stringify(adapter.saved.at(-1)?.[0]));
    expect(JSON.stringify(record)).not.toContain(NAME);

    runtime.removeAgent(1);
    fs.writeFileSync(lead.jsonlFile, '');
    store.setAdapter(memoryAdapter([record]));
    runtime.restoreExternalAgents();
    tick();

    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => sent.push(m), store);
    expect(sent.filter((m) => m.type === 'workflowRun')).toEqual([
      {
        type: 'workflowRun',
        id: 1,
        runId: RUN,
        status: 'running',
        phases: [{ name: 'Ground', started: 2, done: 1 }],
        started: 2,
        done: 1,
      },
    ]);
  });

  it('C4.4 the name never reaches the log', () => {
    const CANARY = 'canary-crew-name-7f3a';
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }

    leadLine(launchRecord('async_launched', WF_TOOL_ID, RUN, CANARY));
    appendJournal([started('a1', 'x', 'Ground'), started('a2')]);
    writeAgent('a1');
    writeAgent('a2');
    tick();
    appendJournal([result('a1')]);
    tick();
    expect(lastRun()).toMatchObject({ name: CANARY });
    leadLine(notificationRecord('completed'));
    fs.rmSync(runDir(), { recursive: true });
    tick();
    runtime.removeAgent(1);

    // The session logged (each helper's end), so an empty capture would prove nothing.
    expect(logged.some((line) => line.includes('Workflow agent'))).toBe(true);
    expect(logged.filter((line) => line.includes(CANARY))).toEqual([]);
  });

  it('C4.7 a handshake replays every tracked run, done ones included, right after the helpers', () => {
    leadLine(launchRecord());
    leadLine(launchRecord('async_launched', TOOL2, RUN2, 'second-crew'));
    appendJournal([started('a1', 'scan:docs', 'Ground')]);
    appendJournal([started('b1'), result('b1')], RUN2);
    writeAgent('a1');
    writeAgent('b1', { runId: RUN2 });
    tick();
    leadLine(notificationRecord('completed', TOOL2));

    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((m) => sent.push(m), store);
    const replay = sent.filter((m) => m.type === 'subagentPresent' || m.type === 'workflowRun');

    expect(replay.map((m) => m.type)).toEqual(['subagentPresent', 'workflowRun', 'workflowRun']);
    // Runs come in the order their dirs were adopted; the contract is that each is there.
    expect(replay.slice(1)).toHaveLength(2);
    expect(replay.slice(1)).toContainEqual(lastRun(RUN));
    expect(replay.slice(1)).toContainEqual(lastRun(RUN2));
    expect(lastRun(RUN2)).toMatchObject({
      status: 'done',
      name: 'second-crew',
      started: 1,
      done: 1,
    });
  });

  it('C4.8 a run that is dropped clears from the clients with its id alone', () => {
    leadLine(launchRecord());
    appendJournal([started('a1')]);
    writeAgent('a1');
    tick();
    expect(lastRun()).toMatchObject({ status: 'running' });

    fs.rmSync(runDir(), { recursive: true });
    tick();

    expect(lastRun()).toEqual({ type: 'workflowRun', id: 1, runId: RUN });
  });

  it('C4.8b a session end on a lead that stays clears its runs', () => {
    lead.isExternal = false;
    runtime.registerAgent(LEAD_SESSION, 1);
    leadLine(launchRecord());
    appendJournal([started('a1')]);
    writeAgent('a1');
    tick();

    hook({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });

    expect(store.has(1)).toBe(true);
    expect(lastRun()).toEqual({ type: 'workflowRun', id: 1, runId: RUN });
  });
});
