import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cycleSymbol, makeFinding } from './finding.mts';
import type { Finding } from './finding.mts';
import type { RuleId } from './rules.mts';

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

type Pass = 'default' | 'production' | 'cycles';
type Item = { name?: string; specifier?: string; line?: number; col?: number };

const RULE_FOR: Readonly<Record<string, RuleId>> = {
  files: 'DEAD-001',
  dependencies: 'DEAD-003',
  devDependencies: 'DEAD-003',
  catalog: 'DEAD-003',
  unlisted: 'REF-002',
  binaries: 'REF-002',
  optionalPeerDependencies: 'REF-002',
  catalogReferences: 'REF-002',
  unresolved: 'REF-001',
  exports: 'DEAD-002',
  nsExports: 'DEAD-002',
  types: 'DEAD-002',
  nsTypes: 'DEAD-002',
  enumMembers: 'DEAD-002',
  namespaceMembers: 'DEAD-002',
  duplicates: 'DEAD-002',
  cycles: 'CYC-001',
};

// knip's exports map hides ./package.json, so walk up from its resolved entry.
function findPackageJson(entry: string): string {
  let dir = path.dirname(entry);
  while (!existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('no package.json');
    dir = up;
  }
  return path.join(dir, 'package.json');
}

export function resolveKnip(root: string): { bin: string; version: string } {
  const req = createRequire(path.join(root, 'package.json'));
  let pkgPath: string;
  try {
    pkgPath = findPackageJson(req.resolve('knip'));
  } catch {
    throw new AnalysisError(`knip is not installed in ${root}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; bin: string | Record<string, string> };
  if (Number.parseInt(pkg.version, 10) !== 6) {
    throw new AnalysisError(`knip ${pkg.version} is not supported; need >=6 <7`);
  }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.knip;
  if (!rel) throw new AnalysisError(`knip ${pkg.version} declares no knip binary`);
  return { bin: path.resolve(path.dirname(pkgPath), rel), version: pkg.version };
}

export function runKnip(root: string, knip: { bin: string }, opts: { production: boolean; include?: string }): unknown {
  const args = [
    knip.bin,
    '--reporter',
    'json',
    '--no-progress',
    ...(opts.include ? ['--include', opts.include] : []),
    ...(opts.production ? ['--production'] : []),
  ];
  const res = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const firstErr = (res.stderr ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
  if (res.error) throw new AnalysisError(`knip failed to start: ${res.error.message}`);
  if (res.status !== 0 && res.status !== 1) {
    throw new AnalysisError(`knip exited ${res.status}${firstErr ? `: ${firstErr}` : ''}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new AnalysisError(`knip output is not JSON${firstErr ? `: ${firstErr}` : ''}`);
  }
}

export function mapKnip(json: unknown, pass: Pass): Finding[] {
  const rows = (json as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(rows)) throw new AnalysisError('knip output has no issues array');
  const out: Finding[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const file = String(row.file);
    for (const [type, entries] of Object.entries(row)) {
      if (type === 'file' || type === 'owners') continue;
      const ruleId = RULE_FOR[type];
      if (!ruleId) throw new AnalysisError(`unknown knip issue type ${type}`);
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) out.push(toFinding(ruleId, type, pass, file, entry));
    }
  }
  return out;
}

function toFinding(ruleId: RuleId, type: string, pass: Pass, file: string, entry: unknown): Finding {
  const items: Item[] = Array.isArray(entry) ? entry : [entry as Item];
  const first = items[0] ?? {};
  const symbol =
    ruleId === 'CYC-001'
      ? cycleSymbol(items.map((i) => String(i.name)))
      : type === 'files'
        ? undefined
        : (first.specifier ?? first.name);
  return makeFinding({
    ruleId,
    file,
    line: first.line,
    column: first.col,
    symbol,
    message: `${type}: ${symbol ?? file}`,
    evidence: [`knip ${pass} pass: ${type}`],
    analyzer: 'knip',
  });
}

export function mergePasses(def: Finding[], prod: Finding[]): Finding[] {
  const seen = new Set(def.map((f) => f.fingerprint));
  const out = [...def];
  for (const f of prod) {
    if (seen.has(f.fingerprint)) continue;
    const demote = f.ruleId === 'DEAD-001' || f.ruleId === 'DEAD-002';
    const next = demote
      ? makeFinding({ ...f, ruleId: 'DEAD-004', evidence: ['reachable only from tests'] })
      : f;
    if (seen.has(next.fingerprint)) continue;
    seen.add(next.fingerprint);
    out.push(next);
  }
  return out;
}

// knip 6 omits cycles by default, and --include on the main passes would override the consumer's knip.json exclude.
export function knipFindings(root: string, knip: { bin: string }): Finding[] {
  const merged = mergePasses(
    mapKnip(runKnip(root, knip, { production: false }), 'default'),
    mapKnip(runKnip(root, knip, { production: true }), 'production'),
  );
  const seen = new Set(merged.map((f) => f.fingerprint));
  const cycles = mapKnip(runKnip(root, knip, { production: true, include: 'cycles' }), 'cycles');
  return [...merged, ...cycles.filter((f) => !seen.has(f.fingerprint))];
}
