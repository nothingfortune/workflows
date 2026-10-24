export type RuleId =
  | 'REF-001'
  | 'REF-002'
  | 'REF-003'
  | 'DEAD-001'
  | 'DEAD-002'
  | 'DEAD-003'
  | 'DEAD-004'
  | 'CYC-001';
export type Severity = 'error' | 'warning' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type Classification =
  | 'broken-reference'
  | 'unlisted-dependency'
  | 'orphaned-file'
  | 'unused-export'
  | 'unused-dependency'
  | 'disconnected-file'
  | 'circular-dependency';

export const RULES: Readonly<
  Record<RuleId, { classification: Classification; severity: Severity; confidence: Confidence }>
> = {
  'REF-001': { classification: 'broken-reference', severity: 'error', confidence: 'high' },
  'REF-002': { classification: 'unlisted-dependency', severity: 'error', confidence: 'high' },
  'REF-003': { classification: 'broken-reference', severity: 'error', confidence: 'medium' },
  'DEAD-001': { classification: 'orphaned-file', severity: 'warning', confidence: 'high' },
  'DEAD-002': { classification: 'unused-export', severity: 'warning', confidence: 'high' },
  'DEAD-003': { classification: 'unused-dependency', severity: 'warning', confidence: 'high' },
  'DEAD-004': { classification: 'disconnected-file', severity: 'warning', confidence: 'high' },
  'CYC-001': { classification: 'circular-dependency', severity: 'warning', confidence: 'high' },
};
