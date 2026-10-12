import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { SERVER_TOKEN_FILE_NAME, SERVER_TOKEN_PATTERN } from './constants.js';

/** Whether `token` may be a standalone server token (from `--token` or the token file). */
export function isValidServerToken(token: string): boolean {
  return SERVER_TOKEN_PATTERN.test(token);
}

/**
 * The standalone server's token, read from `<dir>/server-token` or minted and written
 * there (0600). Reusing it across restarts is what keeps the printed URL valid: a tab
 * opened with it reconnects after a restart instead of being refused with 4001.
 *
 * A missing, unreadable or invalid file gets a fresh token. A failed write is logged and
 * the fresh token serves this run only: the server still starts.
 */
export function loadOrCreateToken(dir: string): string {
  const filePath = path.join(dir, SERVER_TOKEN_FILE_NAME);
  try {
    const stored = fs.readFileSync(filePath, 'utf-8').trim();
    if (isValidServerToken(stored)) return stored;
  } catch {
    // No usable file: mint one below.
  }
  const token = crypto.randomUUID();
  try {
    // A fresh install has no settings dir yet: the first persist creates it, after start.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, token, { mode: 0o600 });
    // The create mode does not apply to a leftover tmp file with looser bits.
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to write the server token file: ${e}`);
  }
  return token;
}
