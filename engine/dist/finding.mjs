import { createHash } from 'node:crypto';
import { RULES } from './rules.mjs';
export function normalizePath(p) {
    const posix = p.replaceAll('\\', '/');
    if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix) || posix.split('/').includes('..')) {
        throw new Error(`${p} is outside the repo`);
    }
    return posix
        .split('/')
        .filter((seg) => seg !== '' && seg !== '.')
        .join('/');
}
export function fingerprint(ruleId, file, symbol, expression) {
    return createHash('sha256')
        .update([ruleId, normalizePath(file), symbol ?? '', expression ?? ''].join('\0'))
        .digest('hex');
}
export function makeFinding(input) {
    const { ruleId, expression, ...rest } = input;
    if (!Object.hasOwn(RULES, ruleId))
        throw new Error(`unknown rule ${ruleId}`);
    const id = ruleId;
    const file = normalizePath(rest.file);
    return { ...rest, ...RULES[id], ruleId: id, file, fingerprint: fingerprint(id, file, rest.symbol, expression) };
}
export function cycleSymbol(paths) {
    const norm = paths.map(normalizePath);
    const start = norm.indexOf([...norm].sort()[0]);
    return [...norm.slice(start), ...norm.slice(0, start)].join(' -> ');
}
