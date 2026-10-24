import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AnalysisError } from './knip.mts';

export type Mode = 'enforce' | 'observe';

const KEYS = new Set(['$schema', 'mode']);

export function loadConfig(root: string): { mode: Mode } {
  const file = path.join(root, 'integrity.json');
  if (!existsSync(file)) return { mode: 'enforce' };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new AnalysisError(`integrity.json: ${(e as Error).message}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new AnalysisError('integrity.json: must be a JSON object');
  }
  const obj = json as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KEYS.has(key)) throw new AnalysisError(`integrity.json: unknown key "${key}"`);
  }
  const mode = obj.mode ?? 'enforce';
  if (mode !== 'enforce' && mode !== 'observe') {
    throw new AnalysisError(`integrity.json: mode must be "enforce" or "observe"`);
  }
  return { mode };
}
