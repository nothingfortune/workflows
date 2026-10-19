import type { Finding } from './finding.mts';
import type { Mode } from './config.mts';
export declare function evaluate(findings: Finding[], mode: Mode): {
    blocking: Finding[];
    result: 'pass' | 'fail';
    exitCode: 0 | 1;
};
