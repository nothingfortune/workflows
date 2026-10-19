import { readFileSync } from 'node:fs';
import path from 'node:path';

const PKG = '@nothingfortune/workflows';

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// Version is informational, so every failure degrades to 'unknown'.
export function engineVersion(root: string): string {
  const pkg = readJson(path.join(root, 'package.json')) as { name?: unknown } | null | undefined;
  if (pkg?.name === PKG) return 'dev';
  const lock = readJson(path.join(root, 'package-lock.json')) as
    | { packages?: Record<string, { resolved?: unknown } | undefined> }
    | null
    | undefined;
  const resolved = lock?.packages?.[`node_modules/${PKG}`]?.resolved;
  if (typeof resolved !== 'string') return 'unknown';
  return /#([0-9a-f]{40})$/.exec(resolved)?.[1] ?? 'unknown';
}
