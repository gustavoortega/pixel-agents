import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TokenUsage } from '../../core/src/messages.js';
import type { TranscriptUsageSource } from '../../core/src/provider.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { TokenLedger } from '../src/tokenLedger.js';

const claudeSource = claudeProvider.transcriptUsage as TranscriptUsageSource;

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = Date.parse('2026-10-11T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();

interface LineSpec {
  id: string;
  sid: string;
  ts: number;
  usage?: [number, number, number, number];
  model?: string;
}

function usageLine(spec: LineSpec): string {
  const [i, cw, cr, o] = spec.usage ?? [10, 0, 0, 0];
  return JSON.stringify({
    type: 'assistant',
    sessionId: spec.sid,
    timestamp: iso(spec.ts),
    message: {
      id: spec.id,
      model: spec.model ?? 'claude-opus-5-5',
      usage: {
        input_tokens: i,
        cache_creation_input_tokens: cw,
        cache_read_input_tokens: cr,
        output_tokens: o,
      },
    },
  });
}

/** An API-error record announcing a quota: synthetic, so it carries no countable usage. */
function quotaLine(ts: number, rateLimitType: string, resetsAtSec: number): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'quota-session',
    timestamp: iso(ts),
    quotaLimits: { status: 'rejected', resetsAt: resetsAtSec, rateLimitType },
    message: { id: 'err-1', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
  });
}

describe('TokenLedger', () => {
  let tmp: string;
  let projects: string;
  let cachePath: string;
  let emitted: TokenUsage[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    projects = path.join(tmp, 'projects');
    cachePath = path.join(tmp, 'ledger-cache.json');
    fs.mkdirSync(projects);
    emitted = [];
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function write(rel: string, lines: string[], trailingNewline = true): string {
    const file = path.join(projects, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + (trailingNewline ? '\n' : ''));
    return file;
  }

  function ledger(
    over: {
      source?: TranscriptUsageSource;
      mappings?: Record<string, string[]>;
      budgets?: { budget5h?: number; budgetWeek?: number };
    } = {},
  ): TokenLedger {
    return new TokenLedger({
      source: over.source ?? claudeSource,
      root: projects,
      cachePath,
      now: () => NOW,
      getAreaMappings: () => over.mappings ?? {},
      getBudgets: () => over.budgets ?? {},
      onChange: (m) => emitted.push(m),
    });
  }

  async function scan(l: TokenLedger): Promise<TokenUsage> {
    await l.runPass();
    return l.snapshot();
  }

  /** Counts how many lines reach the provider's parser: the lines the ledger actually read. */
  function countingSource(): { source: TranscriptUsageSource; parsed: () => number } {
    let n = 0;
    return {
      source: {
        ...claudeSource,
        parseUsageLine: (line, fallback) => {
          n++;
          return claudeSource.parseUsageLine(line, fallback);
        },
      },
      parsed: () => n,
    };
  }

  describe('first pass', () => {
    it('reports scanning with no totals or ranking until the first pass completes', async () => {
      write('-Users-x-repo/s1.jsonl', [usageLine({ id: 'm1', sid: 's1', ts: NOW - H })]);
      const l = ledger();
      const pass = l.runPass();
      const during = l.snapshot();
      expect(during.scanning).toBe(true);
      expect(during.week).toBeUndefined();
      expect(during.block).toBeUndefined();
      await pass;
      const after = l.snapshot();
      expect(after.scanning).toBeUndefined();
      expect(after.week?.total).toBe(10);
      expect(emitted.at(-1)?.week?.total).toBe(10);
    });
  });

  describe('duplicates and attribution', () => {
    // "zzz" is the original session; "aaa" resumed it, so m2 appears in both files with IDENTICAL timestamps. The
    // original's own first record is earlier, so it owns m2 even though "aaa" sorts first.
    function seedCopies(): void {
      write('-Users-x-repo/zzz.jsonl', [
        usageLine({ id: 'm1', sid: 'zzz', ts: NOW - 5 * H, usage: [100, 0, 0, 0] }),
        usageLine({ id: 'm2', sid: 'zzz', ts: NOW - 4 * H, usage: [0, 0, 0, 100] }),
        // streaming repeat of m2 with a SMALLER later line: the max must survive, not the last line.
        usageLine({ id: 'm2', sid: 'zzz', ts: NOW - 4 * H, usage: [0, 0, 0, 60] }),
      ]);
      write('-Users-x-repo/aaa.jsonl', [
        usageLine({ id: 'm2', sid: 'aaa', ts: NOW - 4 * H, usage: [0, 0, 0, 100] }),
        usageLine({ id: 'm3', sid: 'aaa', ts: NOW - 3 * H, usage: [7, 0, 0, 0] }),
      ]);
    }

    function shuffled(seed: number): TranscriptUsageSource {
      return {
        ...claudeSource,
        listTranscripts: async (root, min) => {
          const list = await claudeSource.listTranscripts(root, min);
          // Deterministic Fisher-Yates so each seed is a different, reproducible order.
          let x = seed * 7919 + 13;
          for (let i = list.length - 1; i > 0; i--) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            const j = x % (i + 1);
            [list[i], list[j]] = [list[j], list[i]];
          }
          return list;
        },
      };
    }

    it('counts a repeated message id once with the per-field max, owned by the earliest session, in any file order', async () => {
      seedCopies();
      const results: string[] = [];
      for (let seed = 1; seed <= 5; seed++) {
        const snap = await scan(ledger({ source: shuffled(seed) }));
        const bySession = Object.fromEntries(
          snap.week!.bySession.map((s) => [s.sessionId, s.total]),
        );
        expect(bySession).toEqual({ zzz: 100 + 500, aaa: 7 });
        expect(snap.week!.total).toBe(100 + 500 + 7);
        results.push(JSON.stringify(snap.week));
        fs.rmSync(cachePath, { force: true });
      }
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('windows', () => {
    it('excludes records older than 7 days from the week', async () => {
      write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'old', sid: 's1', ts: NOW - 7 * D - H, usage: [1000, 0, 0, 0] }),
        usageLine({ id: 'new', sid: 's1', ts: NOW - 6 * D, usage: [10, 0, 0, 0] }),
      ]);
      const snap = await scan(ledger());
      expect(snap.week?.total).toBe(10);
      expect(snap.week?.source).toBe('estimated');
    });

    it('anchors the week to a future seven_day reset (epoch seconds) and drops older records', async () => {
      const resetsAt = NOW + 2 * D;
      write('-Users-x-repo/s1.jsonl', [
        // inside a rolling 7 d, but before reset - 7 d = NOW - 5 d
        usageLine({ id: 'before', sid: 's1', ts: NOW - 6 * D, usage: [1000, 0, 0, 0] }),
        usageLine({ id: 'inside', sid: 's1', ts: NOW - 2 * D, usage: [10, 0, 0, 0] }),
        quotaLine(NOW - D, 'seven_day', resetsAt / 1000),
      ]);
      const snap = await scan(ledger());
      expect(snap.week).toMatchObject({
        source: 'quota',
        start: resetsAt - 7 * D,
        end: resetsAt,
        total: 10,
      });
    });

    it('has no block when now is outside every block, and a block when inside one', async () => {
      write('-Users-x-repo/s1.jsonl', [usageLine({ id: 'm', sid: 's1', ts: NOW - 6 * H })]);
      expect((await scan(ledger())).block).toBeUndefined();
      write('-Users-x-repo/s2.jsonl', [usageLine({ id: 'n', sid: 's2', ts: NOW - H })]);
      const snap = await scan(ledger());
      expect(snap.block?.total).toBe(10);
    });
  });

  describe('sub-agent files and areas', () => {
    it('attributes a sub-agent transcript to its parent session and project, area via mappings', async () => {
      write('-Users-x-repoa/parent-1/subagents/agent-abc.jsonl', [
        usageLine({ id: 'sub1', sid: 'parent-1', ts: NOW - H, usage: [40, 0, 0, 0] }),
      ]);
      write('-Users-x-other/parent-2.jsonl', [
        usageLine({ id: 'top1', sid: 'parent-2', ts: NOW - H, usage: [10, 0, 0, 0] }),
      ]);
      const snap = await scan(ledger({ mappings: { repoa: ['Dev'] } }));
      expect(snap.week!.bySession.map((s) => [s.sessionId, s.folder, s.area])).toEqual([
        ['parent-1', 'repoa', 'Dev'],
        ['parent-2', 'other', null],
      ]);
      expect(snap.week!.byArea.map((a) => [a.area, a.folder])).toEqual([
        ['Dev', 'repoa'],
        [null, 'other'],
      ]);
    });

    it('C8 counts a workflow agent transcript once, to its lead session', async () => {
      write('-Users-x-repoa/lead-1.jsonl', [
        usageLine({ id: 'lead1', sid: 'lead-1', ts: NOW - H, usage: [10, 0, 0, 0] }),
      ]);
      // Workflow agents write sidechain records stamped with the lead's sessionId.
      write('-Users-x-repoa/lead-1/subagents/workflows/wf_run-1/agent-a1.jsonl', [
        usageLine({ id: 'wf1', sid: 'lead-1', ts: NOW - H, usage: [0, 0, 0, 300] }),
        // A streaming repeat of the same message: counted once.
        usageLine({ id: 'wf1', sid: 'lead-1', ts: NOW - H, usage: [0, 0, 0, 300] }),
      ]);
      const snap = await scan(ledger());
      expect(snap.week!.bySession.map((s) => [s.sessionId, s.total])).toEqual([
        ['lead-1', 10 + 5 * 300],
      ]);
    });

    it('titles a session from custom-title, else ai-title', async () => {
      write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'm', sid: 's1', ts: NOW - H }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'generated', sessionId: 's1' }),
        JSON.stringify({ type: 'custom-title', customTitle: 'mine', sessionId: 's1' }),
      ]);
      expect((await scan(ledger())).week!.bySession[0].title).toBe('mine');
    });
  });

  describe('titles across passes', () => {
    it("keeps a title that arrives a pass before its session's first usage record", async () => {
      const file = write('-Users-x-repo/s1.jsonl', [
        JSON.stringify({ type: 'ai-title', aiTitle: 'early title', sessionId: 's1' }),
      ]);
      const l = ledger();
      await scan(l);
      fs.appendFileSync(file, usageLine({ id: 'm1', sid: 's1', ts: NOW - H }) + '\n');
      expect((await scan(l)).week!.bySession[0].title).toBe('early title');
    });
  });

  describe('budgets', () => {
    it('adds no percent fields when budgets are unset', async () => {
      write('-Users-x-repo/s1.jsonl', [usageLine({ id: 'm', sid: 's1', ts: NOW - H })]);
      const snap = await scan(ledger());
      expect(snap).not.toHaveProperty('budget5h');
      expect(snap).not.toHaveProperty('budgetWeek');
      for (const w of [snap.block!, snap.week!]) {
        expect(w).not.toHaveProperty('budgetPct');
        expect(w.byArea[0]).not.toHaveProperty('budgetPct');
      }
    });

    it('adds percent fields against the matching budget when set', async () => {
      write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'm', sid: 's1', ts: NOW - H, usage: [50, 0, 0, 0] }),
      ]);
      const snap = await scan(ledger({ budgets: { budget5h: 100, budgetWeek: 500 } }));
      expect(snap.block?.budgetPct).toBe(0.5);
      expect(snap.week?.budgetPct).toBe(0.1);
      expect(snap.week?.byArea[0].budgetPct).toBe(0.1);
    });
  });

  describe('incremental reads', () => {
    it('does not consume a partial trailing line, then counts it once when completed', async () => {
      const file = write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'm1', sid: 's1', ts: NOW - 3 * H, usage: [10, 0, 0, 0] }),
      ]);
      const second = usageLine({ id: 'm2', sid: 's1', ts: NOW - 2 * H, usage: [20, 0, 0, 0] });
      const cut = Math.floor(second.length / 2);
      fs.appendFileSync(file, second.slice(0, cut));
      const l = ledger();
      expect((await scan(l)).week?.total).toBe(10);
      fs.appendFileSync(file, second.slice(cut) + '\n');
      expect((await scan(l)).week?.total).toBe(30);
      expect((await scan(l)).week?.total).toBe(30);
    });

    it('reads only appended bytes on later passes', async () => {
      const { source, parsed } = countingSource();
      const file = write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'm1', sid: 's1', ts: NOW - 3 * H }),
        usageLine({ id: 'm2', sid: 's1', ts: NOW - 2 * H }),
      ]);
      const l = ledger({ source });
      await scan(l);
      expect(parsed()).toBe(2);
      fs.appendFileSync(file, usageLine({ id: 'm3', sid: 's1', ts: NOW - H }) + '\n');
      const snap = await scan(l);
      expect(parsed()).toBe(3);
      expect(snap.week?.total).toBe(30);
    });

    it('rescans a file that shrank below its offset', async () => {
      const file = write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'a', sid: 's1', ts: NOW - 3 * H }),
        usageLine({ id: 'b', sid: 's1', ts: NOW - 2 * H }),
        usageLine({ id: 'c', sid: 's1', ts: NOW - H }),
      ]);
      const l = ledger();
      expect((await scan(l)).week?.total).toBe(30);
      fs.writeFileSync(
        file,
        usageLine({ id: 'z', sid: 's1', ts: NOW - H, usage: [5, 0, 0, 0] }) + '\n',
      );
      const snap = await scan(l);
      // a, b, c stay (records are keyed by message id and pruned by age); z must have been read.
      expect(snap.week?.total).toBe(35);
    });

    it('skips lines without a usage or title marker before parsing them', async () => {
      const { source, parsed } = countingSource();
      write('-Users-x-repo/s1.jsonl', [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        usageLine({ id: 'm1', sid: 's1', ts: NOW - H }),
      ]);
      await scan(ledger({ source }));
      expect(parsed()).toBe(1);
    });
  });

  describe('cache', () => {
    it('a restart from the cache keeps totals, titles and quota without re-reading anything', async () => {
      const resetsAt = NOW + 2 * D;
      write('-Users-x-repo/s1.jsonl', [
        usageLine({ id: 'm1', sid: 's1', ts: NOW - 2 * D, usage: [10, 0, 0, 0] }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'kept', sessionId: 's1' }),
        quotaLine(NOW - D, 'seven_day', resetsAt / 1000),
      ]);
      const first = ledger();
      const before = await scan(first);
      first.dispose();
      expect(fs.existsSync(cachePath)).toBe(true);

      const { source, parsed } = countingSource();
      const after = await scan(ledger({ source }));
      expect(parsed()).toBe(0);
      expect(after.week).toEqual(before.week);
      expect(after.week?.source).toBe('quota');
      expect(after.week?.bySession[0].title).toBe('kept');
    });

    it('treats a corrupt cache as absent and scans cold', async () => {
      fs.writeFileSync(cachePath, '{not json');
      write('-Users-x-repo/s1.jsonl', [usageLine({ id: 'm1', sid: 's1', ts: NOW - H })]);
      expect((await scan(ledger())).week?.total).toBe(10);
    });
  });
});
