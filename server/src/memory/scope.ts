import * as fs from 'fs';
import * as path from 'path';

import { normalizeProjectPath } from '../../../core/src/normalizeProjectPath.js';
import { UNDER_MAX_CHARS } from './constants.js';

/**
 * Which transcripts a call may read. The project tools read one folder, derived from the server's own
 * environment (never from a tool argument), and keep only the transcripts whose recorded cwd is the project
 * path; the all-projects tool filters the listing by folder name and by each transcript's recorded cwd, and
 * never builds a path from its `under` argument.
 */

export function projectsRoot(home: string): string {
  return path.join(home, '.claude', 'projects');
}

/** CLAUDE_PROJECT_DIR when Claude Code set it to an absolute path, else the cwd. Never realpath'd: Claude
 *  Code names the transcript folder from the raw cwd. */
export function resolveProjectPath(env: NodeJS.ProcessEnv, cwd: string): string {
  const fromEnv = env['CLAUDE_PROJECT_DIR'];
  return typeof fromEnv === 'string' && path.isAbsolute(fromEnv) ? fromEnv : cwd;
}

/**
 * The project's transcript folder, or null. lstat, so a symlinked folder is refused the way listProjectDirs
 * skips one. The name is matched as is: a case-insensitive volume resolves another case by itself, and on a
 * case-sensitive one a folder named in another case belongs to another directory.
 */
export function resolveProjectDir(home: string, projectPath: string): string | null {
  const dir = path.join(projectsRoot(home), normalizeProjectPath(projectPath));
  try {
    return fs.lstatSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

const CASE_INSENSITIVE_PLATFORMS = new Set(['darwin', 'win32']);

function withoutTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 1 && p.charCodeAt(end - 1) === 0x2f) end--;
  return p.slice(0, end);
}

/**
 * S4 for the project tools: a transcript is this project's only when its recorded cwd is the project path.
 * Folder names are lossy (/a/b-c and /a/b/c share one), and a transcript hard-linked in from another folder
 * passes every check on the file itself. Case-insensitive on the platforms whose volumes usually are.
 */
export function isProjectCwd(cwd: string | null, projectPath: string): boolean {
  if (cwd === null) return false;
  const a = withoutTrailingSlashes(cwd);
  const b = withoutTrailingSlashes(projectPath);
  return CASE_INSENSITIVE_PLATFORMS.has(process.platform)
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/** `under` as the all-projects tool compares it: absolute, at most 512 chars, no trailing slash ('/' stays). */
export function canonicalUnder(raw: string): string | null {
  if (raw.length === 0 || raw.length > UNDER_MAX_CHARS || !raw.startsWith('/')) return null;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Folder-name prefilter. Names are lossy (tn/foo-bar and tn/foo/bar share one), so the cwd check decides. */
export function dirMatchesUnder(dirName: string, under: string): boolean {
  if (under === '/') return true;
  const prefix = normalizeProjectPath(under);
  return dirName === prefix || dirName.startsWith(prefix + '-');
}

export function cwdMatchesUnder(cwd: string, under: string): boolean {
  if (under === '/') return cwd.startsWith('/');
  return cwd === under || cwd.startsWith(under + '/');
}
