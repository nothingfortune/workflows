import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeFinding } from './finding.mjs';
import { AnalysisError } from './knip.mjs';
const PATH_TOKEN = /^(?:\.\/)?(?:[\w@.-]+\/)*[\w@.-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|bash|py)$/;
const EVAL_FLAGS = new Set(['-e', '-c', '--eval', '--print']);
const INTERPRETERS = new Set(['bash', 'sh', 'node', 'python', 'python3']);
const QUOTED = '\u0000';
function segments(command) {
    return command
        .replace(/"[^"]*"|'[^']*'/g, ` ${QUOTED} `)
        .split(/&&|\|\||;|\|/)
        .map((s) => s.split(/\s+/).filter(Boolean));
}
function isPath(token) {
    return PATH_TOKEN.test(token) && !/[$*?{]|:\/\//.test(token) && !token.startsWith('-');
}
export function scriptPaths(command) {
    const found = [];
    for (const tokens of segments(command)) {
        tokens.forEach((token, i) => {
            if (EVAL_FLAGS.has(tokens[i - 1] ?? ''))
                return;
            if (isPath(token))
                found.push(token);
        });
    }
    return found;
}
function interpreterPaths(command) {
    const found = [];
    for (const tokens of segments(command)) {
        const at = tokens.findIndex((t) => INTERPRETERS.has(t));
        if (at < 0)
            continue;
        let i = at + 1;
        while (i < tokens.length && tokens[i]?.startsWith('-')) {
            if (EVAL_FLAGS.has(tokens[i]))
                break;
            i++;
        }
        const token = tokens[i];
        if (token !== undefined && isPath(token))
            found.push(token);
    }
    return found;
}
function unquote(value) {
    const v = value.trim();
    return v.length > 1 && /^["']/.test(v) && v.endsWith(v[0]) ? v.slice(1, -1) : v;
}
const BLOCK_SCALAR = /^[|>][+-]?$/;
export function workflowPaths(text) {
    const out = [];
    const lines = text.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
        const raw = lines[idx];
        if (raw.trim().startsWith('#'))
            continue;
        const m = /^(\s*(?:-\s+)?)(run|uses):\s*(.*)$/.exec(raw);
        if (!m)
            continue;
        const via = m[2];
        const value = unquote(m[3].replace(/\s+#.*$/, ''));
        if (via === 'uses') {
            if (value.startsWith('./'))
                out.push({ path: value.slice(2).replace(/\/$/, ''), line: idx + 1, via });
        }
        else if (BLOCK_SCALAR.test(value)) {
            const keyIndent = m[1].length;
            while (idx + 1 < lines.length) {
                const next = lines[idx + 1];
                if (next.trim() !== '' && next.length - next.trimStart().length <= keyIndent)
                    break;
                idx++;
                if (next.trim() === '' || next.trim().startsWith('#'))
                    continue;
                for (const p of interpreterPaths(next))
                    out.push({ path: p, line: idx + 1, via });
            }
        }
        else {
            for (const p of interpreterPaths(value))
                out.push({ path: p, line: idx + 1, via });
        }
    }
    return out;
}
function readJson(root, name) {
    const file = path.join(root, name);
    if (!existsSync(file))
        return undefined;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch (e) {
        throw new AnalysisError(`${name} is not valid JSON: ${e.message}`);
    }
}
function cleanEnv() {
    return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
}
// Build outputs like dist/ are absent from a checkout; a non-git root skips nothing.
function isIgnored(root, p) {
    try {
        execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: root, stdio: 'ignore', env: cleanEnv() });
        return true;
    }
    catch {
        return false;
    }
}
function lineOf(text, needle, after = 0) {
    const lines = text.split('\n');
    const i = lines.findIndex((l, n) => n >= after && l.includes(needle));
    return i < 0 ? undefined : i + 1;
}
function missing(file, symbol, evidence, line) {
    return makeFinding({
        ruleId: 'REF-003',
        file,
        ...(line === undefined ? {} : { line }),
        symbol,
        message: `${file} references ${symbol}, which does not exist`,
        evidence: [evidence],
        remediation: `Create ${symbol} or remove the reference.`,
        analyzer: 'references',
    });
}
function checkScripts(root) {
    const pkg = readJson(root, 'package.json');
    if (!pkg?.scripts || typeof pkg.scripts !== 'object')
        return [];
    const text = readFileSync(path.join(root, 'package.json'), 'utf8');
    const out = [];
    const start = Math.max(0, (lineOf(text, '"scripts"') ?? 1) - 1);
    for (const [name, command] of Object.entries(pkg.scripts)) {
        if (typeof command !== 'string')
            continue;
        for (const p of scriptPaths(command)) {
            if (existsSync(path.join(root, p)) || isIgnored(root, p))
                continue;
            out.push(missing('package.json', p, `package.json scripts.${name}`, lineOf(text, `"${name}"`, start)));
        }
    }
    return out;
}
// Steps in a callable workflow run in the caller's checkout, so their run: paths are not ours to check.
export function isCallable(text) {
    return /^\s*workflow_call\s*:/m.test(text) || /^\s*on\s*:.*\bworkflow_call\b/m.test(text);
}
function checkWorkflows(root) {
    const dir = path.join(root, '.github', 'workflows');
    if (!existsSync(dir))
        return [];
    const out = [];
    const files = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && /\.ya?ml$/.test(d.name))
        .map((d) => d.name)
        .sort();
    for (const name of files) {
        const rel = `.github/workflows/${name}`;
        const text = readFileSync(path.join(dir, name), 'utf8');
        const callable = isCallable(text);
        for (const ref of workflowPaths(text)) {
            if (callable && ref.via === 'run')
                continue;
            const abs = path.join(root, ref.path);
            const isAction = ref.via === 'uses' && !/\.ya?ml$/.test(ref.path);
            const ok = isAction ? existsSync(path.join(abs, 'action.yml')) || existsSync(path.join(abs, 'action.yaml')) : existsSync(abs);
            if (!ok && !isIgnored(root, ref.path))
                out.push(missing(rel, ref.path, `workflow ${ref.via}:`, ref.line));
        }
    }
    return out;
}
function checkKnip(root) {
    const config = readJson(root, 'knip.json');
    if (!config || typeof config !== 'object')
        return [];
    const text = readFileSync(path.join(root, 'knip.json'), 'utf8');
    const out = [];
    for (const key of ['entry', 'project']) {
        const raw = config[key];
        const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
        for (const v of values) {
            if (typeof v !== 'string')
                continue;
            const p = v.replace(/!$/, '');
            if (p.startsWith('!') || /[*?{}[\]()]/.test(p))
                continue;
            if (!existsSync(path.join(root, p)) && !isIgnored(root, p))
                out.push(missing('knip.json', p, `knip.json ${key}`, lineOf(text, v)));
        }
    }
    return out;
}
export function checkReferences(root) {
    return [...checkScripts(root), ...checkWorkflows(root), ...checkKnip(root)];
}
