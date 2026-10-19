# Fleet Standards I0–I1: Integrity Engine Package and Reference Integrity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the integrity engine as a pinned package from this repo, covering spec phases I0 and I1. It wraps knip's two passes and adds the REF-003 reference check, normalized findings with fingerprints, observe and enforce modes, exit codes 0/1/2, and reports. Then base adopts it in place of its bare `knip` script.

**Architecture:**
- The engine is plain ESM (`.mjs`) under `engine/`, typed with JSDoc and checked by `tsc --checkJs`. The repo's root `package.json` publishes it to consumers as a git dependency (`github:nothingfortune/workflows#<sha>`) with an `integrity` bin.
- At runtime it runs the *consumer's* knip twice (default, then `--production`), maps every knip issue type to a spec rule, adds REF-003 findings, applies the mode and writes text, a step summary, annotations and `build/integrity/report.json`.
- `release.yml` starts releasing on engine changes, so workflow pins and the engine pin share one version stream.

**Tech Stack:** Node ≥ 22, ESM, `node:test`, knip ≥ 6 (a peer dependency), TypeScript (dev only, for `--checkJs`).

**Spec:** `docs/specs/2026-10-18-fleet-standards-design.md` (approved 2026-10-18). Requirements: `docs/specs/2026-10-18-code-integrity-requirements.md`.

**Later plans, not this one:** F1 fleet profiles, I2 baseline and suppressions plus dollyVision, A adoption, I3 graph, F2/F3 fleet facts and the weekly run, I4 boundaries and SARIF. Each gets its own plan when reached.

**Deviation from spec §5.1, for the user to confirm:**
- §5.1 says committed `dist/` built by `tsc`. That rule came from feature-map's TypeScript source, which Node will not strip under `node_modules`.
- This plan writes the engine as `.mjs` with JSDoc types instead. There is then no build step, no `dist/` and no drift check, and it matches this repo's existing zero-dependency `.mjs` scripts.
- `tsc --checkJs` still type-checks it in CI. If the user wants `.mts` source, add a build task and a `dist/` drift check to Task 1.

## Global Constraints

- Node ≥ 22. The engine's only runtime dependency is the consumer's knip, declared as `peerDependencies: { "knip": ">=6 <7" }`. No other runtime dependencies.
- Source files stay under 400 lines and functions under 150 (base's monolith limits).
- Comments are one line stating WHY; extended rationale goes in docs (user's global rule).
- Exit codes:
  - `0`: pass, or observe mode.
  - `1`: blocking findings.
  - `2`: analysis failure, invalid config, or an unknown knip issue type.
- **The engine never executes analyzed code.** It only spawns the consumer's knip and reads files.
- CI stays `contents: read`. Every action is SHA-pinned (`scripts/audit-workflows.mjs` INV-2).
- **Fingerprint:** `sha256(ruleId | normalizedPath | symbol | expression)`, hex.
  - The normalized path is POSIX and repo-relative.
  - There are no line numbers in it.
  - A cycle's identity is its member paths, rotated so the lexicographically smallest comes first.
- Rules in scope. Severities come from spec §6.1; confidence is reported but never decides blocking:

  | Rule | Classification | Severity | Confidence |
  | --- | --- | --- | --- |
  | REF-001 | `broken-reference` | error | high |
  | REF-002 | `unlisted-dependency` | error | high |
  | REF-003 | `broken-reference` | error | medium |
  | DEAD-001 | `orphaned-file` | warning | high |
  | DEAD-002 | `unused-export` | warning | high |
  | DEAD-003 | `unused-dependency` | warning | high |
  | DEAD-004 | `disconnected-file` | warning | high |
  | CYC-001 | `circular-dependency` | warning | high |

- **Enforcement:** in `enforce` mode, `error` and `warning` block and `info` never does. In `observe` mode nothing blocks, but exit 2 conditions still exit 2.
- Commit types follow `README.md` → Releases: `feat`/`fix` on releasable paths release; `test`/`docs`/`ci`/`chore` do not.

## Review Focus

1. **knip missing, the wrong major, a crash, or JSON that won't parse.** The run must exit 2 with a message naming the cause, never 0 and never a partial report marked pass. Pinned in Task 3.
2. **Script strings that look like paths but aren't.** `node -e "…"`, `bash -c '…'`, `$VAR/x.sh`, globs, URLs, `npm run x` and flags must produce no REF-003. Pinned in Task 4.
3. **Windows paths in knip output** (`src\a.ts`). They must give the same fingerprint as `src/a.ts`. Pinned in Task 2.
4. **The same finding from both knip passes appears once.** A file unused only in production is DEAD-004, not DEAD-001 plus DEAD-004. Pinned in Task 3.
5. **Running outside GitHub Actions.** No `::` annotation lines, no write to an unset `$GITHUB_STEP_SUMMARY`, and `build/integrity/` is created when missing. Pinned in Task 6.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `package.json` (create, root) | Package name `@nothingfortune/workflows`, `bin`, `files`, `peerDependencies`, `devDependencies` (knip, typescript), `engines`. |
| `package-lock.json` (create) | Lockfile for the dev dependencies only. |
| `engine/bin/integrity.mjs` | CLI: parses `check [--root <dir>]`, calls `run()`, sets `process.exitCode`. |
| `engine/src/rules.mjs` | The rules table above. |
| `engine/src/finding.mjs` | `makeFinding`, `fingerprint`, `normalizePath`. |
| `engine/src/knip.mjs` | Runs the consumer's knip and maps its JSON to findings; merges the two passes. |
| `engine/src/references.mjs` | REF-003 over `package.json` scripts, `knip.json` entries and workflow files. |
| `engine/src/config.mjs` | Loads and validates `integrity.json`. |
| `engine/src/version.mjs` | Engine version from the consumer's lockfile; knip version. |
| `engine/src/policy.mjs` | Mode → blocking set, result, exit code. |
| `engine/src/render.mjs` | Text, summary markdown, annotations, `report.json` object. |
| `engine/src/run.mjs` | Orchestration. |
| `engine/test/*.test.mjs` | One suite per module, plus `run.test.mjs` end to end. |
| `engine/test/fixtures/<name>/` | Fixture projects (a `package.json`, `knip.json`, `src/`, optionally `.github/workflows/`). |
| `engine/tsconfig.json` | `checkJs` config for `engine/`. |
| `scripts/next-version.mjs`, `scripts/next-version.test.mjs` (modify) | Engine paths become releasable. |
| `.github/workflows/lint.yml` (modify) | An `engine` job. |
| `.github/dependabot.yml` (modify) | An npm ecosystem with the `chore(deps)` prefix. |
| `README.md` (modify) | "Integrity engine" section and the release rule. |

---

### Task 1: Package scaffold and release rules

**Files:**
- Create: `package.json`, `package-lock.json`, `engine/bin/integrity.mjs`, `engine/tsconfig.json`
- Modify: `scripts/next-version.mjs`, `scripts/next-version.test.mjs`, `.github/workflows/lint.yml`, `.github/dependabot.yml`, `README.md`

**Interfaces:**
- Produces:
  - bin `integrity` → `engine/bin/integrity.mjs`;
  - in `scripts/next-version.mjs`, `export function isReleasablePath(file: string, callableAt: (file) => boolean): boolean`.

- [ ] **Step 1: Write the failing tests** in `scripts/next-version.test.mjs`:

```js
test('engine source and the root package.json are releasable; engine tests and the lockfile are not', () => {
  const never = () => false;
  assert.equal(isReleasablePath('engine/src/knip.mjs', never), true);
  assert.equal(isReleasablePath('engine/bin/integrity.mjs', never), true);
  assert.equal(isReleasablePath('package.json', never), true);
  assert.equal(isReleasablePath('engine/test/knip.test.mjs', never), false);
  assert.equal(isReleasablePath('package-lock.json', never), false);
  assert.equal(isReleasablePath('.github/workflows/ci.yml', () => true), true);
  assert.equal(isReleasablePath('.github/workflows/lint.yml', never), false);
});
```

Also add a git-integration test in the existing `repo()` style: a `feat: engine` commit touching only `engine/src/x.mjs` after `v1.0.0` prints `v1.1.0`.

- [ ] **Step 2: Run** `node --test scripts/next-version.test.mjs`. Expected: FAIL, because `isReleasablePath` is not exported.

- [ ] **Step 3: Implement `isReleasablePath`** in `scripts/next-version.mjs`.
  - Releasable: an `engine/` path that is not under `engine/test/`; `package.json` exactly; or the existing workflow-path test combined with `callableAt`.
  - `main()`'s `isCallable` becomes `(file) => isReleasablePath(file, (f) => callableAt(lastTag, f) || callableAt('HEAD', f))`.
  - Update the file's header comment and README → Releases ("A release is due only when a commit touches a callable workflow, the engine (`engine/`, except its tests) or the root `package.json`").

- [ ] **Step 4: Create the package.**
  - Root `package.json`:
    ```json
    {
      "name": "@nothingfortune/workflows",
      "private": true,
      "type": "module",
      "engines": { "node": ">=22" },
      "bin": { "integrity": "engine/bin/integrity.mjs" },
      "files": ["engine/bin", "engine/src"],
      "peerDependencies": { "knip": ">=6 <7" },
      "devDependencies": { "knip": "6.41.0", "typescript": "6.0.3" }
    }
    ```
  - Run `npm install` to create `package-lock.json`.
  - `engine/bin/integrity.mjs`: a `#!/usr/bin/env node` stub that prints `integrity: not implemented` and sets exit code 2. Make it executable (`chmod +x`, committed mode 100755).
  - `engine/tsconfig.json`: `allowJs`, `checkJs`, `noEmit`, `strict`, `module`/`moduleResolution` `nodenext`, `types: ["node"]`, `include: ["bin", "src"]`. Add `@types/node` to devDependencies.

- [ ] **Step 5: CI and Dependabot.**
  - `lint.yml` gains an `engine` job: `timeout-minutes: 10`; SHA-pinned `actions/checkout` and `actions/setup-node` with `node-version: '24'` and `cache: npm`; then `npm ci`, `npx tsc -p engine`, `node --test engine/test/`.
  - `dependabot.yml` gains an `npm` ecosystem on the same Monday schedule:
    - one `npm-minor-and-patch` group;
    - commit prefix `chore(deps)`, with a one-line comment saying dev-tool bumps must not cut a release.

- [ ] **Step 6: Verify.**
  - `node --test scripts/next-version.test.mjs`: all pass.
  - `node scripts/audit-workflows.mjs .github/workflows`: OK.
  - actionlint 1.7.7: clean.
  - `npx tsc -p engine`: exit 0.
  - `node --test engine/test/` exits 0. It has no tests yet, so add an `engine/test/smoke.test.mjs` that asserts the bin exits 2.

- [ ] **Step 7: Commit.**
  - `ci(engine): package scaffold, engine job and npm Dependabot`.
  - `feat(release): engine source and package.json are releasable`. This commit releases, which is fine: the stub ships as an unused bin.

---

### Task 2: Rules table and findings

**Files:**
- Create: `engine/src/rules.mjs`, `engine/src/finding.mjs`
- Test: `engine/test/finding.test.mjs`

**Interfaces:**
- Produces:
  - `export const RULES: Record<RuleId, { classification, severity: 'error'|'warning'|'info', confidence: 'high'|'medium'|'low' }>`, the table in Global Constraints.
  - `export function normalizePath(p: string): string`. Turns `\` into `/`, drops a leading `./`, and throws on an absolute path or `..`.
  - `export function fingerprint(ruleId, file, symbol = '', expression = ''): string`.
  - `export function makeFinding({ ruleId, file, line?, column?, symbol?, message, evidence: string[], remediation?, analyzer, expression? }): Finding`. A `Finding` carries every field the requirements' §7 lists, plus `fingerprint`, `severity`, `confidence` and `classification` filled from `RULES`. An unknown `ruleId` throws.
  - `export function cycleSymbol(paths: string[]): string`. Normalizes, rotates so the smallest path comes first, and joins with ` -> `.

- [ ] **Step 1: Write the failing tests:**
  - `'the same finding on Windows and POSIX paths has one fingerprint'`: `fingerprint('DEAD-001', 'src\\a.ts')` equals `fingerprint('DEAD-001', 'src/a.ts')`, and equals `fingerprint('DEAD-001', './src/a.ts')`.
  - `'line numbers never reach the fingerprint'`: two `makeFinding` calls differing only in `line` (3 vs 30) have equal `fingerprint`.
  - `'rule, symbol and path each change the fingerprint'`: three pairwise-unequal assertions.
  - `'a cycle fingerprint is stable under rotation'`: `cycleSymbol(['b.ts','c.ts','a.ts'])` equals `cycleSymbol(['a.ts','b.ts','c.ts'])` and equals `'a.ts -> b.ts -> c.ts'`.
  - `'makeFinding fills severity, confidence and classification from the rule'`: `makeFinding({ ruleId: 'REF-003', … })` has `severity: 'error'`, `confidence: 'medium'` and `classification: 'broken-reference'`.
  - `'an unknown rule or a path escaping the repo throws'`: `assert.throws(() => makeFinding({ ruleId: 'NOPE-1', … }), /unknown rule NOPE-1/)` and `assert.throws(() => normalizePath('../x'), /outside the repo/)`.

- [ ] **Step 2: Run** `node --test engine/test/finding.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** using `node:crypto` `createHash('sha256')` over the four parts joined with `\0`.
- [ ] **Step 4: Run again.** Expected: PASS. Then `npx tsc -p engine`: exit 0.
- [ ] **Step 5: Commit** `feat(engine): rules table, findings and identity fingerprints`.

---

### Task 3: knip adapter (both passes)

**Files:**
- Create: `engine/src/knip.mjs`, `engine/test/fixtures/knip-defects/` (`package.json`, `knip.json`, `tsconfig.json`, `src/`, `tests/`), `engine/test/fixtures/knip-clean/`
- Test: `engine/test/knip.test.mjs`

**Interfaces:**
- Consumes: `makeFinding`, `cycleSymbol` (Task 2).
- Produces:
  - `export class AnalysisError extends Error {}`. Every "exit 2" cause throws this.
  - `export function resolveKnip(root: string): { bin: string, version: string }`. Uses `createRequire(path.join(root, 'package.json'))`. Throws `AnalysisError('knip is not installed in <root>')` when missing, or `AnalysisError('knip <v> is not supported; need >=6 <7')` for the wrong major.
  - `export function runKnip(root, { production: boolean }): object`. Spawns `process.execPath <bin> --reporter json --no-progress [--production]` with `cwd: root`. Exit 0 or 1 parses stdout as JSON. Any other exit code, or unparseable stdout, throws `AnalysisError` carrying the first stderr line.
  - `export function mapKnip(json, pass: 'default'|'production'): Finding[]`.
  - `export function mergePasses(defaultFindings, productionFindings): Finding[]`.

**Type → rule map.** This is the spec decision the builder cannot infer:

| knip type | Rule |
| --- | --- |
| `files` | DEAD-001 |
| `dependencies`, `devDependencies`, `catalog` | DEAD-003 |
| `unlisted`, `binaries`, `optionalPeerDependencies`, `catalogReferences` | REF-002 |
| `unresolved` | REF-001 |
| `exports`, `nsExports`, `types`, `nsTypes`, `enumMembers`, `namespaceMembers`, `duplicates` | DEAD-002 |
| `cycles` | CYC-001; `symbol` = `cycleSymbol(member names)` |

- An issue key outside this table (and outside `file` and `owners`) throws `AnalysisError('unknown knip issue type <t>')`.
- `symbol` is the issue's `name`, or `specifier` for unresolved imports; `line`/`column` come from `line`/`col`.
- `evidence` names the pass and the knip type, for example `['knip default pass: exports']`.

**Merge rule:**
- Union by fingerprint.
- A production-pass DEAD-001 or DEAD-002 whose fingerprint is absent from the default pass becomes DEAD-004. Its symbol is kept, and its evidence says `reachable only from tests`.
- Production-pass findings of any other rule that the default pass also reports are dropped as duplicates.

**Fixture `knip-defects`:**
- `src/index.ts` (entry `!`) imports `./used.ts` and `./missing.ts`. The missing import gives REF-001.
- `src/used.ts` exports `used` (consumed) and `unused` (DEAD-002).
- `src/orphan.ts` is imported by nothing (DEAD-001).
- `src/test-only.ts` is imported only by `tests/x.test.ts` (DEAD-004).
- `src/index.ts` also imports `left-pad`, which is not in `package.json` (REF-002).
- `package.json` lists the unused dependency `is-odd` (DEAD-003).
- `knip.json`: `{"entry":["src/index.ts!"],"project":["src/**/*.ts!","tests/**/*.ts"]}`.

The fixture is analyzed with the knip from this repo's `node_modules`. `resolveKnip` walks up from the fixture, so tests use it unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `'every planted defect yields exactly one finding'`: from `mergePasses(mapKnip(runKnip(fx,{production:false}),'default'), mapKnip(runKnip(fx,{production:true}),'production'))`, the multiset of `[ruleId, file, symbol]` equals exactly:
    - `REF-001 src/index.ts ./missing.ts`
    - `REF-002 src/index.ts left-pad`
    - `DEAD-001 src/orphan.ts`
    - `DEAD-002 src/used.ts unused`
    - `DEAD-003 package.json is-odd`
    - `DEAD-004 src/test-only.ts`
  - `'a clean project yields no findings'`, over `knip-clean`.
  - `'an unrelated edit above a finding keeps its fingerprint'`: copy the fixture to a temp dir and record the DEAD-002 fingerprint, then prepend two blank lines and a comment to `src/used.ts`, re-run, and assert the fingerprint is equal while `line` differs.
  - `'an unknown knip issue type is an analysis failure'`: `assert.throws(() => mapKnip({ issues: [{ file: 'a.ts', brandNew: [{}] }] }, 'default'), /unknown knip issue type brandNew/)`.
  - `'knip missing, a crash and bad JSON are analysis failures'`:
    - `resolveKnip` on a temp dir with no `node_modules` throws `/knip is not installed/`;
    - a `knip.json` containing `{` makes `runKnip` throw `AnalysisError`, because knip exits 2 on a config load error.
  - `'cycles map to CYC-001 with a rotation-stable symbol'`: `mapKnip` over a hand-written knip JSON row with `cycles: [[{name:'src/b.ts'},{name:'src/a.ts'}]]` yields one CYC-001 with `symbol: 'src/a.ts -> src/b.ts'`.
- [ ] **Step 2: Run** `node --test engine/test/knip.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions and `AnalysisError`.
- [ ] **Step 4: Run again.** Expected: PASS. Then run `npx tsc -p engine`.
- [ ] **Step 5: Commit** `feat(engine): knip adapter maps both passes to findings`.

---

### Task 4: Reference check (REF-003)

**Files:**
- Create: `engine/src/references.mjs`, `engine/test/fixtures/refs/` (`package.json`, `knip.json`, `.github/workflows/ci.yml`, `scripts/real.mjs`, `bin/real.sh`, `.github/actions/local/action.yml`)
- Test: `engine/test/references.test.mjs`

**Interfaces:**
- Consumes: `makeFinding` (Task 2).
- Produces:
  - `export function scriptPaths(command: string): string[]`;
  - `export function workflowPaths(text: string): { path: string, line: number }[]`;
  - `export function checkReferences(root: string): Finding[]`.

**What counts as a path** (the builder can't infer these):
- **In a script command:** split on whitespace and on `&&`, `||`, `;`, `|`. A token is a path when it matches `^(?:\.\/)?(?:[\w@.-]+\/)*[\w@.-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|bash|py)$`. It is skipped when it:
  - starts with `-`;
  - contains `$`, `*`, `?`, `{` or `://`;
  - is the argument of `-e`, `-c`, `--eval` or `--print`;
  - is inside quotes, so skip quoted spans entirely.
- **In a workflow file**, on non-comment lines:
  - `uses: ./<p>` must name an existing directory containing `action.yml` or `action.yaml`;
  - a token following `bash`, `sh`, `node` or `python`/`python3` (after any flags) that matches the path pattern above.
- **In `knip.json`:** `entry` and `project` strings with no glob characters (after stripping a trailing `!`) must exist. Skip when there is no `knip.json`; skip `knip.config.*`.
- **Findings:** each missing path is one REF-003. `file` is the referencing file (`package.json`, the workflow or `knip.json`), `symbol` is the missing path, and `line` is where it was found. `evidence` names the source: `package.json scripts.<name>`, `workflow run:`, `workflow uses:` or `knip.json entry`.

- [ ] **Step 1: Write the failing tests:**
  - `'a script naming a missing file is REF-003; real files and npm run are not'`: `scriptPaths('node scripts/real.mjs && bash bin/gone.sh && npm run x')` deep-equals `['scripts/real.mjs', 'bin/gone.sh']`. Over the `refs` fixture, `checkReferences` reports exactly one script finding, `symbol: 'bin/gone.sh'`.
  - `'flags, evals, variables, globs, URLs and quoted spans are not paths'`: each of these gives `[]`:
    - `node -e "require('./x.js')"`
    - `bash -c 'scripts/a.sh'`
    - `bash $DIR/x.sh`
    - `node scripts/*.mjs`
    - `curl https://e.com/a.js`
    - `eslint --config ./eslint.config.js .`

    The last one has a flag argument that is a real path; it is still a path when it exists, so assert `scriptPaths('eslint --config ./eslint.config.js .')` deep-equals `['./eslint.config.js']` and the fixture creates it.
  - `'a workflow run line and a local action are checked; comments are not'`: the fixture `ci.yml` has:
    - `run: bash .github/scripts/gone.sh` (finding, line 9);
    - `run: node scripts/real.mjs` (no finding);
    - `uses: ./.github/actions/local` (exists);
    - `uses: ./.github/actions/missing` (finding);
    - `# run: bash nope.sh` (ignored).

    Assert exactly two findings with those symbols and lines.
  - `'a non-glob knip entry that does not exist is REF-003; globs are not checked'`: the fixture `knip.json` `entry` is `["src/gone.ts!", "scripts/*.mjs"]`. Assert one finding, `symbol: 'src/gone.ts'`.
  - `'a project with no scripts, no workflows and no knip.json has no findings'`: an empty temp dir with `{}` as `package.json` gives `[]`.
- [ ] **Step 2: Run** `node --test engine/test/references.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS. Then run `npx tsc -p engine`.
- [ ] **Step 5: Commit** `feat(engine): REF-003 checks script, workflow and knip entry paths`.

---

### Task 5: Config, versions and policy

**Files:**
- Create: `engine/src/config.mjs`, `engine/src/version.mjs`, `engine/src/policy.mjs`
- Test: `engine/test/config.test.mjs`, `engine/test/policy.test.mjs`

**Interfaces:**
- Consumes: `AnalysisError` (Task 3), `RULES` (Task 2).
- Produces:
  - `export function loadConfig(root): { mode: 'enforce'|'observe' }`.
    - A missing `integrity.json` gives `{ mode: 'enforce' }`.
    - Invalid JSON, an unknown key, or a `mode` outside the two values throws `AnalysisError('integrity.json: <reason>')`. In I1 the only allowed keys are `$schema` and `mode`; later plans add keys.
  - `export function engineVersion(root): string`. It reads the consumer's `package-lock.json` → `packages["node_modules/@nothingfortune/workflows"].resolved` and returns the 40-hex SHA after `#`. It returns `'unknown'` when absent, and `'dev'` when `root` is this repo.
  - `export function evaluate(findings, mode): { blocking: Finding[], result: 'pass'|'fail', exitCode: 0|1 }`.

- [ ] **Step 1: Write the failing tests:**
  - `'no integrity.json means enforce'`.
  - `'bad JSON, an unknown key and a bad mode are analysis failures'`: three `assert.throws(…, /integrity\.json: /)`.
  - `'enforce blocks errors and warnings but never info'`: with one REF-001, one DEAD-002 and a hand-made `info` finding, `blocking` holds the first two and `exitCode` is 1.
  - `'observe never blocks'`: the same set in `observe` gives `exitCode: 0` and `result: 'pass'`.
  - `'engine version comes from the consumer lockfile'`: a temp lockfile with `resolved: "git+ssh://git@github.com/nothingfortune/workflows.git#" + 'a'.repeat(40)` gives `'a'.repeat(40)`; with no lockfile it gives `'unknown'`.
- [ ] **Step 2: Run** both suites. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS. Then run `npx tsc -p engine`.
- [ ] **Step 5: Commit** `feat(engine): integrity.json modes, engine version and enforcement policy`.

---

### Task 6: Renderers, `run()` and the CLI

**Files:**
- Create: `engine/src/render.mjs`, `engine/src/run.mjs`
- Modify: `engine/bin/integrity.mjs` (replace the stub), `engine/test/smoke.test.mjs` (delete; superseded)
- Test: `engine/test/render.test.mjs`, `engine/test/run.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `export function renderText(report): string`. Findings are grouped by rule (`REF-001 src/index.ts:1 ./missing.ts — <message>`), then a summary block in the requirements' §10 shape: counts per rule, `Blocking: N`, `Result: PASS|FAIL`, `Duration: Xs`.
  - `export function renderSummary(report): string`. Markdown with the same counts as a table, plus a findings table listing up to 50 rows and then `…and N more`.
  - `export function renderAnnotations(report): string[]`. One `::error|::warning|::notice file=<f>,line=<l>,title=<ruleId>::<message>` per finding, by severity (error → error, warning → warning, info → notice). `line` is omitted when absent.
  - `export function run({ root, env }): { exitCode: 0|1|2, report?: Report, text: string }`.
  - `Report` = `{ schemaVersion: 1, engine: { version }, analyzers: { knip: string }, mode, durationMs, counts: Record<RuleId, number>, findings: Finding[], blocking: string[] (fingerprints), result }`.

**`run()` behavior:**
- `loadConfig`, then `resolveKnip`, both knip passes, `mergePasses`, `checkReferences`, `evaluate`.
- Write `build/integrity/report.json`, creating the directory.
- If `env.GITHUB_STEP_SUMMARY` is set, append `renderSummary`. If `env.GITHUB_ACTIONS === 'true'`, append the annotations to `text`.
- An `AnalysisError` anywhere gives `exitCode: 2`, no report file, and `text` = `integrity: analysis failed: <message>`. Any other error is rethrown, so the CLI's uncaught handler prints the stack and exits 2.
- The CLI's only command is `check`, with optional `--root <dir>` (default `process.cwd()`). Any other argument prints usage and exits 2.

- [ ] **Step 1: Write the failing tests:**
  - `'run on the defect fixture fails with exit 1 and writes a report'`: copy `knip-defects` to a temp dir, then `run({ root, env: {} })`.
    - `exitCode` is 1 and `report.result` is `'fail'`.
    - `build/integrity/report.json` parses and has every `Report` key with the right types: `schemaVersion === 1`, `Array.isArray(findings)`, and `typeof durationMs === 'number'`.
    - `counts['DEAD-004'] === 1`.
  - `'run on the clean fixture passes with exit 0'`.
  - `'observe mode exits 0 but still reports'`: write `{"mode":"observe"}` and assert exit 0 with `findings.length === 6`.
  - `'an analysis failure exits 2 and writes no report'`: a broken `knip.json` gives `exitCode: 2`, `text` matching `/analysis failed/`, and no `build/integrity/report.json`.
  - `'outside Actions there are no annotations and no summary write'`: with `env: {}`, `text` has no `/^::/m` and nothing writes a summary. With `env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: tmpFile }`, `text` has 6 lines matching `/^::(error|warning) file=/m`, and `tmpFile` contains `| DEAD-004 | 1 |`.
  - `'the CLI maps run() to process exit codes'`: spawn `engine/bin/integrity.mjs check --root <defects copy>` and assert exit 1; on the clean fixture, exit 0; with `bogus`, exit 2 and stderr matching `/usage: integrity check/`.
  - Render unit tests: `renderAnnotations` on a finding with no `line` emits no `line=`; `renderSummary` with 60 findings ends its table with `…and 10 more`.
- [ ] **Step 2: Run** `node --test engine/test/`. Expected: the new suites FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test engine/test/` (all pass), `npx tsc -p engine` (exit 0), then the whole engine against this repo's fixtures by hand: `node engine/bin/integrity.mjs check --root engine/test/fixtures/knip-defects` prints six findings and exits 1.
- [ ] **Step 5: Commit** `feat(engine): reports, run() and the integrity CLI`.

---

### Task 7: Document, review and release

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README "Integrity engine" section**, placed after "Fleet report":
  - **What it checks:** the rules table.
  - **Exit codes.**
  - **Adoption:** add `"@nothingfortune/workflows": "github:nothingfortune/workflows#<sha>"` to devDependencies, add `"integrity": "integrity check"` to scripts, and put `npm run integrity` in `check` in place of `knip`. Keep `knip.json` and mark production entries with `!`.
  - **Optional `integrity.json`** with `mode`.
  - **That Dependabot bumps it** (to be confirmed in Task 9).
- [ ] **Step 2: Run every check:**
  - `node --test scripts/*.test.mjs engine/test/`;
  - `npx tsc -p engine`;
  - `node scripts/audit-selftest.mjs`;
  - `node scripts/audit-workflows.mjs .github/workflows`;
  - actionlint 1.7.7.

  Then `node scripts/next-version.mjs` prints a minor release (`v1.3.0` if nothing else released first).
- [ ] **Step 3:** Open the PR, address review threads (Codex) and merge with a merge commit after the user approves. Confirm the release run published the tag and moved `v1`.
- [ ] **Step 4: Commit** `docs(engine): adoption and rules in the README`, before Step 3's PR.

---

### Task 8: base adopts the engine

**Repo:** `nothingfortune/base`, on a new branch.

**Files (base):** `package.json`, `package-lock.json`, `.github/dependabot.yml`, `.gitignore`, `CLAUDE.md`, `docs/guides/quality-gates.md`

- [ ] **Step 1:** Run `npm install -D github:nothingfortune/workflows#<release sha>`, with the SHA from Task 7's release tag. Confirm `package-lock.json` records `resolved` with `#<sha>`.
- [ ] **Step 2: Scripts.** Add `"integrity": "integrity check"`, replace `npm run knip` with `npm run integrity` in `check`, and remove the `knip` script. Ensure `build/` is in `.gitignore`.
- [ ] **Step 3: Dependabot.** In the npm ecosystem of `.github/dependabot.yml`, add a `nothingfortune-workflows` group with `patterns: ['@nothingfortune/workflows']`, so a release arrives as one npm PR.
- [ ] **Step 4: Docs.**
  - `quality-gates.md` → rename "Dead code (knip)" to "Code integrity". Cover what it enforces (the rules), the two passes, exit 2 meaning analysis failure, `report.json`, and the Actions summary and annotations.
  - The Proof line records Step 5's planted run.
  - Update the `CLAUDE.md` command table row.
- [ ] **Step 5: Verify by planting, then reverting, each of these. Each must give exactly one finding of the named rule:**
  - an unused export in a new `src/lib/` module (DEAD-002);
  - an orphan `src/` file (DEAD-001);
  - a `src/` module imported only by a test (DEAD-004);
  - a script `"x": "node scripts/gone.mjs"` (REF-003).

  Then `npm run check` passes on the reverted tree, and on the PR the CI step summary shows the integrity table.
- [ ] **Step 6:** Commit `ci: the integrity engine replaces the bare knip gate`, then open the PR with base's template.

---

### Task 9: Delivery acceptance (spec I0)

- [ ] **Step 1:** After the next release that follows Task 8, check base for a Dependabot npm PR that bumps `@nothingfortune/workflows` to the new SHA. Either wait for the Monday 04:00 UTC run, or have the user press "Check for updates" under Insights → Dependency graph → Dependabot.
- [ ] **Step 2: If no PR appears:**
  - re-pin base to `github:nothingfortune/workflows#semver:^1.3.0`;
  - record the outcome and the chosen ref form in spec §5.1 and README → Integrity engine;
  - add a fleet-report note that npm pins are tracked by tag.
- [ ] **Step 3:** Record the I0 acceptance in this plan's checkboxes:
  - base's `check` runs the engine;
  - a forced knip crash exits 2. Run `npm run integrity` with a broken `knip.json` and see exit 2;
  - the Dependabot result.
