import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fixture, tempCopy } from './helpers.mts';
import { AnalysisError, knipFindings, mapKnip, resolveKnip, runKnip } from '../src/knip.mts';

const analyze = (root: string) => knipFindings(root, resolveKnip(root));

test('every planted defect yields exactly one finding', () => {
  const got = analyze(fixture('knip-defects'))
    .map((f) => [f.ruleId, f.file, f.symbol ?? ''].join(' ').trim())
    .sort();
  const want = [
    'REF-001 src/index.ts ./missing.ts',
    'REF-002 src/index.ts left-pad',
    'DEAD-001 src/orphan.ts',
    'DEAD-002 src/used.ts unused',
    'DEAD-003 package.json is-odd',
    'DEAD-004 src/test-only.ts',
  ].sort();
  assert.deepEqual(got, want);
});

test('a clean project yields no findings', () => {
  assert.deepEqual(analyze(fixture('knip-clean')), []);
});

test('an unrelated edit above a finding keeps its fingerprint', () => {
  const dir = tempCopy('knip-defects');
  try {
    const find = () => analyze(dir).find((f) => f.ruleId === 'DEAD-002');
    const before = find();
    const used = path.join(dir, 'src/used.ts');
    writeFileSync(used, `\n\n// edit\n${readFileSync(used, 'utf8')}`);
    const after = find();
    assert.ok(before && after);
    assert.equal(after.fingerprint, before.fingerprint);
    assert.notEqual(after.line, before.line);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown knip issue type is an analysis failure', () => {
  assert.throws(() => mapKnip({ issues: [{ file: 'a.ts', brandNew: [{}] }] }, 'default'), /unknown knip issue type brandNew/);
});

test('knip missing and a config load error are analysis failures', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'knip-none-'));
  const broken = tempCopy('knip-clean');
  try {
    assert.throws(() => resolveKnip(empty), /knip is not installed/);
    writeFileSync(path.join(broken, 'knip.json'), '{');
    assert.throws(() => runKnip(broken, resolveKnip(broken), { production: false }), AnalysisError);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});

test('cycles map to CYC-001 with a rotation-stable symbol', () => {
  const found = mapKnip({ issues: [{ file: 'src/a.ts', cycles: [[{ name: 'src/b.ts' }, { name: 'src/a.ts' }]] }] }, 'default');
  assert.equal(found.length, 1);
  assert.equal(found[0]?.ruleId, 'CYC-001');
  assert.equal(found[0]?.symbol, 'src/a.ts -> src/b.ts');
});

test('the dedicated cycles pass yields one CYC-001 and leaves the other fixtures alone', () => {
  const got = analyze(fixture('knip-cycle'));
  assert.deepEqual(got.map((f) => [f.ruleId, f.symbol]), [['CYC-001', 'src/a.ts -> src/b.ts']]);
  assert.equal(analyze(fixture('knip-defects')).filter((f) => f.ruleId === 'CYC-001').length, 0);
});

test('a consumer include in knip.json does not drop REF rules on the main passes', () => {
  const dir = tempCopy('knip-defects');
  try {
    writeFileSync(path.join(dir, 'knip.json'), '{"entry":["src/index.ts!"],"project":["src/**/*.ts!","tests/**/*.ts"],"exclude":["files"]}');
    const rules = analyze(dir).map((f) => f.ruleId);
    assert.ok(rules.includes('REF-001') && rules.includes('REF-002'));
    assert.ok(!rules.includes('DEAD-001'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
