import { TEST_SUMMARY_TAIL_LINES } from './constants.js';

const PASSED = /\b(\d+)\s+(?:tests?\s+)?(?:passed|passing)\b/i;
const FAILED = /\b(\d+)\s+(?:tests?\s+)?(?:failed|failing)\b/i;

/**
 * The pass and fail counts of a test runner's summary line in a shell command's output, or
 * null when there is none.
 *
 * Reads up to TEST_SUMMARY_TAIL_LINES lines from the end, and the first line naming a passed
 * or failed count is the summary: vitest, jest, pytest, mocha and cargo all print it last.
 * A count the line leaves out is 0, and a line with nothing passed or failed is no summary.
 * Output with no counts at all (go's `ok` and `FAIL`, a build) is null: an exit code proves
 * nothing about tests, so callers must never count it.
 */
export function parseTestSummary(text: string): { passed: number; failed: number } | null {
  const body = text.trimEnd();
  let end = body.length;
  for (let n = 0; n < TEST_SUMMARY_TAIL_LINES; n++) {
    // Walk back one line at a time: a test log can be megabytes, the summary is at its end.
    const newline = end > 0 ? body.lastIndexOf('\n', end - 1) : -1;
    const line = body.slice(newline + 1, end);
    const passed = PASSED.exec(line);
    const failed = FAILED.exec(line);
    if (passed || failed) {
      const counts = {
        passed: passed ? Number(passed[1]) : 0,
        failed: failed ? Number(failed[1]) : 0,
      };
      return counts.passed === 0 && counts.failed === 0 ? null : counts;
    }
    if (newline < 0) break;
    end = newline;
  }
  return null;
}
