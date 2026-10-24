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
export declare function normalizePath(p: string): string;
export declare function fingerprint(ruleId: RuleId, file: string, symbol?: string, expression?: string): string;
export declare function makeFinding(input: Omit<Finding, 'severity' | 'confidence' | 'classification' | 'fingerprint' | 'ruleId'> & {
    ruleId: string;
    expression?: string;
}): Finding;
export declare function cycleSymbol(paths: string[]): string;
