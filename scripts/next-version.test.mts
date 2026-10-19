import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { bump, nextVersion, parseLog } from './next-version.mts';
import type { Commit } from './next-version.mts';

const CALLABLE = '.github/workflows/ci.yml';
const isCallable = (f: string): boolean => f === CALLABLE;
const c = (subject: string, files = [CALLABLE], body = ''): Commit => ({ subject, body, files });

test('feat on a callable workflow is a minor release', () => {
  assert.equal(nextVersion('v1.1.1', [c('feat(ci): new input')], isCallable), 'v1.2.0');
});

test('fix, build and an unrecognised type are patch releases', () => {
  for (const s of ['fix: retry', 'build(deps): bump actions/checkout', 'security: pin node', 'no type at all']) {
    assert.equal(nextVersion('v1.1.1', [c(s)], isCallable), 'v1.1.2', s);
  }
});

test('a bang or a BREAKING CHANGE footer is a major release', () => {
  assert.equal(nextVersion('v1.1.1', [c('feat(ci)!: drop input')], isCallable), 'v2.0.0');
  assert.equal(nextVersion('v1.1.1', [c('fix: x', [CALLABLE], 'BREAKING CHANGE: input renamed')], isCallable), 'v2.0.0');
});

test('docs, chore, ci, test and style never release', () => {
  const commits = ['docs: a', 'chore: b', 'ci: c', 'test: d', 'style: e'].map((s) => c(s));
  assert.equal(nextVersion('v1.1.1', commits, isCallable), null);
});

test('a feat that touches no callable workflow does not release', () => {
  assert.equal(nextVersion('v1.1.1', [c('feat: auditor rule', ['scripts/audit-workflows.mts', '.github/workflows/lint.yml'])], isCallable), null);
});

test('the highest level across commits wins, in any order', () => {
  assert.equal(nextVersion('v1.1.1', [c('feat: a'), c('fix: b'), c('docs: c')], isCallable), 'v1.2.0');
  assert.equal(nextVersion('v1.1.1', [c('docs: c'), c('fix: b'), c('feat!: a')], isCallable), 'v2.0.0');
});

test('no commits means no release', () => {
  assert.equal(nextVersion('v1.1.1', [], isCallable), null);
});

test('bump resets lower fields and rejects a non-semver tag', () => {
  assert.equal(bump('v1.4.7', 'minor'), 'v1.5.0');
  assert.equal(bump('v1.4.7', 'major'), 'v2.0.0');
  assert.throws(() => bump('v1', 'patch'), /not a semver tag: v1/);
});

test('parseLog splits subject, body and files per commit', () => {
  const out = '\x1efeat: a\x1fbody line\x1f\n\n.github/workflows/ci.yml\nREADME.md\n\x1edocs: b\x1f\x1f\n\nREADME.md\n';
  assert.deepEqual(parseLog(out), [
    { subject: 'feat: a', body: 'body line', files: ['.github/workflows/ci.yml', 'README.md'] },
    { subject: 'docs: b', body: '', files: ['README.md'] },
  ]);
});

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'next-version.mts');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'next-version-'));
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env: ENV, encoding: 'utf8' });
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  git('init', '-q', '-b', 'main');
  write('.github/workflows/ci.yml', 'on:\n  workflow_call: {}\n');
  write('.github/workflows/lint.yml', 'on: push\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: initial');
  git('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  const run = () => execFileSync(process.execPath, [SCRIPT, '--root', root], { env: ENV, encoding: 'utf8' });
  return { root, git, write, run };
}

test('CLI: a feat on a callable workflow since the last tag prints the next minor', () => {
  const r = repo();
  r.write('.github/workflows/lint.yml', 'on: [push]\n');
  r.git('commit', '-qam', 'fix: lint only');
  r.write('.github/workflows/ci.yml', 'on:\n  workflow_call: { inputs: {} }\n');
  r.git('commit', '-qam', 'feat: ci input');
  assert.equal(r.run(), 'v1.1.0\n');
  rmSync(r.root, { recursive: true, force: true });
});

test('CLI: commits touching only non-callable workflows print nothing', () => {
  const r = repo();
  r.write('.github/workflows/lint.yml', 'on: [push]\n');
  r.git('commit', '-qam', 'feat: lint');
  assert.equal(r.run(), '');
  rmSync(r.root, { recursive: true, force: true });
});

test('CLI: deleting a callable workflow is a release, though the file is gone', () => {
  const r = repo();
  unlinkSync(path.join(r.root, '.github/workflows/ci.yml'));
  r.git('commit', '-qam', 'refactor: drop ci');
  assert.equal(r.run(), 'v1.0.1\n');
  rmSync(r.root, { recursive: true, force: true });
});

test('CLI: removing workflow_call from a released workflow is still a release', () => {
  const r = repo();
  r.write('.github/workflows/ci.yml', 'on: push\n');
  r.git('commit', '-qam', 'feat(ci)!: ci is no longer callable');
  assert.equal(r.run(), 'v2.0.0\n');
  rmSync(r.root, { recursive: true, force: true });
});

test('CLI: deleting a workflow that was never callable does not release', () => {
  const r = repo();
  unlinkSync(path.join(r.root, '.github/workflows/lint.yml'));
  r.git('commit', '-qam', 'fix: drop lint');
  assert.equal(r.run(), '');
  rmSync(r.root, { recursive: true, force: true });
});

test('CLI: a commit already carrying a release tag prints it again, so a failed publish can be re-run', () => {
  const r = repo();
  r.write('.github/workflows/ci.yml', 'on:\n  workflow_call: { inputs: {} }\n');
  r.git('commit', '-qam', 'feat: ci input');
  r.git('tag', '-a', 'v1.1.0', '-m', 'v1.1.0');
  assert.equal(r.run(), 'v1.1.0\n');
  rmSync(r.root, { recursive: true, force: true });
});
