import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cycleSymbol, makeFinding } from "./finding.mjs";
export class AnalysisError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AnalysisError';
    }
}
const RULE_FOR = {
    files: 'DEAD-001',
    dependencies: 'DEAD-003',
    devDependencies: 'DEAD-003',
    catalog: 'DEAD-003',
    unlisted: 'REF-002',
    binaries: 'REF-002',
    optionalPeerDependencies: 'REF-002',
    catalogReferences: 'REF-002',
    unresolved: 'REF-001',
    exports: 'DEAD-002',
    nsExports: 'DEAD-002',
    types: 'DEAD-002',
    nsTypes: 'DEAD-002',
    enumMembers: 'DEAD-002',
    namespaceMembers: 'DEAD-002',
    duplicates: 'DEAD-002',
    cycles: 'CYC-001',
};
// knip's exports map hides ./package.json, so walk up from its resolved entry.
function findPackageJson(entry) {
    let dir = path.dirname(entry);
    while (!existsSync(path.join(dir, 'package.json'))) {
        const up = path.dirname(dir);
        if (up === dir)
            throw new Error('no package.json');
        dir = up;
    }
    return path.join(dir, 'package.json');
}
export function resolveKnip(root) {
    const req = createRequire(path.join(root, 'package.json'));
    let pkgPath;
    try {
        pkgPath = findPackageJson(req.resolve('knip'));
    }
    catch {
        throw new AnalysisError(`knip is not installed in ${root}`);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (Number.parseInt(pkg.version, 10) !== 6) {
        throw new AnalysisError(`knip ${pkg.version} is not supported; need >=6 <7`);
    }
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.knip;
    if (!rel)
        throw new AnalysisError(`knip ${pkg.version} declares no knip binary`);
    return { bin: path.resolve(path.dirname(pkgPath), rel), version: pkg.version };
}
export function runKnip(root, opts) {
    const { bin } = resolveKnip(root);
    const args = [bin, '--reporter', 'json', '--no-progress', ...(opts.production ? ['--production'] : [])];
    const res = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const firstErr = (res.stderr ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
    if (res.error)
        throw new AnalysisError(`knip failed to start: ${res.error.message}`);
    if (res.status !== 0 && res.status !== 1) {
        throw new AnalysisError(`knip exited ${res.status}${firstErr ? `: ${firstErr}` : ''}`);
    }
    try {
        return JSON.parse(res.stdout);
    }
    catch {
        throw new AnalysisError(`knip output is not JSON${firstErr ? `: ${firstErr}` : ''}`);
    }
}
export function mapKnip(json, pass) {
    const rows = json?.issues;
    if (!Array.isArray(rows))
        throw new AnalysisError('knip output has no issues array');
    const out = [];
    for (const row of rows) {
        const file = String(row.file);
        for (const [type, entries] of Object.entries(row)) {
            if (type === 'file' || type === 'owners')
                continue;
            const ruleId = RULE_FOR[type];
            if (!ruleId)
                throw new AnalysisError(`unknown knip issue type ${type}`);
            if (!Array.isArray(entries))
                continue;
            for (const entry of entries)
                out.push(toFinding(ruleId, type, pass, file, entry));
        }
    }
    return out;
}
function toFinding(ruleId, type, pass, file, entry) {
    const items = Array.isArray(entry) ? entry : [entry];
    const first = items[0] ?? {};
    const symbol = ruleId === 'CYC-001'
        ? cycleSymbol(items.map((i) => String(i.name)))
        : type === 'files'
            ? undefined
            : (first.specifier ?? first.name);
    return makeFinding({
        ruleId,
        file,
        line: first.line,
        column: first.col,
        symbol,
        message: `${type}: ${symbol ?? file}`,
        evidence: [`knip ${pass} pass: ${type}`],
        analyzer: 'knip',
    });
}
export function mergePasses(def, prod) {
    const seen = new Set(def.map((f) => f.fingerprint));
    const out = [...def];
    for (const f of prod) {
        if (seen.has(f.fingerprint))
            continue;
        const demote = f.ruleId === 'DEAD-001' || f.ruleId === 'DEAD-002';
        const next = demote
            ? makeFinding({ ...f, ruleId: 'DEAD-004', evidence: ['reachable only from tests'] })
            : f;
        if (seen.has(next.fingerprint))
            continue;
        seen.add(next.fingerprint);
        out.push(next);
    }
    return out;
}
