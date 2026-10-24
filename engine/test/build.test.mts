import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/bin/integrity.mjs');

test('the built bin rejects bad usage with exit 2', () => {
  for (const args of [[], ['check', '--root'], ['check', '--nope']]) {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: integrity check \[--root <dir>\]\n$/);
  }
});
