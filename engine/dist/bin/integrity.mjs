#!/usr/bin/env node
import path from 'node:path';
import { run } from '../run.mjs';
const USAGE = 'usage: integrity check [--root <dir>]';
function parse(argv) {
    const [cmd, flag, dir, ...rest] = argv;
    if (cmd !== 'check')
        return undefined;
    if (flag === undefined)
        return process.cwd();
    return flag === '--root' && dir !== undefined && rest.length === 0 ? path.resolve(dir) : undefined;
}
const root = parse(process.argv.slice(2));
if (root === undefined) {
    console.error(USAGE);
    process.exitCode = 2;
}
else {
    try {
        const result = run({ root, env: process.env });
        (result.exitCode === 2 ? console.error : console.log)(result.text);
        process.exitCode = result.exitCode;
    }
    catch (e) {
        console.error(`integrity: internal error: ${e.message}`);
        process.exitCode = 2;
    }
}
