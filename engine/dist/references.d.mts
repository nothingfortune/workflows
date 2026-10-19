import type { Finding } from './finding.mts';
export declare function scriptPaths(command: string): string[];
export declare function workflowPaths(text: string): {
    path: string;
    line: number;
    via: 'run' | 'uses';
}[];
export declare function checkReferences(root: string): Finding[];
