import { describe, expect, it } from 'vitest';

import { REDACT_RAW_PREFIX_CHARS } from '../src/memory/constants.js';
import { redactField } from '../src/memory/redact.js';

/**
 * [C9] The redaction table, through the production field redactor: each rule has a positive case whose secret
 * must not survive and a negative case that must come back unchanged. Secrets are assembled from parts so the
 * repository's own secret scanner (gitleaks pre-commit) does not flag the fixtures.
 */

const j = (...parts: string[]): string => parts.join('');
const MAX = 1000;

interface Positive {
  rule: string;
  input: string;
  secret: string;
  expected?: string;
}

const AWS_SECRET = j('wJalrXUtnFEMI/K7MDENG', '/bPxRfiCYEXAMPLEKEY');
const GH_TOKEN = j('ghp_', 'Zq9Xw2Lm4Np6Rt8Vb1Cd3Fg5Hj7Kl0Mn9Pq2');

const POSITIVES: Positive[] = [
  {
    rule: 'private key block',
    input: j(
      'key: -----BEGIN RSA ',
      'PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0Z3VS\\n-----END RSA ',
      'PRIVATE KEY----- done',
    ),
    secret: 'MIIEowIBAAKCAQEA0Z3VS',
    expected: 'key: [REDACTED:private-key] done',
  },
  {
    rule: 'aws key id',
    input: j('use AKIA', 'Z3QW7RTY5UIO2PLK for the deploy'),
    secret: j('AKIA', 'Z3QW7RTY5UIO2PLK'),
    expected: 'use [REDACTED:aws-key-id] for the deploy',
  },
  {
    rule: 'aws secret near its key name',
    input: j('secret_access_key is ', AWS_SECRET),
    secret: AWS_SECRET,
    expected: 'secret_access_key is [REDACTED:aws-secret]',
  },
  { rule: 'github classic token', input: `push with ${GH_TOKEN}`, secret: GH_TOKEN },
  {
    rule: 'github fine-grained token',
    input: j('github_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEF0123'),
    secret: '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEF0123',
  },
  {
    rule: 'slack token',
    input: j('xox', 'b-123456789012-abcdefABCDEF ok'),
    secret: '123456789012-abcdefABCDEF',
  },
  {
    rule: 'slack webhook',
    input: j('https://hooks.slack.com/services/', 'T0AAAA1/B0BBBB2/c3CCCC4dddd'),
    secret: 'T0AAAA1/B0BBBB2/c3CCCC4dddd',
    expected: 'https://hooks.slack.com/services/[REDACTED:slack-webhook]',
  },
  {
    rule: 'google api key',
    input: j('AIza', 'SyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v'),
    secret: 'SyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v',
  },
  {
    rule: 'anthropic key',
    input: j('sk-ant-', 'api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345'),
    secret: 'api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  },
  {
    rule: 'openai project key',
    input: j('sk-proj-', 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56'),
    secret: 'Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56',
  },
  {
    rule: 'stripe key',
    input: j('sk_', 'live_', '4eC39HqLyjWDarjtT1zdp7dc'),
    secret: '4eC39HqLyjWDarjtT1zdp7dc',
  },
  {
    rule: 'generic sk- key',
    input: j('sk-', 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe'),
    secret: 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe',
  },
  {
    rule: 'npm token',
    input: j('npm_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'),
    secret: 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5',
  },
  {
    rule: 'atlassian token',
    input: j('ATATT3', 'xFfGF0aBcDeFgHiJkLmNoPqRsTuV'),
    secret: 'xFfGF0aBcDeFgHiJkLmNoPqRsTuV',
  },
  {
    rule: 'vault token',
    input: j('hvs.', 'CAESIJlU9JMYEhOPYv4igdhm9PnK'),
    secret: 'CAESIJlU9JMYEhOPYv4igdhm9PnK',
  },
  {
    rule: 'sendgrid key',
    input: j('SG.', 'ngeVfQFYQlKU0ufo8x5d1A', '.', 'TwL2iGABf9DHoTf-09kqeF8tAmbihYzrnopKc-1s5cr'),
    secret: 'TwL2iGABf9DHoTf-09kqeF8tAmbihYzrnopKc-1s5cr',
  },
  {
    rule: 'jwt',
    input: j('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dozjgNryP4J3jVmNHl0w5N'),
    secret: 'dozjgNryP4J3jVmNHl0w5N',
  },
  {
    rule: 'bearer token',
    input: j('Authorization: Bearer ', 'abcDEF1234567890ghij.klm'),
    secret: 'abcDEF1234567890ghij.klm',
    expected: 'Authorization: Bearer [REDACTED:bearer]',
  },
  {
    rule: 'basic auth',
    input: j('Authorization: Basic ', 'ZGVwbG95Omh1bnRlcjJwYXNz'),
    secret: 'ZGVwbG95Omh1bnRlcjJwYXNz',
    expected: 'Authorization: Basic [REDACTED:basic-auth]',
  },
  {
    rule: 'url credentials',
    input: j('git clone https://deploy:', 'hunter2pass', '@github.com/org/repo.git'),
    secret: 'hunter2pass',
    expected: 'git clone https://[REDACTED:url-credentials]@github.com/org/repo.git',
  },
  {
    rule: 'recovery key',
    input: j('FileVault key ', 'K7Q2-M9X4-P3L8-W6Z1-R5T0-Y2U4'),
    secret: 'K7Q2-M9X4-P3L8-W6Z1-R5T0-Y2U4',
  },
  {
    rule: 'presigned url signature',
    input: j('https://b.s3.amazonaws.com/f?X-Amz-Signature=', 'abc123def456', '&X-Amz-Expires=300'),
    secret: 'abc123def456',
    expected: 'https://b.s3.amazonaws.com/f?X-Amz-Signature=[REDACTED:query]&X-Amz-Expires=300',
  },
  // I4 locked positives.
  {
    rule: 'json SecretAccessKey (whole field)',
    input: j('"SecretAccess', 'Key": "', AWS_SECRET, '"'),
    secret: AWS_SECRET,
    expected: '[REDACTED:field]',
  },
  {
    rule: 'password=',
    input: j('password=', 'hunter2xx'),
    secret: 'hunter2xx',
    expected: 'password=[REDACTED:credential]',
  },
  {
    rule: 'api_key:',
    input: j('api_key: ', 'abcdefgh12345678'),
    secret: 'abcdefgh12345678',
    expected: 'api_key: [REDACTED:credential]',
  },
  {
    rule: 'accessToken=""',
    input: j('accessToken="', 'abcdefghij', '"'),
    secret: 'abcdefghij',
    expected: 'accessToken="[REDACTED:credential]"',
  },
  {
    rule: 'json nested in cli json',
    input: j('{\\"password\\":\\"', 'hunter2abc', '\\"}'),
    secret: 'hunter2abc',
  },
  // Key names joined to a prefix or carrying a suffix.
  {
    rule: 'env var with a prefix (PGPASSWORD)',
    input: j('PGPASSWORD=', 'q7W9e2R4t6Y8'),
    secret: 'q7W9e2R4t6Y8',
    expected: 'PGPASSWORD=[REDACTED:credential]',
  },
  {
    rule: 'camelCase keys in json (dbPassword, secretKey)',
    input: j('{"dbPassword": "', 'Xy7pQ2mN9vB4', '", "secretKey": "', 'Zz8Yy7Xx6Ww5', '"}'),
    secret: 'Xy7pQ2mN9vB4',
    expected: '{"dbPassword": "[REDACTED:credential]", "secretKey": "[REDACTED:credential]"}',
  },
  {
    rule: 'idToken',
    input: j('idToken: ', 'q7W9e2R4t6Y8u0I1'),
    secret: 'q7W9e2R4t6Y8u0I1',
    expected: 'idToken: [REDACTED:credential]',
  },
  {
    rule: 'SECRET_KEY_BASE',
    input: j('SECRET_KEY_BASE=', 'q7W9e2R4t6Y8u0I1'),
    secret: 'q7W9e2R4t6Y8u0I1',
    expected: 'SECRET_KEY_BASE=[REDACTED:credential]',
  },
  {
    rule: 'DB_PASS',
    input: j('DB_PASS=', 'q7W9e2R4t6Y8'),
    secret: 'q7W9e2R4t6Y8',
    expected: 'DB_PASS=[REDACTED:credential]',
  },
  {
    rule: 'quoted passphrase with spaces',
    input: j('DB_PASSWORD="', 'correct horse battery staple', '"'),
    secret: 'horse battery',
    expected: 'DB_PASSWORD="[REDACTED:credential]"',
  },
  {
    rule: 'bare value with a semicolon',
    input: j('password=', 'Pa$$;w0rd!'),
    secret: 'w0rd',
    expected: 'password=[REDACTED:credential]',
  },
  {
    rule: 'url-encoded separator',
    input: j('https://x.io/cb?next=%2Flogin%3Fpassword%3D', 'hunter2hunter2'),
    secret: 'hunter2hunter2',
  },
  {
    rule: 'authorization with another scheme',
    input: j('Authorization: Token ', '0123456789abcdef0123456789abcdef01234567'),
    secret: '0123456789abcdef',
    expected: 'Authorization: Token [REDACTED:credential]',
  },
  {
    rule: 'curl -u',
    input: j('curl -u admin:', 'S3cr3tPw', ' https://x.io'),
    secret: 'S3cr3tPw',
    expected: 'curl -u admin:[REDACTED:basic-auth] https://x.io',
  },
  {
    rule: 'curl --user',
    input: j('curl --user admin:', 'S3cr3tPw', ' https://x.io'),
    secret: 'S3cr3tPw',
  },
  {
    rule: 'mysql -p glued to its value',
    input: j('mysql -u root -p', 'S3cr3tPw', ' mydb'),
    secret: 'S3cr3tPw',
    expected: 'mysql -u root -p[REDACTED:credential] mydb',
  },
  {
    rule: 'gitlab token',
    input: j('glpat-', 'xYz12345678901234567aB'),
    secret: 'xYz12345678901234567aB',
  },
  {
    rule: 'huggingface token',
    input: j('hf_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567'),
    secret: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567',
  },
  // Normalization before the table.
  {
    rule: 'fullwidth key name (NFKC)',
    input: j('ｐａｓｓｗｏｒｄ=', 'hunter2xx'),
    secret: 'hunter2xx',
  },
  { rule: 'ansi-wrapped token', input: `\x1b[31m${GH_TOKEN}\x1b[0m`, secret: GH_TOKEN },
  // I2: a field still naming secret material after the table is dropped whole.
  {
    rule: 'secretsmanager output',
    input: 'get-secret-value returned SecretString with the db creds',
    secret: 'db creds',
    expected: '[REDACTED:field]',
  },
  {
    rule: 'truncated private key',
    input: j('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAA'),
    secret: 'b3BlbnNzaC1rZXktdjEAAAA',
    expected: '[REDACTED:field]',
  },
];

const NEGATIVES: string[] = [
  'generate a key pair with ssh-keygen -t ed25519',
  'AKIA is the prefix of an access key id',
  'secret_access_key is rotated every 90 days',
  'the ghp_ prefix marks a classic token',
  'github_pat_ tokens expire',
  'xoxb tokens are bot tokens',
  'post it to hooks.slack.com',
  'AIza keys are restricted by referrer',
  'sk-ant- keys live in the console',
  'sk-proj- keys belong to a project',
  'sk_live_ keys only in prod',
  'sk-learn is a library',
  'npm_config_cache is set',
  'ATATT3 is the prefix',
  'hvs. tokens are short lived',
  'SG.Region is fine',
  'eyJ is base64 for {"',
  'curl -H "Authorization: Bearer ${TOKEN}"',
  'Bearer <token>',
  'Basic auth is disabled',
  'git clone git@github.com:org/repo.git',
  'build 2026-10-12 shipped as 123e4567-e89b-12d3-a456-426614174000',
  'https://example.com/search?q=tokens&page=2',
  // I4 locked negatives.
  'max_tokens: 4096',
  'token_count=123456789',
  'tokenizer: cl100k_base',
  'password: string',
  'TOKEN_PATH=/x/y/z',
  '"secrets manager rotation"',
  'https://github.com/org/repo/pull/12',
  // The joined-key, quoted-value and command rules stop at word boundaries and real flags.
  'passthrough=enabled_for_all',
  'tokens: abcdefghijkl',
  'the secretary: Margaret Hamilton',
  'mysql -p mydb',
  'git push -u origin main',
  'docker run --rm -p 8080:80 nginx',
  'glpat- tokens are scoped',
  'hf_hub_download(repo_id)',
];

describe('memory redaction table', () => {
  it.each(POSITIVES)('[C9] removes the secret: $rule', ({ input, secret, expected }) => {
    const out = redactField(input, MAX);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED:');
    if (expected !== undefined) expect(out).toBe(expected);
  });

  it.each(NEGATIVES)('[C9] keeps text that is not a secret: %s', (input) => {
    expect(redactField(input, MAX)).toBe(input);
  });

  it('[C9] cuts after redacting, so a cut never leaves part of a token unmatched', () => {
    const input = `${'x'.repeat(30)} ${GH_TOKEN} tail`;
    const out = redactField(input, 40);
    expect(out).toBe(`${'x'.repeat(30)} [REDACTED…`);
    expect(out).not.toContain('ghp_');
  });

  it('[C9] drops the word the raw 4,096-char cut splits, so no part of a token straddling it survives', () => {
    const lead = 'p'.repeat(REDACT_RAW_PREFIX_CHARS - 26);
    const out = redactField(`${lead} ${GH_TOKEN} tail`, REDACT_RAW_PREFIX_CHARS + 100);
    expect(out).toBe(lead);
    for (let i = 0; i + 8 <= GH_TOKEN.length; i++)
      expect(out).not.toContain(GH_TOKEN.slice(i, i + 8));
  });
});
