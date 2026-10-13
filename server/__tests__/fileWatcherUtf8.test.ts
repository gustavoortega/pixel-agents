import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// readNewLines hands every complete line to the transcript parser; recording
// those lines is how these tests see what the reader decoded.
vi.mock('../src/transcriptParser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/transcriptParser.js')>()),
  processTranscriptLine: vi.fn(),
}));

import { AgentStateStore } from '../src/agentStateStore.js';
import { TRANSCRIPT_READ_CHUNK_BYTES } from '../src/constants.js';
import { readNewLines } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { processTranscriptLine } from '../src/transcriptParser.js';
import { deriveAgentTurnState } from '../src/turnStateSeed.js';
import type { AgentState } from '../src/types.js';

const AGENT_ID = 1;
/** U+1F600, four bytes: F0 9F 98 80. */
const EMOJI = '😀';

let tmp: string;
let file: string;
let store: AgentStateStore;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-utf8-'));
  file = path.join(tmp, 'session.jsonl');
  store = new AgentStateStore();
  vi.mocked(processTranscriptLine).mockClear();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function watchedAgent(): AgentState {
  const agent = {
    id: AGENT_ID,
    jsonlFile: file,
    fileOffset: 0,
    lineBuffer: '',
    permissionSent: false,
    hookDelivered: false,
  } as unknown as AgentState;
  store.set(AGENT_ID, agent);
  return agent;
}

function read(): void {
  readNewLines(AGENT_ID, store, new Map(), new Map());
}

/** The `t` field of every line the reader handed to the parser, in order. A
 *  split character still parses, as U+FFFD, so the text is the assertion. */
function parsedTexts(): string[] {
  return vi
    .mocked(processTranscriptLine)
    .mock.calls.map(([, line]) => (JSON.parse(line) as { t: string }).t);
}

/** `{"t":"<text>"}` plus a newline, as bytes. */
function record(text: string): Buffer {
  return Buffer.from(`${JSON.stringify({ t: text })}\n`);
}

describe('readNewLines: a character split across two reads', () => {
  it('decodes ñ whole when the read cap falls inside it', () => {
    // Pad the first record so the second one's ñ (C3 B1) straddles the cap.
    const ene = Buffer.byteLength('{"t":"a');
    const pad = 'x'.repeat(TRANSCRIPT_READ_CHUNK_BYTES - 1 - ene - record('').length);
    const contents = Buffer.concat([record(pad), record('año'), record(EMOJI)]);
    expect([
      contents[TRANSCRIPT_READ_CHUNK_BYTES - 1],
      contents[TRANSCRIPT_READ_CHUNK_BYTES],
    ]).toEqual([0xc3, 0xb1]);
    fs.writeFileSync(file, contents);
    watchedAgent();

    read();
    read();

    expect(parsedTexts()).toEqual([pad, 'año', EMOJI]);
  });

  it.each([1, 2, 3])(
    'decodes %i byte(s) of an emoji read before the writer finished it',
    (bytesBeforeSplit) => {
      const line = record(EMOJI);
      const split = Buffer.byteLength('{"t":"') + bytesBeforeSplit;
      fs.writeFileSync(file, line.subarray(0, split));
      watchedAgent();
      read();
      fs.appendFileSync(file, line.subarray(split));
      read();

      expect(parsedTexts()).toEqual([EMOJI]);
    },
  );
});

describe('deriveAgentTurnState: a tail that ends mid-character', () => {
  it('leaves the partial emoji for readNewLines to decode whole', () => {
    const line = record(EMOJI);
    const split = Buffer.byteLength('{"t":"') + 2;
    fs.writeFileSync(
      file,
      Buffer.concat([
        Buffer.from('{"type":"user","message":{"content":"go"}}\n'),
        line.subarray(0, split),
      ]),
    );
    const agent = watchedAgent();
    deriveAgentTurnState(agent, claudeProvider);
    fs.appendFileSync(file, line.subarray(split));

    read();

    expect(parsedTexts()).toEqual([EMOJI]);
  });
});
