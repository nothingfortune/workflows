import type { Finding } from './finding.mts';
import type { Mode } from './config.mts';

export function evaluate(
  findings: Finding[],
  mode: Mode,
): { blocking: Finding[]; result: 'pass' | 'fail'; exitCode: 0 | 1 } {
  const blocking = mode === 'enforce' ? findings.filter((f) => f.severity !== 'info') : [];
  return blocking.length > 0
    ? { blocking, result: 'fail', exitCode: 1 }
    : { blocking, result: 'pass', exitCode: 0 };
}
