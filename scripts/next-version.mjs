// Prints the next release tag for the commits since the last semver tag, or nothing; rules: README → Releases.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NO_RELEASE = new Set(['docs', 'chore', 'ci', 'test', 'style']);
const LEVELS = ['patch', 'minor', 'major'];

export function commitLevel({ subject, body }) {
  const m = /^(\w+)(?:\([^)]*\))?(!)?:/.exec(subject);
  if (m?.[2] || /^BREAKING[ -]CHANGE:/m.test(body)) return 'major';
  if (!m) return 'patch';
  if (m[1] === 'feat') return 'minor';
  return NO_RELEASE.has(m[1]) ? null : 'patch';
}

export function bump(tag, level) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!m) throw new Error(`not a semver tag: ${tag}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (level === 'major') return `v${maj + 1}.0.0`;
  if (level === 'minor') return `v${maj}.${min + 1}.0`;
  return `v${maj}.${min}.${pat + 1}`;
}

// commits: [{ subject, body, files }]; isCallable(file) → boolean.
export function nextVersion(lastTag, commits, isCallable) {
  let best = -1;
  for (const c of commits) {
    if (!c.files.some(isCallable)) continue;
    const level = commitLevel(c);
    if (level) best = Math.max(best, LEVELS.indexOf(level));
  }
  return best < 0 ? null : bump(lastTag, LEVELS[best]);
}

// `git log` with \x1e before each commit and \x1f between subject and body.
export function parseLog(out) {
  return out
    .split('\x1e')
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [subject, body, rest = ''] = rec.split('\x1f');
      const files = rest.split('\n').map((f) => f.trim()).filter(Boolean);
      return { subject: subject.trim(), body, files };
    });
}

function main(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*').trim();
  const log = git('log', '--no-merges', '--format=%x1e%s%x1f%b%x1f', '--name-only', `${lastTag}..HEAD`);
  // A deleted workflow file can no longer be read, so it counts as callable: deletion breaks callers.
  const isCallable = (file) => {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) return false;
    const abs = path.join(root, file);
    return !existsSync(abs) || readFileSync(abs, 'utf8').includes('workflow_call');
  };
  const next = nextVersion(lastTag, parseLog(log), isCallable);
  if (next) console.log(next);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  main(i > 0 ? process.argv[i + 1] : process.cwd());
}
