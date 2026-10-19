import type { Mode } from './config.mts';
import type { Finding } from './finding.mts';
import type { RuleId } from './rules.mts';
export type Report = {
    schemaVersion: 1;
    engine: {
        version: string;
    };
    analyzers: {
        knip: string;
    };
    mode: Mode;
    durationMs: number;
    counts: Partial<Record<RuleId, number>>;
    findings: Finding[];
    blocking: string[];
    result: 'pass' | 'fail';
};
export declare function renderText(report: Report): string;
export declare function renderSummary(report: Report): string;
export declare function renderAnnotations(report: Report): string[];
