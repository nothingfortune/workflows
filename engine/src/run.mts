import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mts';
import type { Finding } from './finding.mts';
import { AnalysisError, knipFindings, resolveKnip } from './knip.mts';
import { evaluate } from './policy.mts';
import { checkReferences } from './references.mts';
import { renderAnnotations, renderSummary, renderText } from './render.mts';
import type { Report } from './render.mts';
import { engineVersion } from './version.mts';

type Result = { exitCode: 0 | 1 | 2; report?: Report; text: string };

function count(findings: Finding[]): Report['counts'] {
  const counts: Report['counts'] = {};
  for (const f of findings) counts[f.ruleId] = (counts[f.ruleId] ?? 0) + 1;
  return counts;
}

function analyze(root: string, mode: Report['mode'], started: number): { report: Report; exitCode: 0 | 1 } {
  const knip = resolveKnip(root);
  const findings = [...knipFindings(root, knip), ...checkReferences(root)];
  const verdict = evaluate(findings, mode);
  const report: Report = {
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
  return { report, exitCode: verdict.exitCode };
}

export function run(opts: { root: string; env: NodeJS.ProcessEnv }): Result {
  const started = Date.now();
  const { root, env } = opts;
  const dir = path.join(root, 'build', 'integrity');
  // A stale pass report must not survive a run that exits 2.
  rmSync(path.join(dir, 'report.json'), { force: true });
  try {
    const { mode } = loadConfig(root);
    const { report, exitCode } = analyze(root, mode, started);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report));
    const lines = [renderText(report)];
    if (env.GITHUB_ACTIONS === 'true') lines.push(...renderAnnotations(report));
    return { exitCode, report, text: lines.join('\n') };
  } catch (e) {
    if (e instanceof AnalysisError) return { exitCode: 2, text: `integrity: analysis failed: ${e.message}` };
    throw e;
  }
}
