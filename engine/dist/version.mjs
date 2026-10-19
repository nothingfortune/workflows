import { readFileSync } from 'node:fs';
import path from 'node:path';
const PKG = '@nothingfortune/workflows';
function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return undefined;
    }
}
// Version is informational, so every failure degrades to 'unknown'.
export function engineVersion(root) {
    const pkg = readJson(path.join(root, 'package.json'));
    if (pkg?.name === PKG)
        return 'dev';
    const lock = readJson(path.join(root, 'package-lock.json'));
    const resolved = lock?.packages?.[`node_modules/${PKG}`]?.resolved;
    if (typeof resolved !== 'string')
        return 'unknown';
    return /#([0-9a-f]{40})$/.exec(resolved)?.[1] ?? 'unknown';
}
