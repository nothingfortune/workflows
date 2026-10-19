const SUMMARY_ROWS = 50;
const LEVEL = { error: 'error', warning: 'warning', info: 'notice' };
const where = (f) => (f.line === undefined ? f.file : `${f.file}:${f.line}`);
const cell = (s) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
const byRule = (a, b) => a[0].localeCompare(b[0]);
export function renderText(report) {
    const lines = [];
    const groups = new Map();
    for (const f of report.findings)
        groups.set(f.ruleId, [...(groups.get(f.ruleId) ?? []), f]);
    for (const [, group] of [...groups].sort(byRule)) {
        for (const f of group)
            lines.push(`${f.ruleId} ${where(f)}${f.symbol ? ` ${f.symbol}` : ''} — ${f.message}`);
    }
    if (lines.length > 0)
        lines.push('');
    for (const [rule, n] of Object.entries(report.counts).sort(byRule))
        lines.push(`${rule}: ${n}`);
    lines.push(`Blocking: ${report.blocking.length}`, `Result: ${report.result === 'pass' ? 'PASS' : 'FAIL'}`, `Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
    return lines.join('\n');
}
export function renderSummary(report) {
    const out = ['## Integrity', '', '| Rule | Count |', '| --- | --- |'];
    for (const [rule, n] of Object.entries(report.counts).sort(byRule))
        out.push(`| ${rule} | ${n} |`);
    if (report.findings.length === 0)
        return `${out.join('\n')}\n`;
    out.push('', '| Rule | Location | Message |', '| --- | --- | --- |');
    for (const f of report.findings.slice(0, SUMMARY_ROWS))
        out.push(`| ${f.ruleId} | ${cell(where(f))} | ${cell(f.message)} |`);
    const more = report.findings.length - SUMMARY_ROWS;
    if (more > 0)
        out.push('', `…and ${more} more`);
    return `${out.join('\n')}\n`;
}
// Workflow-command values escape %, CR and LF so a message cannot inject commands.
const escData = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escProp = (s) => escData(s).replaceAll(':', '%3A').replaceAll(',', '%2C');
export function renderAnnotations(report) {
    return report.findings.map((f) => {
        const line = f.line === undefined ? '' : `,line=${f.line}`;
        return `::${LEVEL[f.severity]} file=${escProp(f.file)}${line},title=${f.ruleId}::${escData(f.message)}`;
    });
}
