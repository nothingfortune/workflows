export function evaluate(findings, mode) {
    const blocking = mode === 'enforce' ? findings.filter((f) => f.severity !== 'info') : [];
    return blocking.length > 0
        ? { blocking, result: 'fail', exitCode: 1 }
        : { blocking, result: 'pass', exitCode: 0 };
}
