export const RULES = {
    'REF-001': { classification: 'broken-reference', severity: 'error', confidence: 'high' },
    'REF-002': { classification: 'unlisted-dependency', severity: 'error', confidence: 'high' },
    'REF-003': { classification: 'broken-reference', severity: 'error', confidence: 'medium' },
    'DEAD-001': { classification: 'orphaned-file', severity: 'warning', confidence: 'high' },
    'DEAD-002': { classification: 'unused-export', severity: 'warning', confidence: 'high' },
    'DEAD-003': { classification: 'unused-dependency', severity: 'warning', confidence: 'high' },
    'DEAD-004': { classification: 'disconnected-file', severity: 'warning', confidence: 'high' },
    'CYC-001': { classification: 'circular-dependency', severity: 'warning', confidence: 'high' },
};
