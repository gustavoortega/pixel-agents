import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

import {
  MAX_LINE_BYTES,
  READ_CHUNK_BYTES,
  SUBAGENT_WALK_MAX_DEPTH,
  SUBAGENT_WALK_MAX_ENTRIES,
} from './constants.js';

/**
 * Transcript I/O for the memory server: which files count, and how much of each is read. Only names from a
 * directory listing are opened (no caller input ever reaches a path), only regular files, never through a
 * symlink, and every byte read is charged to the call's budget.
 */

const SESSION_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const SUBAGENT_FILE_RE = /^agent-[A-Za-z0-9_-]+\.jsonl$/;
const NEWLINE = 0x0a;

/** One call's shared read budget: wall clock and bytes, across every file and both tiers. */
export class Budget {
  private readonly deadline: number;
  bytesRead = 0;

  constructor(
    wallMs: number,
    private readonly maxBytes: number,
  ) {
    this.deadline = performance.now() + wallMs;
  }

  get bytesLeft(): number {
    return Math.max(0, this.maxBytes - this.bytesRead);
  }

  get exhausted(): boolean {
    return this.bytesRead >= this.maxBytes || performance.now() >= this.deadline;
  }

  spend(n: number): void {
    this.bytesRead += n;
  }
}

export interface Candidate {
  file: string;
  /** The project folder holding it (its name doubles as the project label fallback). */
  dir: string;
  sessionId: string;
  size: number;
  mtimeMs: number;
}

/** Top-level `<uuid>.jsonl` transcripts of one project folder whose lstat is a regular file. */
export async function listSessionFiles(dir: string): Promise<Candidate[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  for (const name of names) {
    if (!SESSION_FILE_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = await fs.promises.lstat(file);
      if (!st.isFile()) continue;
      out.push({
        file,
        dir,
        sessionId: name.slice(0, -'.jsonl'.length),
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      /* vanished between readdir and lstat */
    }
  }
  return out;
}

/** Project folders under the projects root, as real directories (a symlinked folder is skipped). */
export async function listProjectDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

export interface SubagentInfo {
  /** null past SUBAGENT_WALK_MAX_ENTRIES entries. */
  count: number | null;
  newestMtimeMs: number;
}

async function isRealDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.promises.lstat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Subagent transcripts under `<session>/subagents`, never descending into a symlinked folder. */
export async function walkSubagents(
  projectDir: string,
  sessionId: string,
  withMtime: boolean,
): Promise<SubagentInfo> {
  const sessionDir = path.join(projectDir, sessionId);
  const root = path.join(sessionDir, 'subagents');
  if (!(await isRealDirectory(sessionDir)) || !(await isRealDirectory(root))) {
    return { count: 0, newestMtimeMs: 0 };
  }
  let count = 0;
  let newest = 0;
  let visited = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (visited > SUBAGENT_WALK_MAX_ENTRIES) return { count: null, newestMtimeMs: newest };
      if (entry.isDirectory()) {
        if (depth < SUBAGENT_WALK_MAX_DEPTH) {
          stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !SUBAGENT_FILE_RE.test(entry.name)) continue;
      count++;
      if (!withMtime) continue;
      try {
        const st = await fs.promises.lstat(path.join(dir, entry.name));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {
        /* vanished */
      }
    }
  }
  return { count, newestMtimeMs: newest };
}

/** Open for reading without following a symlink or blocking on a FIFO, and only if it is a regular file. */
async function openRegular(
  file: string,
): Promise<{ fh: fs.promises.FileHandle; size: number } | null> {
  const flags =
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(file, flags);
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    if (st.isFile()) return { fh, size: st.size };
  } catch {
    /* fall through to close */
  }
  await fh.close().catch(() => undefined);
  return null;
}

/** Split complete lines; a line over MAX_LINE_BYTES is dropped. */
function splitLines(buf: Buffer, dropFirst: boolean, dropLast: boolean): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  let first = true;
  while (start <= buf.length) {
    const nl = buf.indexOf(NEWLINE, start);
    const end = nl === -1 ? buf.length : nl;
    const isLast = nl === -1;
    const skip = (first && dropFirst) || (isLast && dropLast);
    if (!skip && end > start && end - start <= MAX_LINE_BYTES) lines.push(buf.subarray(start, end));
    first = false;
    if (isLast) break;
    start = nl + 1;
  }
  return lines;
}

export interface HeadTail {
  head: Buffer[];
  /** Empty when `whole`: the head then holds every line. */
  tail: Buffer[];
  whole: boolean;
}

async function readAt(
  fh: fs.promises.FileHandle,
  position: number,
  length: number,
  budget: Budget,
): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await fh.read(buf, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  budget.spend(filled);
  return filled === length ? buf : buf.subarray(0, filled);
}

/**
 * Tier 1: the first `headBytes` and the last `tailBytes` of a transcript (the whole file when it is no larger
 * than both), with the partial lines at the cuts dropped. 'budget' when the budget cannot cover it, null when
 * it is no longer a readable regular file.
 */
export async function readHeadTail(
  c: Candidate,
  headBytes: number,
  tailBytes: number,
  budget: Budget,
): Promise<HeadTail | 'budget' | null> {
  if (budget.exhausted || Math.min(c.size, headBytes + tailBytes) > budget.bytesLeft) {
    return 'budget';
  }
  const opened = await openRegular(c.file);
  if (!opened) return null;
  const { fh, size } = opened;
  try {
    if (size <= headBytes + tailBytes) {
      const buf = await readAt(fh, 0, size, budget);
      return { head: splitLines(buf, false, false), tail: [], whole: true };
    }
    const head = await readAt(fh, 0, headBytes, budget);
    const tail = await readAt(fh, size - tailBytes, tailBytes, budget);
    return {
      head: splitLines(head, false, true),
      tail: splitLines(tail, true, false),
      whole: false,
    };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/**
 * Tier 2: every line of a transcript in order, up to its size when opened (or `maxBytes`), under the budget.
 * Lines over MAX_LINE_BYTES are skipped without being decoded or kept, but their bytes count. `onLine` gets
 * complete lines only (the buffer is reused once it returns) and returns true to stop the scan there. Returns
 * true when the scan read to its end or was stopped, false when the budget stopped it early, and null when the
 * file could not be opened as a regular file (gone, unreadable): no budget ran out, so callers skip the file.
 */
export async function scanLines(
  file: string,
  budget: Budget,
  onLine: (line: Buffer) => boolean | void,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<boolean | null> {
  const opened = await openRegular(file);
  if (!opened) return null;
  const { fh, size } = opened;
  const limit = Math.min(size, maxBytes);
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let carry: Buffer[] = [];
  let carryLen = 0;
  let skipping = false;
  let position = 0;
  try {
    while (position < limit) {
      if (budget.exhausted) return false;
      const want = Math.min(READ_CHUNK_BYTES, budget.bytesLeft, limit - position);
      const { bytesRead } = await fh.read(chunk, 0, want, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      budget.spend(bytesRead);
      let start = 0;
      while (start < bytesRead) {
        const nl = chunk.indexOf(NEWLINE, start);
        const end = nl === -1 || nl >= bytesRead ? bytesRead : nl;
        const ended = end < bytesRead;
        if (skipping) {
          if (ended) skipping = false;
        } else if (carryLen + (end - start) > MAX_LINE_BYTES) {
          carry = [];
          carryLen = 0;
          skipping = !ended;
        } else if (!ended) {
          carry.push(Buffer.from(chunk.subarray(start, end)));
          carryLen += end - start;
        } else {
          const piece = chunk.subarray(start, end);
          const line = carryLen > 0 ? Buffer.concat([...carry, piece]) : piece;
          carry = [];
          carryLen = 0;
          if (line.length > 0 && onLine(line) === true) return true;
        }
        start = end + 1;
      }
    }
    // A last line without a newline is complete only at the end of the file, never at `maxBytes`.
    if (position >= size && !skipping && carryLen > 0) onLine(Buffer.concat(carry));
    return true;
  } finally {
    await fh.close().catch(() => undefined);
  }
}
