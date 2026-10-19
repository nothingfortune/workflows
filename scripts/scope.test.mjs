import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKFLOW = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.github/workflows/scope.yml');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

// The `run: |` block of the step with id `classify`, dedented: the exact script the job runs.
function classifyScript() {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^\s+- id: classify$/.test(l));
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const indent = lines[run + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() !== '' && l.match(/^\s*/)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'scope-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: root, env: ENV, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const write = (f, t = 'x') => {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), t);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-q', '-m', 'change');
  };
  // GitHub's default run shell for bash steps.
  const classify = (BASE_SHA = base) => {
    const outFile = path.join(root, '.git', 'gh-output');
    writeFileSync(outFile, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', classifyScript()], {
      cwd: root,
      env: { ...ENV, BASE_SHA, GITHUB_OUTPUT: outFile },
      encoding: 'utf8',
    });
    return { status: r.status, output: readFileSync(outFile, 'utf8').trim() };
  };
  return { root, git, write, commit, classify, base };
}

test('docs/** and *.md only is doc-only', () => {
  const r = repo();
  r.write('docs/guide.md');
  r.write('README.md');
  r.write('docs/img/diagram.png');
  r.commit();
  assert.deepEqual(r.classify(), { status: 0, output: 'doc_only=true' });
});

test('any non-doc file makes the change not doc-only', () => {
  const r = repo();
  r.write('docs/guide.md');
  r.write('src/a.ts');
  r.commit();
  assert.deepEqual(r.classify(), { status: 0, output: 'doc_only=false' });
});

test('a markdown-looking name outside docs that is not .md is code', () => {
  const r = repo();
  r.write('src/weird .md name.ts');
  r.commit();
  assert.equal(r.classify().output, 'doc_only=false');
});

test('a newline inside a doc filename does not split into phantom paths', () => {
  const r = repo();
  r.write('docs/part\nnote.txt');
  r.commit();
  assert.equal(r.classify().output, 'doc_only=true');
});

test('renaming code into docs still counts the deleted code path', () => {
  const r = repo();
  r.write('src/a.ts', 'export const a = 1;\n');
  r.commit();
  const before = r.git('rev-parse', 'HEAD').trim();
  mkdirSync(path.join(r.root, 'docs'), { recursive: true });
  renameSync(path.join(r.root, 'src/a.ts'), path.join(r.root, 'docs/a.md'));
  r.commit();
  assert.equal(r.classify(before).output, 'doc_only=false');
});

test('an unresolvable or missing base is unknown, never a guess', () => {
  const r = repo();
  r.write('src/a.ts');
  r.commit();
  assert.deepEqual(r.classify('0000000000000000000000000000000000000000'), { status: 0, output: 'doc_only=unknown' });
  assert.deepEqual(r.classify(''), { status: 0, output: 'doc_only=unknown' });
});

test('a diff that fails fails the step instead of reading as doc-only', () => {
  const r = repo();
  r.git('checkout', '-q', '--orphan', 'other');
  r.git('rm', '-rq', '--cached', '.', '--ignore-unmatch');
  r.write('src/a.ts');
  r.commit();
  const result = r.classify();
  assert.notEqual(result.status, 0);
  assert.equal(result.output, '');
});
