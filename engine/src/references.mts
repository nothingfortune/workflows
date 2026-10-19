import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeFinding } from './finding.mts';
import type { Finding } from './finding.mts';
import { AnalysisError } from './knip.mts';

const PATH_TOKEN = /^(?:\.\/)?(?:[\w@.-]+\/)*[\w@.-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|bash|py)$/;
const EVAL_FLAGS = new Set(['-e', '-c', '--eval', '--print']);
const INTERPRETERS = new Set(['bash', 'sh', 'node', 'python', 'python3']);
const QUOTED = '\u0000';

function segments(command: string): string[][] {
  return command
    .replace(/"[^"]*"|'[^']*'/g, ` ${QUOTED} `)
    .split(/&&|\|\||;|\|/)
    .map((s) => s.split(/\s+/).filter(Boolean));
}

function isPath(token: string): boolean {
  return PATH_TOKEN.test(token) && !/[$*?{]|:\/\//.test(token) && !token.startsWith('-');
}

export function scriptPaths(command: string): string[] {
  const found: string[] = [];
  for (const tokens of segments(command)) {
    tokens.forEach((token, i) => {
      if (EVAL_FLAGS.has(tokens[i - 1] ?? '')) return;
      if (isPath(token)) found.push(token);
    });
  }
  return found;
}

function interpreterPaths(command: string): string[] {
  const found: string[] = [];
  for (const tokens of segments(command)) {
    const at = tokens.findIndex((t) => INTERPRETERS.has(t));
    if (at < 0) continue;
    let i = at + 1;
    while (i < tokens.length && tokens[i]?.startsWith('-')) {
      if (EVAL_FLAGS.has(tokens[i] as string)) break;
      i++;
    }
    const token = tokens[i];
    if (token !== undefined && isPath(token)) found.push(token);
  }
  return found;
}

function unquote(value: string): string {
  const v = value.trim();
  return v.length > 1 && /^["']/.test(v) && v.endsWith(v[0] as string) ? v.slice(1, -1) : v;
}

const BLOCK_SCALAR = /^[|>][+-]?$/;

export function workflowPaths(text: string): { path: string; line: number; via: 'run' | 'uses' }[] {
  const out: { path: string; line: number; via: 'run' | 'uses' }[] = [];
  const lines = text.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] as string;
    if (raw.trim().startsWith('#')) continue;
    const m = /^(\s*(?:-\s+)?)(run|uses):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const via = m[2] as 'run' | 'uses';
    const value = unquote((m[3] as string).replace(/\s+#.*$/, ''));
    if (via === 'uses') {
      if (value.startsWith('./')) out.push({ path: value.slice(2).replace(/\/$/, ''), line: idx + 1, via });
    } else if (BLOCK_SCALAR.test(value)) {
      const keyIndent = (m[1] as string).length;
      while (idx + 1 < lines.length) {
        const next = lines[idx + 1] as string;
        if (next.trim() !== '' && next.length - next.trimStart().length < keyIndent) break;
        idx++;
        if (next.trim() === '' || next.trim().startsWith('#')) continue;
        for (const p of interpreterPaths(next)) out.push({ path: p, line: idx + 1, via });
      }
    } else {
      for (const p of interpreterPaths(value)) out.push({ path: p, line: idx + 1, via });
    }
  }
  return out;
}

function readJson(root: string, name: string): unknown {
  const file = path.join(root, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new AnalysisError(`${name} is not valid JSON: ${(e as Error).message}`);
  }
}

// Build outputs like dist/ are absent from a checkout; a non-git root skips nothing.
function isIgnored(root: string, p: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function lineOf(text: string, needle: string, after = 0): number | undefined {
  const lines = text.split('\n');
  const i = lines.findIndex((l, n) => n >= after && l.includes(needle));
  return i < 0 ? undefined : i + 1;
}

function missing(file: string, symbol: string, evidence: string, line?: number): Finding {
  return makeFinding({
    ruleId: 'REF-003',
    file,
    ...(line === undefined ? {} : { line }),
    symbol,
    message: `${file} references ${symbol}, which does not exist`,
    evidence: [evidence],
    remediation: `Create ${symbol} or remove the reference.`,
    analyzer: 'references',
  });
}

function checkScripts(root: string): Finding[] {
  const pkg = readJson(root, 'package.json') as { scripts?: Record<string, unknown> } | undefined;
  if (!pkg?.scripts || typeof pkg.scripts !== 'object') return [];
  const text = readFileSync(path.join(root, 'package.json'), 'utf8');
  const out: Finding[] = [];
  const start = Math.max(0, (lineOf(text, '"scripts"') ?? 1) - 1);
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (typeof command !== 'string') continue;
    for (const p of scriptPaths(command)) {
      if (existsSync(path.join(root, p)) || isIgnored(root, p)) continue;
      out.push(missing('package.json', p, `package.json scripts.${name}`, lineOf(text, `"${name}"`, start)));
    }
  }
  return out;
}

function checkWorkflows(root: string): Finding[] {
  const dir = path.join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const out: Finding[] = [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.ya?ml$/.test(d.name))
    .map((d) => d.name)
    .sort();
  for (const name of files) {
    const rel = `.github/workflows/${name}`;
    for (const ref of workflowPaths(readFileSync(path.join(dir, name), 'utf8'))) {
      const abs = path.join(root, ref.path);
      const isAction = ref.via === 'uses' && !/\.ya?ml$/.test(ref.path);
      const ok = isAction ? existsSync(path.join(abs, 'action.yml')) || existsSync(path.join(abs, 'action.yaml')) : existsSync(abs);
      if (!ok && !isIgnored(root, ref.path)) out.push(missing(rel, ref.path, `workflow ${ref.via}:`, ref.line));
    }
  }
  return out;
}

function checkKnip(root: string): Finding[] {
  const config = readJson(root, 'knip.json') as Record<string, unknown> | undefined;
  if (!config || typeof config !== 'object') return [];
  const text = readFileSync(path.join(root, 'knip.json'), 'utf8');
  const out: Finding[] = [];
  for (const key of ['entry', 'project'] as const) {
    const raw = config[key];
    const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const p = v.replace(/!$/, '');
      if (p.startsWith('!') || /[*?{}[\]()]/.test(p)) continue;
      if (!existsSync(path.join(root, p)) && !isIgnored(root, p)) out.push(missing('knip.json', p, `knip.json ${key}`, lineOf(text, v)));
    }
  }
  return out;
}

export function checkReferences(root: string): Finding[] {
  return [...checkScripts(root), ...checkWorkflows(root), ...checkKnip(root)];
}
