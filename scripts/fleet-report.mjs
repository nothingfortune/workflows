// Reports which repos call which shared workflows, at which release, and where a local copy stands in for one.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'nothingfortune/workflows';
const DEFAULT_OWNERS = ['nothingfortune', 'hestiamediagroup'];
const USES = new RegExp(`uses:\\s*${REPO}/\\.github/workflows/([\\w.-]+\\.ya?ml)@([\\w.-]+)`, 'g');

// Every `uses:` of a shared workflow in one caller file.
export function parseCalls(text) {
  return [...text.matchAll(USES)].map((m) => ({ workflow: m[1], ref: m[2] }));
}

// tags: [{ tag, sha }] for vX.Y.Z only; newest first.
export function sortReleases(tags) {
  const key = (t) => t.tag.slice(1).split('.').map(Number);
  return tags
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t.tag))
    .sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

export function classifyRef(ref, releases) {
  if (!/^[0-9a-f]{40}$/.test(ref)) return { status: 'unpinned', release: ref, behind: null };
  const i = releases.findIndex((r) => r.sha === ref);
  if (i < 0) return { status: 'unreleased', release: null, behind: null };
  return { status: i === 0 ? 'current' : 'behind', release: releases[i].tag, behind: i };
}

// files: { name: text } for one repo's .github/workflows; shared: callable workflow filenames here.
export function auditRepo(files, shared, releases) {
  const calls = [];
  const copies = [];
  for (const [name, text] of Object.entries(files)) {
    const found = parseCalls(text);
    for (const c of found) calls.push({ file: name, ...c, ...classifyRef(c.ref, releases) });
    if (shared.includes(name) && !found.some((c) => c.workflow === name)) copies.push(name);
  }
  return { calls, copies };
}

const LABEL = { current: 'current', behind: 'behind', unpinned: 'unpinned', unreleased: 'unreleased SHA' };

export function render(results, latest) {
  const out = [`# Shared workflow usage (latest ${latest ?? 'none'})`, ''];
  out.push('| Repo | Caller | Shared workflow | Release | Status |', '| --- | --- | --- | --- | --- |');
  for (const r of results) {
    for (const c of r.calls) {
      const status = c.status === 'behind' ? `behind by ${c.behind}` : LABEL[c.status];
      out.push(`| ${r.repo} | ${c.file} | ${c.workflow} | ${c.release ?? c.ref.slice(0, 7)} | ${status} |`);
    }
  }
  const copies = results.flatMap((r) => r.copies.map((f) => `- ${r.repo}: \`${f}\``));
  const none = results.filter((r) => r.calls.length === 0).map((r) => r.repo);
  if (copies.length) out.push('', '## Possible copies (same name as a shared workflow, never calls it)', '', ...copies);
  if (none.length) out.push('', '## Repos calling no shared workflow', '', none.join(', '));
  const unread = results.filter((r) => r.error).map((r) => `- ${r.repo}: ${r.error}`);
  if (unread.length) out.push('', '## Not read', '', ...unread);
  return out.join('\n') + '\n';
}

export function needsAttention(results) {
  return results.some((r) => r.error || r.copies.length || r.calls.some((c) => c.status !== 'current'));
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function readRepo(full) {
  let names;
  try {
    names = JSON.parse(gh('api', `repos/${full}/contents/.github/workflows`, '--jq', '[.[] | select(.type == "file") | .name]'));
  } catch (e) {
    // No .github/workflows directory is an answer, not a failure.
    if (/HTTP 404/.test(String(e.stderr))) return {};
    throw e;
  }
  const files = {};
  for (const name of names.filter((n) => /\.ya?ml$/.test(n))) {
    const b64 = gh('api', `repos/${full}/contents/.github/workflows/${name}`, '--jq', '.content');
    files[name] = Buffer.from(b64, 'base64').toString('utf8');
  }
  return files;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const owners = argv.filter((a, i) => argv[i - 1] === '--owner');
  const strict = argv.includes('--strict');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('fetch', '-q', '--tags', '--force', 'origin');
  // show-ref -d lists an annotated tag twice (tag object, then its commit as tag^{}); keep the commit.
  const peeled = new Map();
  for (const line of git('show-ref', '--tags', '-d').split('\n').filter(Boolean)) {
    const [sha, ref] = line.split(' ');
    const tag = ref.replace('refs/tags/', '');
    if (tag.endsWith('^{}')) peeled.set(tag.slice(0, -3), sha);
    else if (!peeled.has(tag)) peeled.set(tag, sha);
  }
  const releases = sortReleases([...peeled].map(([tag, sha]) => ({ tag, sha })));
  const shared = readdirSync(path.join(root, '.github/workflows')).filter((f) =>
    readFileSync(path.join(root, '.github/workflows', f), 'utf8').includes('workflow_call'),
  );
  const results = [];
  for (const owner of owners.length ? owners : DEFAULT_OWNERS) {
    const repos = JSON.parse(gh('repo', 'list', owner, '--limit', '200', '--no-archived', '--source', '--json', 'nameWithOwner', '--jq', '[.[].nameWithOwner]'));
    for (const full of repos.sort()) {
      if (full === REPO) continue;
      try {
        results.push({ repo: full, ...auditRepo(readRepo(full), shared, releases) });
      } catch (e) {
        results.push({ repo: full, calls: [], copies: [], error: String(e.stderr || e.message).split('\n')[0] });
      }
    }
  }
  process.stdout.write(render(results, releases[0]?.tag));
  if (strict && needsAttention(results)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
