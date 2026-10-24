export type RuleId = 'REF-001' | 'REF-002' | 'REF-003' | 'DEAD-001' | 'DEAD-002' | 'DEAD-003' | 'DEAD-004' | 'CYC-001';
export type Severity = 'error' | 'warning' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type Classification = 'broken-reference' | 'unlisted-dependency' | 'orphaned-file' | 'unused-export' | 'unused-dependency' | 'disconnected-file' | 'circular-dependency';
export declare const RULES: Readonly<Record<RuleId, {
    classification: Classification;
    severity: Severity;
    confidence: Confidence;
}>>;
