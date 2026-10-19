import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycleSymbol, fingerprint, makeFinding } from '../src/finding.mts';

const base = { file: 'src/a.ts', message: 'm', evidence: [], analyzer: 'knip' };

test('the same finding on Windows and POSIX paths has one fingerprint', () => {
  const a = fingerprint('DEAD-001', 'src\\a.ts');
  assert.equal(a, fingerprint('DEAD-001', 'src/a.ts'));
  assert.equal(a, fingerprint('DEAD-001', './src/a.ts'));
});

test('line numbers never reach the fingerprint', () => {
  const a = makeFinding({ ...base, ruleId: 'DEAD-002', symbol: 'x', line: 3 });
  const b = makeFinding({ ...base, ruleId: 'DEAD-002', symbol: 'x', line: 30 });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('rule, symbol and path each change the fingerprint', () => {
  assert.notEqual(fingerprint('DEAD-001', 'a.ts'), fingerprint('DEAD-002', 'a.ts'));
  assert.notEqual(fingerprint('DEAD-002', 'a.ts', 'x'), fingerprint('DEAD-002', 'a.ts', 'y'));
  assert.notEqual(fingerprint('DEAD-001', 'a.ts'), fingerprint('DEAD-001', 'b.ts'));
});

test('a cycle symbol is stable under rotation', () => {
  const s = cycleSymbol(['b.ts', 'c.ts', 'a.ts']);
  assert.equal(s, cycleSymbol(['a.ts', 'b.ts', 'c.ts']));
  assert.equal(s, 'a.ts -> b.ts -> c.ts');
});

test('makeFinding fills severity, confidence and classification from the rule', () => {
  const f = makeFinding({ ...base, ruleId: 'REF-003' });
  assert.equal(f.severity, 'error');
  assert.equal(f.confidence, 'medium');
  assert.equal(f.classification, 'broken-reference');
});

test('an unknown rule or an escaping path throws', () => {
  assert.throws(() => makeFinding({ ...base, ruleId: 'NOPE-1' }), /unknown rule NOPE-1/);
  assert.throws(() => makeFinding({ ...base, ruleId: 'REF-001', file: '../x' }), /outside the repo/);
});
