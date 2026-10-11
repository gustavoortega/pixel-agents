import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTripwireRules } from '../src/tripwireConfig.js';
import { DEFAULT_TRIPWIRE_RULES } from '../src/tripwireDefaults.js';
import { evaluateTripwires } from '../src/tripwires.js';

describe('loadTripwireRules', () => {
  let dir: string;
  let file: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tripwires-'));
    file = path.join(dir, 'tripwires.json');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: unknown): void => fs.writeFileSync(file, JSON.stringify(cfg));
  const userRule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'my-rule',
    name: 'My rule',
    severity: 'low',
    tool: '^Bash$',
    input: 'forbidden',
    ...over,
  });
  const ids = (rules: readonly { id: string }[]): string[] => rules.map((r) => r.id);

  it('uses the defaults when the file is missing', () => {
    expect(loadTripwireRules(file)).toEqual(DEFAULT_TRIPWIRE_RULES);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the defaults and logs once when the JSON is malformed', () => {
    fs.writeFileSync(file, '{ not json');
    expect(loadTripwireRules(file)).toEqual(DEFAULT_TRIPWIRE_RULES);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the defaults when the root is not an object', () => {
    write([userRule()]);
    expect(loadTripwireRules(file)).toEqual(DEFAULT_TRIPWIRE_RULES);
  });

  it('adds a valid user rule that then fires', () => {
    write({ rules: [userRule()] });
    const rules = loadTripwireRules(file);
    expect(rules).toHaveLength(DEFAULT_TRIPWIRE_RULES.length + 1);
    expect(evaluateTripwires(rules, 'Bash', { command: 'echo forbidden' })?.id).toBe('my-rule');
  });

  it('honors flags and ignoreKeys on a user rule', () => {
    write({ rules: [userRule({ flags: 'i', ignoreKeys: ['note'] })] });
    const rules = loadTripwireRules(file);
    expect(evaluateTripwires(rules, 'Bash', { command: 'FORBIDDEN' })?.id).toBe('my-rule');
    expect(evaluateTripwires(rules, 'Bash', { note: 'forbidden' })).toBeNull();
  });

  it.each([
    ['a bad regex', { input: '(' }],
    ['an id with a newline', { id: 'a\nb' }],
    ['an id with uppercase', { id: 'Bad' }],
    ['a name with <', { name: '<b>x</b>' }],
    ['a name over 80 chars', { name: 'x'.repeat(81) }],
    ['an empty name', { name: '' }],
    ['a non-ASCII name', { name: 'café' }],
    ['an unknown severity', { severity: 'critical' }],
    ['a flag outside i and m', { flags: 'g' }],
    ['a non-string tool', { tool: 5 }],
  ])('skips a rule with %s and keeps the rest', (_label, over) => {
    write({ rules: [userRule(over), userRule({ id: 'good' })] });
    const rules = loadTripwireRules(file);
    // Only the valid rule joins the defaults; the bad one leaves no trace.
    expect(ids(rules)).toEqual([...ids(DEFAULT_TRIPWIRE_RULES), 'good']);
  });

  it('logs a skipped rule by index, never by its raw id or name', () => {
    write({ rules: [userRule({ id: 'SECRET\nID', name: 'SECRET NAME \u0007' })] });
    loadTripwireRules(file);
    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('#0');
    expect(logged).not.toContain('SECRET');
  });

  it('replaces a default with a user rule of the same id, in place', () => {
    write({ rules: [userRule({ id: 'dotenv', severity: 'low' })] });
    const rules = loadTripwireRules(file);
    expect(rules).toHaveLength(DEFAULT_TRIPWIRE_RULES.length);
    expect(ids(rules)).toEqual(ids(DEFAULT_TRIPWIRE_RULES));
    expect(rules.find((r) => r.id === 'dotenv')?.name).toBe('My rule');
  });

  it('removes defaults named in disable', () => {
    write({ disable: ['dotenv', 'no-such-rule'] });
    const rules = loadTripwireRules(file);
    expect(ids(rules)).not.toContain('dotenv');
    expect(rules).toHaveLength(DEFAULT_TRIPWIRE_RULES.length - 1);
  });

  it('turns every rule off with enabled: false', () => {
    write({ enabled: false, rules: [userRule()] });
    expect(loadTripwireRules(file)).toEqual([]);
  });
});
