#!/usr/bin/env node
// Proves the security auditor can actually FAIL.
//
// A guard that only ever passes is theatre: it looks like protection in CI
// while catching nothing. Each fixture below violates exactly one invariant,
// and this asserts the auditor reports THAT invariant. The real workflows are
// asserted clean by the same run, so the suite fails in both directions —
// a broken auditor (catches nothing) and a broken repo (has a violation).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditDir, auditFile } from './audit-workflows.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const EXPECT = {
  'inv1-pr-target.yml': 'INV-1',
  'inv2-unpinned.yml': 'INV-2',
  'inv3-secret-in-run.yml': 'INV-3',
  // Evasion fixtures (adversarial review, 2026-08-16): context lookups are
  // case-insensitive and bracket-indexable, so `SECRETS.X` and `secrets['X']`
  // execute identically — the lowercase-dot-only matcher was a verified full
  // bypass of INV-3/INV-4, `toJson(SECRETS)` of INV-5, and `github.head_ref`
  // (a top-level context, not under github.event.) of INV-7.
  'inv3-bracket-case.yml': 'INV-3',
  'inv4-undeclared.yml': 'INV-4',
  'inv4-bracket.yml': 'INV-4',
  'inv5-env-dump.yml': 'INV-5',
  'inv5-tojson-case.yml': 'INV-5',
  'inv6-no-permissions.yml': 'INV-6',
  'inv7-untrusted.yml': 'INV-7',
  'inv7-headref.yml': 'INV-7',
};

let failed = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed += 1;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log('negative fixtures — the auditor must CATCH each violation:');
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.yml'));
for (const file of files) {
  const expected = EXPECT[file];
  if (!expected) {
    fail(`${file} has no expectation registered — add it to EXPECT`);
    continue;
  }
  const findings = auditFile(file, readFileSync(join(FIXTURES, file), 'utf8'));
  const hit = findings.some((f) => f.rule.startsWith(expected));
  if (hit) ok(`${file} → ${expected} caught`);
  else fail(`${file} → expected ${expected}, got ${JSON.stringify(findings.map((f) => f.rule))}`);
}

// Every invariant must be exercised by some fixture: a rule with no negative
// test can silently rot into a no-op.
console.log('coverage — every invariant has a negative fixture:');
const covered = new Set(Object.values(EXPECT));
for (const inv of ['INV-1', 'INV-2', 'INV-3', 'INV-4', 'INV-5', 'INV-6', 'INV-7']) {
  if (covered.has(inv)) ok(`${inv} exercised`);
  else fail(`${inv} has no negative fixture`);
}

console.log('the real workflows must be CLEAN:');
const real = auditDir(join(import.meta.dirname, '..', '.github', 'workflows'));
if (real.length === 0) ok('.github/workflows has no violations');
else for (const f of real) fail(`${f.file}:${f.line} ${f.rule} — ${f.detail}`);

console.log(failed === 0 ? '\nselftest passed' : `\nselftest FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
