import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFinding } from '../src/finding.mts';
import { renderAnnotations, renderSummary, renderText } from '../src/render.mts';
import type { Report } from '../src/render.mts';

const mk = (file: string, line?: number) =>
  makeFinding({ ruleId: 'DEAD-002', file, ...(line === undefined ? {} : { line }), symbol: file, message: 'unused', evidence: [], analyzer: 'knip' });

const report = (findings: ReturnType<typeof mk>[]): Report => ({
  schemaVersion: 1,
  engine: { version: 'dev' },
  analyzers: { knip: '6.41.0' },
  mode: 'enforce',
  durationMs: 1500,
  counts: { 'DEAD-002': findings.length },
  findings,
  blocking: findings.map((f) => f.fingerprint),
  result: findings.length ? 'fail' : 'pass',
});

test('a finding with no line emits no line= in its annotation', () => {
  const [a] = renderAnnotations(report([mk('src/a.ts')]));
  assert.equal(a, '::warning file=src/a.ts,title=DEAD-002::unused');
  const [b] = renderAnnotations(report([mk('src/a.ts', 3)]));
  assert.equal(b, '::warning file=src/a.ts,line=3,title=DEAD-002::unused');
});

test('60 findings end the summary table with "…and 10 more"', () => {
  const findings = Array.from({ length: 60 }, (_, i) => mk(`src/f${i}.ts`, 1));
  const out = renderSummary(report(findings));
  assert.match(out, /\| DEAD-002 \| 60 \|/);
  assert.ok(out.trimEnd().endsWith('…and 10 more'));
  assert.equal(out.split('\n').filter((l) => l.startsWith('| DEAD-002 | src/')).length, 50);
});

test('text lists findings, blocking, result and duration', () => {
  const out = renderText(report([mk('src/a.ts', 2)]));
  assert.match(out, /DEAD-002 src\/a\.ts:2 src\/a\.ts — unused/);
  assert.match(out, /Blocking: 1/);
  assert.match(out, /Result: FAIL/);
  assert.match(out, /Duration: 1\.5s/);
});
