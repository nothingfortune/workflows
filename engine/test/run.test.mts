import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/run.mts';
import { tempCopy } from './helpers.mts';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/bin/integrity.mjs');
const reportPath = (d: string) => path.join(d, 'build/integrity/report.json');

function withCopy(name: string, fn: (dir: string) => void) {
  const dir = tempCopy(name);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('run on the defect fixture fails with exit 1 and writes a report', () => {
  withCopy('knip-defects', (dir) => {
    const r = run({ root: dir, env: {} });
    assert.equal(r.exitCode, 1);
    assert.equal(r.report?.result, 'fail');
    const j = JSON.parse(readFileSync(reportPath(dir), 'utf8'));
    assert.equal(j.schemaVersion, 1);
    assert.ok(Array.isArray(j.findings));
    assert.equal(typeof j.durationMs, 'number');
    assert.equal(j.counts['DEAD-004'], 1);
  });
});

test('run on the clean fixture passes with exit 0', () => {
  withCopy('knip-clean', (dir) => {
    const r = run({ root: dir, env: {} });
    assert.equal(r.exitCode, 0);
    assert.equal(r.report?.result, 'pass');
  });
});

test('observe mode exits 0 but still reports', () => {
  withCopy('knip-defects', (dir) => {
    writeFileSync(path.join(dir, 'integrity.json'), '{"mode":"observe"}');
    const r = run({ root: dir, env: {} });
    assert.equal(r.exitCode, 0);
    assert.equal(r.report?.findings.length, 6);
  });
});

test('an analysis failure exits 2 and writes no report', () => {
  withCopy('knip-clean', (dir) => {
    writeFileSync(path.join(dir, 'knip.json'), '{');
    const r = run({ root: dir, env: {} });
    assert.equal(r.exitCode, 2);
    assert.match(r.text, /^integrity: analysis failed: /);
    assert.equal(existsSync(reportPath(dir)), false);
  });
});

test('outside Actions there are no annotations and no summary write', () => {
  withCopy('knip-defects', (dir) => {
    const quiet = run({ root: dir, env: {} });
    assert.doesNotMatch(quiet.text, /^::/m);
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'summary-')), 'summary.md');
    const loud = run({ root: dir, env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: tmp } });
    assert.equal(loud.text.match(/^::(error|warning) file=/gm)?.length, 6);
    assert.ok(readFileSync(tmp, 'utf8').includes('| DEAD-004 | 1 |'));
    rmSync(path.dirname(tmp), { recursive: true, force: true });
  });
});

test('the built CLI maps run() to process exit codes', () => {
  const exec = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  withCopy('knip-defects', (dir) => assert.equal(exec('check', '--root', dir).status, 1));
  withCopy('knip-clean', (dir) => assert.equal(exec('check', '--root', dir).status, 0));
  const bad = exec('bogus');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: integrity check/);
});
