import type { Finding } from './finding.mts';
export declare class AnalysisError extends Error {
    constructor(message: string);
}
type Pass = 'default' | 'production' | 'cycles';
export declare function resolveKnip(root: string): {
    bin: string;
    version: string;
};
export declare function runKnip(root: string, knip: {
    bin: string;
}, opts: {
    production: boolean;
    include?: string;
}): unknown;
export declare function mapKnip(json: unknown, pass: Pass): Finding[];
export declare function mergePasses(def: Finding[], prod: Finding[]): Finding[];
export declare function knipFindings(root: string, knip: {
    bin: string;
}): Finding[];
export {};
