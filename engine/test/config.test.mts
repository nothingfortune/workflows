import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mts';
import { engineVersion } from '../src/version.mts';

const here = path.dirname(fileURLToPath(import.meta.url));

function withDir(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfg-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no integrity.json means enforce', () => {
  withDir({}, (dir) => assert.deepEqual(loadConfig(dir), { mode: 'enforce' }));
});

test('valid integrity.json sets the mode and allows $schema', () => {
  withDir({ 'integrity.json': '{"$schema":"x","mode":"observe"}' }, (dir) =>
    assert.deepEqual(loadConfig(dir), { mode: 'observe' }),
  );
  withDir({ 'integrity.json': '{}' }, (dir) => assert.deepEqual(loadConfig(dir), { mode: 'enforce' }));
});

test('bad JSON, an unknown key and a bad mode are analysis failures', () => {
  for (const body of ['{nope', '{"extra":1}', '{"mode":"strict"}']) {
    withDir({ 'integrity.json': body }, (dir) => assert.throws(() => loadConfig(dir), /integrity\.json: /));
  }
  withDir({ 'integrity.json': '[]' }, (dir) => assert.throws(() => loadConfig(dir), /integrity\.json: /));
});

test('engine version comes from the consumer lockfile', () => {
  const sha = 'a'.repeat(40);
  const lock = (resolved: string) =>
    JSON.stringify({ packages: { 'node_modules/@nothingfortune/workflows': { resolved } } });
  withDir({ 'package-lock.json': lock(`git+ssh://git@github.com/nothingfortune/workflows.git#${sha}`) }, (dir) =>
    assert.equal(engineVersion(dir), sha),
  );
  withDir({}, (dir) => assert.equal(engineVersion(dir), 'unknown'));
  withDir({ 'package-lock.json': lock('git+ssh://git@github.com/nothingfortune/workflows.git#main') }, (dir) =>
    assert.equal(engineVersion(dir), 'unknown'),
  );
  withDir({ 'package-lock.json': '{broken' }, (dir) => assert.equal(engineVersion(dir), 'unknown'));
  assert.equal(engineVersion(path.resolve(here, '../..')), 'dev');
});
