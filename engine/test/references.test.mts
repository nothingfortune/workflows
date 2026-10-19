import assert from 'node:assert/strict';
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
  const found = checkReferences(fixture).filter((f) => f.file.startsWith('.github/'));
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
