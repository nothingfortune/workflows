import { createHash } from 'node:crypto';
import { RULES } from './rules.mts';
import type { Classification, Confidence, RuleId, Severity } from './rules.mts';

export type Finding = {
  ruleId: RuleId;
  severity: Severity;
  confidence: Confidence;
  classification: Classification;
  file: string;
  line?: number;
  column?: number;
  symbol?: string;
  message: string;
  evidence: string[];
  remediation?: string;
  analyzer: string;
  fingerprint: string;
};

export function normalizePath(p: string): string {
  const posix = p.replaceAll('\\', '/');
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix) || posix.split('/').includes('..')) {
    throw new Error(`${p} is outside the repo`);
  }
  return posix
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
}

export function fingerprint(ruleId: RuleId, file: string, symbol?: string, expression?: string): string {
  return createHash('sha256')
    .update([ruleId, normalizePath(file), symbol ?? '', expression ?? ''].join('\0'))
    .digest('hex');
}

export function makeFinding(
  input: Omit<Finding, 'severity' | 'confidence' | 'classification' | 'fingerprint' | 'ruleId'> & {
    ruleId: string;
    expression?: string;
  },
): Finding {
  const { ruleId, expression, ...rest } = input;
  if (!Object.hasOwn(RULES, ruleId)) throw new Error(`unknown rule ${ruleId}`);
  const id = ruleId as RuleId;
  const file = normalizePath(rest.file);
  return { ...rest, ...RULES[id], ruleId: id, file, fingerprint: fingerprint(id, file, rest.symbol, expression) };
}

export function cycleSymbol(paths: string[]): string {
  const norm = paths.map(normalizePath);
  const start = norm.indexOf([...norm].sort()[0] as string);
  return [...norm.slice(start), ...norm.slice(0, start)].join(' -> ');
}
