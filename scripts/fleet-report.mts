// Reports which repos call which shared workflows, at which release, and where a local copy stands in for one.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'nothingfortune/workflows';
const DEFAULT_OWNERS = ['nothingfortune', 'hestiamediagroup'];
// Anchored to a line start so a commented-out `# uses:` is not a call.
const USES = new RegExp(`^[ \\t]*(?:-[ \\t]+)?uses:[ \\t]*['"]?${REPO}/\\.github/workflows/([\\w.-]+\\.ya?ml)@([\\w.-]+)`, 'gm');

export type Release = { tag: string; sha: string };
export type Status = 'current' | 'behind' | 'unpinned' | 'unreleased';
export type Classified = { status: Status; release: string | null; behind: number | null };
export type Call = { workflow: string; ref: string };
export type FoundCall = Call & Classified & { file: string };
export type RepoResult = { repo: string; calls: FoundCall[]; copies: string[]; error?: string };

// Every `uses:` of a shared workflow in one caller file.
export function parseCalls(text: string): Call[] {
  return [...text.matchAll(USES)].map((m) => ({ workflow: m[1] ?? '', ref: m[2] ?? '' }));
}

// `git ls-remote --tags` output → [{ tag, sha }], each annotated tag peeled to its commit.
export function parseRemoteTags(out: string): Release[] {
  const peeled = new Map<string, string>();
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha = '', ref = ''] = line.split('\t');
    const tag = ref.replace('refs/tags/', '');
    if (tag.endsWith('^{}')) peeled.set(tag.slice(0, -3), sha);
    else if (!peeled.has(tag)) peeled.set(tag, sha);
  }
  return [...peeled].map(([tag, sha]) => ({ tag, sha }));
}

// tags: [{ tag, sha }] for vX.Y.Z only; newest first.
export function sortReleases(tags: Release[]): Release[] {
  const key = (t: Release): number[] => t.tag.slice(1).split('.').map(Number);
  return tags
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t.tag))
    .sort((a, b) => {
      const [x = [], y = []] = [key(a), key(b)];
      return (y[0] ?? 0) - (x[0] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0) || (y[2] ?? 0) - (x[2] ?? 0);
    });
}

export function classifyRef(ref: string, releases: Release[]): Classified {
  if (!/^[0-9a-f]{40}$/.test(ref)) return { status: 'unpinned', release: ref, behind: null };
  const i = releases.findIndex((r) => r.sha === ref);
  if (i < 0) return { status: 'unreleased', release: null, behind: null };
  return { status: i === 0 ? 'current' : 'behind', release: releases[i]?.tag ?? null, behind: i };
}

// files: { name: text } for one repo's .github/workflows; shared: callable workflow filenames here.
export function auditRepo(files: Record<string, string>, shared: string[], releases: Release[]): Pick<RepoResult, 'calls' | 'copies'> {
  const calls: FoundCall[] = [];
  const copies: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    const found = parseCalls(text);
    for (const c of found) calls.push({ file: name, ...c, ...classifyRef(c.ref, releases) });
    if (shared.includes(name) && !found.some((c) => c.workflow === name)) copies.push(name);
  }
  return { calls, copies };
}

const LABEL: Record<Status, string> = { current: 'current', behind: 'behind', unpinned: 'unpinned', unreleased: 'unreleased SHA' };

export function render(results: RepoResult[], latest: string | undefined): string {
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

export function needsAttention(results: RepoResult[]): boolean {
  return results.some((r) => r.error || r.copies.length || r.calls.some((c) => c.status !== 'current'));
}

// execFileSync errors carry the child's stderr; anything else has none.
function stderrOf(e: unknown): unknown {
  return typeof e === 'object' && e !== null && 'stderr' in e ? e.stderr : undefined;
}

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function readRepo(full: string): Record<string, string> {
  let names: string[];
  try {
    names = JSON.parse(gh('api', `repos/${full}/contents/.github/workflows`, '--jq', '[.[] | select(.type == "file") | .name]')) as string[];
  } catch (e) {
    // No .github/workflows directory is an answer, not a failure.
    if (/HTTP 404/.test(String(stderrOf(e)))) return {};
    throw e;
  }
  const files: Record<string, string> = {};
  for (const name of names.filter((n) => /\.ya?ml$/.test(n))) {
    const b64 = gh('api', `repos/${full}/contents/.github/workflows/${name}`, '--jq', '.content');
    files[name] = Buffer.from(b64, 'base64').toString('utf8');
  }
  return files;
}

function main(argv: string[]): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const owners = argv.filter((a, i) => argv[i - 1] === '--owner');
  const strict = argv.includes('--strict');
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  // Releases come from the remote, so a tag that exists only in this checkout cannot pose as one.
  const releases = sortReleases(parseRemoteTags(git('ls-remote', '--tags', 'origin')));
  const shared = readdirSync(path.join(root, '.github/workflows')).filter((f) =>
    readFileSync(path.join(root, '.github/workflows', f), 'utf8').includes('workflow_call'),
  );
  const results: RepoResult[] = [];
  for (const owner of owners.length ? owners : DEFAULT_OWNERS) {
    const repos = JSON.parse(gh('repo', 'list', owner, '--limit', '200', '--no-archived', '--source', '--json', 'nameWithOwner', '--jq', '[.[].nameWithOwner]')) as string[];
    for (const full of repos.sort()) {
      if (full === REPO) continue;
      try {
        results.push({ repo: full, ...auditRepo(readRepo(full), shared, releases) });
      } catch (e) {
        results.push({ repo: full, calls: [], copies: [], error: String(stderrOf(e) || (e instanceof Error ? e.message : e)).split('\n')[0] ?? '' });
      }
    }
  }
  process.stdout.write(render(results, releases[0]?.tag));
  if (strict && needsAttention(results)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
