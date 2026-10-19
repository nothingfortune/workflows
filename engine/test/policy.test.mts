import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFinding } from '../src/finding.mts';
import type { Finding } from '../src/finding.mts';
import { evaluate } from '../src/policy.mts';

const mk = (ruleId: string, file: string) => makeFinding({ ruleId, file, message: 'm', evidence: [], analyzer: 't' });
const info: Finding = { ...mk('DEAD-002', 'c.ts'), severity: 'info' };

test('enforce blocks errors and warnings but never info', () => {
  const ref = mk('REF-001', 'a.ts');
  const dead = mk('DEAD-002', 'b.ts');
  const r = evaluate([ref, dead, info], 'enforce');
  assert.deepEqual(r.blocking, [ref, dead]);
  assert.equal(r.result, 'fail');
  assert.equal(r.exitCode, 1);
  assert.deepEqual(evaluate([info], 'enforce'), { blocking: [], result: 'pass', exitCode: 0 });
});

test('observe never blocks', () => {
  const r = evaluate([mk('REF-001', 'a.ts'), mk('DEAD-002', 'b.ts')], 'observe');
  assert.deepEqual(r, { blocking: [], result: 'pass', exitCode: 0 });
});
