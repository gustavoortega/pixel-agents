import { performance } from 'perf_hooks';

import { ELLIPSIS, FIELD_REDACTED, REDACT_MAX_MS, REDACT_RAW_PREFIX_CHARS } from './constants.js';

/**
 * Redaction for every string the memory server outputs. Order is fixed: first 4,096 chars of the raw value
 * (minus the word that cut splits), NFKC, ANSI escapes stripped, the table below, the whole-field fail-closed
 * check, then the caller's cut. Search runs on this output, never on raw text: matching raw text and redacting
 * only the excerpt turns hit counts into a one-character-per-probe oracle for secrets.
 */

interface Rule {
  re: RegExp;
  to: string;
}

const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Key names of the credential rules: alone (password, token), joined to a prefix (PGPASSWORD, dbPassword,
 * jwtSecret, idToken) or with a known suffix (SECRET_KEY_BASE). Shared by the quoted and the bare value rule.
 */
const CREDENTIAL_KEY = String.raw`(?:[a-z0-9]*?(?:password|passwd|passphrase|secret|token|api[_-]?key)|secret[_-]?access[_-]?key|session[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|access[_-]?key|client[_-]?secret|private[_-]?key|secret[_-]?key(?:[_-]?base)?|pass|pwd|credentials?|authorization)`;
/** `=`, `:`, `=>` or their URL-encoded forms, after the quotes and backslashes of JSON nested in CLI JSON. */
const CREDENTIAL_SEPARATOR = String.raw`[\\"'\s]*(?:[:=]|%3[ad])+>?`;

/** Specific prefixes first, the generic key/value rule last. */
const RULES: readonly Rule[] = [
  {
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    to: '[REDACTED:private-key]',
  },
  { re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, to: '[REDACTED:aws-key-id]' },
  {
    re: /(aws_secret_access_key|secret_access_key|secretaccesskey)([\s\S]{0,60}?)(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
    to: '$1$2[REDACTED:aws-secret]',
  },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, to: '[REDACTED:github-token]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, to: '[REDACTED:github-token]' },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: '[REDACTED:slack-token]' },
  {
    re: /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
    to: 'hooks.slack.com/services/[REDACTED:slack-webhook]',
  },
  { re: /\bAIza[0-9A-Za-z_-]{35}/g, to: '[REDACTED:google-key]' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, to: '[REDACTED:anthropic-key]' },
  { re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g, to: '[REDACTED:openai-key]' },
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g, to: '[REDACTED:stripe-key]' },
  { re: /\bsk-[A-Za-z0-9]{20,}/g, to: '[REDACTED:secret-key]' },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g, to: '[REDACTED:npm-token]' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g, to: '[REDACTED:gitlab-token]' },
  { re: /\bhf_[A-Za-z0-9]{30,}/g, to: '[REDACTED:huggingface-token]' },
  { re: /\bATATT3[A-Za-z0-9_=-]{20,}/g, to: '[REDACTED:atlassian-token]' },
  { re: /\bhvs\.[A-Za-z0-9_-]{20,}/g, to: '[REDACTED:vault-token]' },
  { re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, to: '[REDACTED:sendgrid-key]' },
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, to: '[REDACTED:jwt]' },
  { re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, to: '$1[REDACTED:bearer]' },
  { re: /\b(Basic\s+)[A-Za-z0-9+/=]{16,}/gi, to: '$1[REDACTED:basic-auth]' },
  // Any other scheme: "Authorization: Token <hex>", "Authorization: ApiKey <key>".
  {
    re: /\b(authorization\\?["']?\s*[:=]\s*\\?["']?[A-Za-z][A-Za-z0-9_-]*\s+)(?!\[REDACTED)[A-Za-z0-9._~+/=-]{16,}/gi,
    to: '$1[REDACTED:credential]',
  },
  // curl -u user:pass, --user user:pass.
  {
    re: /((?:^|\s)(?:-u\s*|--user[=\s]\s*)["']?[^\s:"'@]+:)(?!\[REDACTED)[^\s"'@]+/g,
    to: '$1[REDACTED:basic-auth]',
  },
  // mysql -pSECRET: the password glued to -p (a bare -p prompts for it).
  {
    re: /\b((?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p)(?![\s[])[^\s"']+/g,
    to: '$1[REDACTED:credential]',
  },
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"'<>]+:[^\s/@"'<>]+@/gi,
    to: '$1[REDACTED:url-credentials]@',
  },
  { re: /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){5}\b/g, to: '[REDACTED:recovery-key]' },
  {
    re: /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|sig|signature|token|access_token|api_key|apikey|key|auth|password|secret)=)[^&\s"']+/gi,
    to: '$1[REDACTED:query]',
  },
  // A quoted value runs to its closing quote, so a passphrase with spaces goes whole.
  {
    re: new RegExp(
      String.raw`(?<![a-z0-9])(${CREDENTIAL_KEY})(?![a-z0-9])(${CREDENTIAL_SEPARATOR}\s*)(\\?["'])(?!\[REDACTED)(?:(?!\3)[^\\\n])+\3`,
      'gi',
    ),
    to: '$1$2$3[REDACTED:credential]$3',
  },
  // A bare value of 8+ chars ("password: string" is a type, not a secret). The backslash-tolerant separator is
  // what catches JSON nested inside CLI JSON (\"password\":\"...\").
  {
    re: new RegExp(
      String.raw`(?<![a-z0-9])(${CREDENTIAL_KEY})(?![a-z0-9])(${CREDENTIAL_SEPARATOR}[\\"'\s]*)(?!\[REDACTED)[^\s"'\\,]{8,}`,
      'gi',
    ),
    to: '$1$2[REDACTED:credential]',
  },
];

/** A field that still names one of these after the table is dropped whole (case-insensitive). */
const FAIL_CLOSED_MARKERS = [
  '-----begin',
  'private key',
  'secretstring',
  'secretbinary',
  'secretaccesskey',
  'sessiontoken',
  'aws_secret_access_key',
];

/** Cut at `max` UTF-16 units without splitting a surrogate pair. */
export function sliceChars(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Cut an already redacted string to `max` chars, marking the cut. */
export function cutText(s: string, max: number): string {
  return s.length <= max ? s : sliceChars(s, max) + ELLIPSIS;
}

const WHITESPACE = /\s/;

/** `s` without its last word: the raw prefix cut split it, and half a token escapes every rule. */
function dropCutWord(s: string): string {
  let end = s.length;
  while (end > 0 && !WHITESPACE.test(s.charAt(end - 1))) end--;
  return s.slice(0, end);
}

/** The redacted form of a raw value before the field cut: what search matches against. */
export function redactFull(raw: string): string {
  let s = sliceChars(raw, REDACT_RAW_PREFIX_CHARS);
  if (s.length < raw.length && !WHITESPACE.test(raw.charAt(s.length))) s = dropCutWord(s);
  try {
    const started = performance.now();
    s = s.normalize('NFKC').replace(ANSI_ESCAPE, '');
    for (const rule of RULES) s = s.replace(rule.re, rule.to);
    if (performance.now() - started > REDACT_MAX_MS) return FIELD_REDACTED;
  } catch {
    return FIELD_REDACTED;
  }
  const lower = s.toLowerCase();
  if (FAIL_CLOSED_MARKERS.some((m) => lower.includes(m))) return FIELD_REDACTED;
  return s.replace(/\s+/g, ' ').trim();
}

/** The output form of a raw value: redacted, then cut to the field max. */
export function redactField(raw: string, max: number): string {
  return cutText(redactFull(raw), max);
}
