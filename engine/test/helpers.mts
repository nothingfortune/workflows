import { cpSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (n: string): string => path.join(here, 'fixtures', n);
const repoModules = path.resolve(here, '../../node_modules');

// Temp copies sit outside the repo, so link node_modules for knip resolution.
export function tempCopy(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'knip-fx-'));
  cpSync(fixture(name), dir, { recursive: true });
  symlinkSync(repoModules, path.join(dir, 'node_modules'), 'dir');
  return dir;
}
