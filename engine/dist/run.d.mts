import type { Report } from './render.mts';
type Result = {
    exitCode: 0 | 1 | 2;
    report?: Report;
    text: string;
};
export declare function run(opts: {
    root: string;
    env: NodeJS.ProcessEnv;
}): Result;
export {};
