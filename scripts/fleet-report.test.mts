import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditRepo, classifyRef, needsAttention, parseCalls, parseRemoteTags, render, sortReleases } from './fleet-report.mts';
import type { RepoResult } from './fleet-report.mts';

const SHA = (c: string): string => c.repeat(40);
const RELEASES = sortReleases([
  { tag: 'v1.1.0', sha: SHA('b') },
  { tag: 'v1', sha: SHA('c') },
  { tag: 'v1.10.0', sha: SHA('d') },
  { tag: 'v1.2.0', sha: SHA('c') },
]);
const call = (wf: string, ref: string, comment = ''): string => `    uses: nothingfortune/workflows/.github/workflows/${wf}@${ref}${comment}\n`;

test('releases sort numerically and drop the moving major tag', () => {
  assert.deepEqual(RELEASES.map((r) => r.tag), ['v1.10.0', 'v1.2.0', 'v1.1.0']);
});

test('parseCalls finds every shared workflow call and ignores other actions', () => {
  const text = `jobs:\n  a:\n${call('ci.yml', SHA('d'), ' # v1.10.0')}  b:\n${call('e2e.yaml', 'v1')}      - uses: actions/checkout@${SHA('e')}\n`;
  assert.deepEqual(parseCalls(text), [
    { workflow: 'ci.yml', ref: SHA('d') },
    { workflow: 'e2e.yaml', ref: 'v1' },
  ]);
});

test('a pinned SHA is current, behind by its distance, or unreleased', () => {
  assert.deepEqual(classifyRef(SHA('d'), RELEASES), { status: 'current', release: 'v1.10.0', behind: 0 });
  assert.deepEqual(classifyRef(SHA('c'), RELEASES), { status: 'behind', release: 'v1.2.0', behind: 1 });
  assert.deepEqual(classifyRef(SHA('b'), RELEASES), { status: 'behind', release: 'v1.1.0', behind: 2 });
  assert.deepEqual(classifyRef(SHA('f'), RELEASES), { status: 'unreleased', release: null, behind: null });
});

test('a tag or branch ref is unpinned, even the major tag', () => {
  assert.equal(classifyRef('v1', RELEASES).status, 'unpinned');
  assert.equal(classifyRef('main', RELEASES).status, 'unpinned');
});

test('a local file named like a shared workflow that does not call it is a copy', () => {
  const files = {
    'ci.yml': call('ci.yml', SHA('d')),
    'mutation.yml': 'jobs: {}\n',
    'e2e.yml': 'jobs:\n  e2e:\n    runs-on: ubuntu-latest\n',
  };
  const { calls, copies } = auditRepo(files, ['ci.yml', 'e2e.yml'], RELEASES);
  assert.deepEqual(copies, ['e2e.yml']);
  assert.deepEqual(calls.map((c) => [c.file, c.workflow, c.status]), [['ci.yml', 'ci.yml', 'current']]);
});

test('a caller file under another name is not a copy', () => {
  const { copies } = auditRepo({ 'engine-image.yml': call('docker-image.yml', SHA('b')) }, ['docker-image.yml'], RELEASES);
  assert.deepEqual(copies, []);
});

test('render lists calls, copies, repos with no calls and unread repos', () => {
  const results: RepoResult[] = [
    { repo: 'o/a', ...auditRepo({ 'ci.yml': call('ci.yml', SHA('b')) }, ['ci.yml'], RELEASES) },
    { repo: 'o/b', ...auditRepo({ 'e2e.yml': 'jobs: {}\n' }, ['e2e.yml'], RELEASES) },
    { repo: 'o/c', calls: [], copies: [], error: 'HTTP 403' },
  ];
  const md = render(results, 'v1.10.0');
  assert.match(md, /\| o\/a \| ci\.yml \| ci\.yml \| v1\.1\.0 \| behind by 2 \|/);
  assert.match(md, /## Possible copies[^\n]*\n\n- o\/b: `e2e\.yml`/);
  assert.match(md, /## Repos calling no shared workflow\n\no\/b, o\/c/);
  assert.match(md, /- o\/c: HTTP 403/);
});

test('only a fully current fleet needs no attention', () => {
  const current = [{ repo: 'o/a', ...auditRepo({ 'ci.yml': call('ci.yml', SHA('d')) }, ['ci.yml'], RELEASES) }];
  assert.equal(needsAttention(current), false);
  const behind = [{ repo: 'o/a', ...auditRepo({ 'ci.yml': call('ci.yml', SHA('b')) }, ['ci.yml'], RELEASES) }];
  assert.equal(needsAttention(behind), true);
  assert.equal(needsAttention([{ repo: 'o/c', calls: [], copies: [], error: 'x' }]), true);
});

test('a commented-out call is not a call, so the same-named file still reads as a copy', () => {
  const text = `#   uses: nothingfortune/workflows/.github/workflows/ci.yml@${SHA('d')} # v1.10.0\njobs:\n  check:\n    runs-on: ubuntu-latest\n`;
  assert.deepEqual(parseCalls(text), []);
  assert.deepEqual(auditRepo({ 'ci.yml': text }, ['ci.yml'], RELEASES).copies, ['ci.yml']);
});

test('a step-form and a quoted call both count', () => {
  const text = `      - uses: nothingfortune/workflows/.github/workflows/ci.yml@v1\n    uses: 'nothingfortune/workflows/.github/workflows/e2e.yml@${SHA('d')}'\n`;
  assert.deepEqual(parseCalls(text).map((c) => c.workflow), ['ci.yml', 'e2e.yml']);
});

test('remote tags peel annotated tags to their commit', () => {
  const out = `${SHA('1')}\trefs/tags/v1\n${SHA('2')}\trefs/tags/v1.1.2\n${SHA('3')}\trefs/tags/v1.1.2^{}\n`;
  assert.deepEqual(parseRemoteTags(out), [
    { tag: 'v1', sha: SHA('1') },
    { tag: 'v1.1.2', sha: SHA('3') },
  ]);
});
