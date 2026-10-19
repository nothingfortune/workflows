import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AnalysisError } from '../src/knip.mts';
import { checkReferences, scriptPaths, workflowPaths } from '../src/references.mts';

const fixture = path.join(import.meta.dirname, 'fixtures', 'refs');

function tmpProject(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'refs-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  return root;
}

test('a script naming a missing file is REF-003; real files and npm run are not', () => {
  assert.deepEqual(scriptPaths('node scripts/real.mjs && bash bin/gone.sh && npm run x'), [
    'scripts/real.mjs',
    'bin/gone.sh',
  ]);
  const scripts = checkReferences(fixture).filter((f) => f.evidence[0]?.startsWith('package.json'));
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0]?.symbol, 'bin/gone.sh');
  assert.equal(scripts[0]?.ruleId, 'REF-003');
  assert.equal(scripts[0]?.file, 'package.json');
  assert.deepEqual(scripts[0]?.evidence, ['package.json scripts.build']);
});

test('evals, variables, globs, URLs and quoted spans are not paths', () => {
  for (const c of [
    `node -e "require('./x.js')"`,
    `bash -c 'scripts/a.sh'`,
    'bash $DIR/x.sh',
    'node scripts/*.mjs',
    'curl https://e.com/a.js',
  ]) {
    assert.deepEqual(scriptPaths(c), [], c);
  }
});

test("a flag's path argument is still a path", () => {
  assert.deepEqual(scriptPaths('eslint --config ./eslint.config.js .'), ['./eslint.config.js']);
});

test('a workflow run line and a local action are checked; comments are not', () => {
  const found = checkReferences(fixture).filter((f) => f.file === '.github/workflows/ci.yml');
  assert.deepEqual(
    found.map((f) => [f.symbol, f.line, f.evidence[0]]),
    [
      ['.github/scripts/gone.sh', 9, 'workflow run:'],
      ['.github/actions/missing', 10, 'workflow uses:'],
    ],
  );
  assert.deepEqual(workflowPaths('# run: bash nope.sh\n  - run: node a.mjs\n'), [{ path: 'a.mjs', line: 2, via: 'run' }]);
});

test('a non-glob knip entry that does not exist is REF-003; globs are not checked', () => {
  const root = tmpProject({ 'knip.json': '{ "entry": ["src/gone.ts!", "scripts/*.mjs"] }' });
  const found = checkReferences(root);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.symbol, 'src/gone.ts');
  assert.equal(found[0]?.file, 'knip.json');
  assert.deepEqual(found[0]?.evidence, ['knip.json entry']);
});

test('a project with no scripts, workflows or knip.json has no findings', () => {
  assert.deepEqual(checkReferences(tmpProject({})), []);
  assert.deepEqual(checkReferences(tmpProject({ 'package.json': '{"name":"x"}' })), []);
});

test('invalid JSON in package.json or knip.json is an AnalysisError naming the file', () => {
  assert.throws(
    () => checkReferences(tmpProject({ 'package.json': '{' })),
    (e) => e instanceof AnalysisError && /package\.json/.test(e.message),
  );
  assert.throws(
    () => checkReferences(tmpProject({ 'knip.json': '{' })),
    (e) => e instanceof AnalysisError && /knip\.json/.test(e.message),
  );
});

test('run block scalars and local reusable workflows are checked', () => {
  const found = checkReferences(fixture).filter((f) => f.file === '.github/workflows/blocks.yml');
  assert.deepEqual(
    found.map((f) => [f.symbol, f.line, f.evidence[0]]),
    [
      ['.github/scripts/block-gone.sh', 10, 'workflow run:'],
      ['.github/workflows/gone.yml', 12, 'workflow uses:'],
    ],
  );
});

test('git-ignored build output is not REF-003; other missing paths still are', () => {
  const root = tmpProject({
    'package.json': '{"scripts":{"start":"node dist/index.js","bad":"node gone/index.js"}}',
    '.gitignore': 'dist/\n',
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: root, env });
  assert.deepEqual(checkReferences(root).map((f) => f.symbol), ['gone/index.js']);
});

test('a script named like the package name is located at its own line', () => {
  const root = tmpProject({
    'package.json': '{\n  "name": "test",\n  "scripts": {\n    "test": "node gone.js"\n  }\n}\n',
  });
  assert.equal(checkReferences(root)[0]?.line, 4);
});

test('a run block ends at the run key column; sibling keys are not commands', () => {
  const text = [
    'steps:',
    '  - run: |',
    '      node in.js',
    '    env:',
    '      X: node sib.js',
    '  - run: >-',
    '      bash in2.sh',
    '    working-directory: node d.js',
    '  - name: n',
    '    run: |',
    '      node in3.js',
    '    shell: bash e.sh',
    '',
  ].join('\n');
  assert.deepEqual(
    workflowPaths(text).map((w) => [w.path, w.line]),
    [
      ['in.js', 3],
      ['in2.sh', 7],
      ['in3.js', 11],
    ],
  );
});

test('a callable workflow skips run: paths but still checks uses: ./', () => {
  const callable = ['on:', '  workflow_call:', 'jobs:', '  j:', '    steps:', '      - run: node gone.js', '      - uses: ./.github/actions/gone', ''].join('\n');
  const plain = callable.replace('  workflow_call:', '  push:');
  const root = tmpProject({ '.github/workflows/lib.yml': callable, '.github/workflows/ci.yml': plain });
  const found = checkReferences(root).map((f) => [f.file, f.symbol]);
  assert.deepEqual(found, [
    ['.github/workflows/ci.yml', 'gone.js'],
    ['.github/workflows/ci.yml', '.github/actions/gone'],
    ['.github/workflows/lib.yml', '.github/actions/gone'],
  ]);
});
