import type { Finding } from './finding.mts';
export declare class AnalysisError extends Error {
    constructor(message: string);
}
type Pass = 'default' | 'production';
export declare function resolveKnip(root: string): {
    bin: string;
    version: string;
};
export declare function runKnip(root: string, opts: {
    production: boolean;
}): unknown;
export declare function mapKnip(json: unknown, pass: Pass): Finding[];
export declare function mergePasses(def: Finding[], prod: Finding[]): Finding[];
export {};
