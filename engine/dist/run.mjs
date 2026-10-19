import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from "./config.mjs";
import { AnalysisError, mapKnip, mergePasses, resolveKnip, runKnip } from "./knip.mjs";
import { evaluate } from "./policy.mjs";
import { checkReferences } from "./references.mjs";
import { renderAnnotations, renderSummary, renderText } from "./render.mjs";
import { engineVersion } from "./version.mjs";
function count(findings) {
    const counts = {};
    for (const f of findings)
        counts[f.ruleId] = (counts[f.ruleId] ?? 0) + 1;
    return counts;
}
function analyze(root, mode, started) {
    const knip = resolveKnip(root);
    const findings = [
        ...mergePasses(mapKnip(runKnip(root, { production: false }), 'default'), mapKnip(runKnip(root, { production: true }), 'production')),
        ...checkReferences(root),
    ];
    const verdict = evaluate(findings, mode);
    return {
        schemaVersion: 1,
        engine: { version: engineVersion(root) },
        analyzers: { knip: knip.version },
        mode,
        durationMs: Date.now() - started,
        counts: count(findings),
        findings,
        blocking: verdict.blocking.map((f) => f.fingerprint),
        result: verdict.result,
    };
}
export function run(opts) {
    const started = Date.now();
    const { root, env } = opts;
    try {
        const { mode } = loadConfig(root);
        const report = analyze(root, mode, started);
        const dir = path.join(root, 'build', 'integrity');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        if (env.GITHUB_STEP_SUMMARY)
            appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report));
        const lines = [renderText(report)];
        if (env.GITHUB_ACTIONS === 'true')
            lines.push(...renderAnnotations(report));
        return { exitCode: report.result === 'fail' ? 1 : 0, report, text: lines.join('\n') };
    }
    catch (e) {
        if (e instanceof AnalysisError)
            return { exitCode: 2, text: `integrity: analysis failed: ${e.message}` };
        throw e;
    }
}
