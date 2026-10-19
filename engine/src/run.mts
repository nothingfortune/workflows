import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mts';
import type { Finding } from './finding.mts';
import { AnalysisError, mapKnip, mergePasses, resolveKnip, runKnip } from './knip.mts';
import { evaluate } from './policy.mts';
import { checkReferences } from './references.mts';
import { renderAnnotations, renderSummary, renderText } from './render.mts';
import type { Report } from './render.mts';
import type { RuleId } from './rules.mts';
import { engineVersion } from './version.mts';

type Result = { exitCode: 0 | 1 | 2; report?: Report; text: string };

function count(findings: Finding[]): Report['counts'] {
  const counts: Report['counts'] = {};
  for (const f of findings) counts[f.ruleId as RuleId] = (counts[f.ruleId as RuleId] ?? 0) + 1;
  return counts;
}

function analyze(root: string, mode: Report['mode'], started: number): Report {
  const knip = resolveKnip(root);
  const findings = [
    ...mergePasses(
      mapKnip(runKnip(root, { production: false }), 'default'),
      mapKnip(runKnip(root, { production: true }), 'production'),
    ),
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

export function run(opts: { root: string; env: NodeJS.ProcessEnv }): Result {
  const started = Date.now();
  const { root, env } = opts;
  try {
    const { mode } = loadConfig(root);
    const report = analyze(root, mode, started);
    const dir = path.join(root, 'build', 'integrity');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report));
    const lines = [renderText(report)];
    if (env.GITHUB_ACTIONS === 'true') lines.push(...renderAnnotations(report));
    return { exitCode: report.result === 'fail' ? 1 : 0, report, text: lines.join('\n') };
  } catch (e) {
    if (e instanceof AnalysisError) return { exitCode: 2, text: `integrity: analysis failed: ${e.message}` };
    throw e;
  }
}
