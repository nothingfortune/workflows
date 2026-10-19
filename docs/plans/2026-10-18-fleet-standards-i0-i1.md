# Fleet Standards R0 + I0–I1: Dogfooding, Integrity Engine Package and Reference Integrity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three things, in order:
1. Put this repo's own PRs through the same pipeline it ships to every project (R0).
2. Convert its scripts to TypeScript.
3. Ship the integrity engine as a pinned TypeScript package (spec phases I0 and I1), and adopt it in base.

**Architecture:**
- **TypeScript everywhere.**
  - This repo's own scripts and every test are `.mts`, which Node ≥ 22.18 runs directly by stripping types. That means erasable syntax only.
  - The engine is `.mts` source under `engine/src/`, compiled by `tsc` to a committed `engine/dist/` (`.mjs` + `.d.mts`). Node refuses to strip types under `node_modules`, and consumers install the engine there.
- **Delivery and runtime.**
  - The root `package.json` publishes `engine/dist/` as a git dependency (`github:nothingfortune/workflows#<sha>`) with an `integrity` bin.
  - At runtime the engine runs the consumer's knip twice (default, then `--production`), maps every issue type to a spec rule, adds REF-003, applies the mode and writes text, a step summary, annotations and `build/integrity/report.json`.
- **Dogfooding.** This repo calls its own `ci.yml`, `scope.yml` and `dependabot-automerge.yml` through local `uses: ./.github/workflows/…`, so each PR also tests the PR's version of those workflows.

**Tech Stack:**
- Node 24 (`.nvmrc`), with consumers on ≥ 22.
- TypeScript 6 (`tsc`, with `erasableSyntaxOnly`, `rewriteRelativeImportExtensions` and `verbatimModuleSyntax`).
- `node:test`.
- knip ≥ 6 as a peer dependency.

**Spec:** `docs/specs/2026-10-18-fleet-standards-design.md` (approved 2026-10-18). Requirements: `docs/specs/2026-10-18-code-integrity-requirements.md`. Roadmap: `docs/ROADMAP.md`.

**Later plans, not this one:** listed in `docs/ROADMAP.md` (F1, I2, A, I3, F2, F3, I4, FM). Each gets its own plan when it starts.

## Global Constraints

- Node 24 in this repo (`.nvmrc`); the engine's `dist/` runs on Node ≥ 22 (`engines`).
- **TypeScript only.** No new `.js` or `.mjs` source. The only `.mjs` files are `tsc` output in `engine/dist/`.
- `.mts` that Node runs directly must use **erasable syntax only**: no `enum`, no `namespace`, no parameter properties. `tsconfig.json` sets `erasableSyntaxOnly: true` to enforce it.
- Relative imports name the `.mts` file (`./finding.mts`). `rewriteRelativeImportExtensions` emits `.mjs` in `dist/`.
- The engine's only runtime dependency is the consumer's knip: `peerDependencies: { "knip": ">=6 <7" }`.
- Source files stay under 400 lines and functions under 150. Comments are one line stating WHY; extended rationale goes in docs.
- Exit codes:
  - `0`: pass, or observe mode.
  - `1`: blocking findings.
  - `2`: analysis failure, invalid config, or an unknown knip issue type.
- **The engine never executes analyzed code.** CI stays least-privilege. Every action is SHA-pinned (`scripts/audit-workflows.mts` INV-2).
- **Fingerprint:** `sha256(ruleId \0 normalizedPath \0 symbol \0 expression)`, hex.
  - The normalized path is POSIX and repo-relative.
  - There are no line numbers in it.
  - A cycle's symbol is its member paths, rotated so the smallest comes first, joined with ` -> `.
- Rules in scope. Confidence is reported but never decides blocking:

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

- **Enforcement:** in `enforce` mode, `error` and `warning` block and `info` never does. In `observe` mode nothing blocks, but exit-2 conditions still exit 2.
- **Commit types** (README → Releases): `feat`/`fix` on releasable paths release; `test`/`docs`/`ci`/`chore`/`refactor` with only non-releasable paths do not.
  - Task 1 commits use `ci`.
  - Task 2 uses `refactor`. It touches no releasable path, so `refactor` cannot release.

## Review Focus

1. **knip missing, the wrong major, a crash, or JSON that won't parse.** The run exits 2 naming the cause, never 0 and never a partial report marked pass. Pinned in Task 5.
2. **Script strings that look like paths but aren't.** `node -e "…"`, `bash -c '…'`, `$VAR/x.sh`, globs, URLs and `npm run x` produce no REF-003. Pinned in Task 6.
3. **Windows paths in knip output** (`src\a.ts`). They give the same fingerprint as `src/a.ts`. Pinned in Task 4.
4. **The same finding from both passes appears once.** A file unused only in production is DEAD-004 alone. Pinned in Task 5.
5. **The committed `dist/` disagrees with `src/`.** `npm run check` fails until `dist/` is rebuilt and committed, so consumers never install stale code. Pinned in Task 3.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `package.json` (create, root) | Name `@nothingfortune/workflows`; `bin`, `files: ["engine/dist"]`, `peerDependencies`, `devDependencies` (typescript, @types/node, knip); scripts `typecheck`, `test`, `build`, `build:check`, `audit`, `check`. |
| `package-lock.json`, `.nvmrc` (create) | Dev dependency lock; Node 24. |
| `tsconfig.json` (create, root) | `noEmit` type-check of `scripts/` and every `*.test.mts`. |
| `engine/tsconfig.json` (create) | Emits `engine/src/**` to `engine/dist/`. |
| `.github/workflows/self.yml` (create) | This repo's gate: local calls to `scope.yml`, `ci.yml`, plus `gate`. |
| `.github/workflows/self-automerge.yml` (create) | Local call to `dependabot-automerge.yml`. |
| `.github/pull_request_template.md` (create) | Same sections as base's. |
| `scripts/*.mjs` → `scripts/*.mts` (Task 2) | Same behavior, typed. |
| `engine/src/{rules,finding,knip,references,config,version,policy,render,run}.mts`, `engine/src/bin/integrity.mts` | The engine; one responsibility each (Tasks 4–8). |
| `engine/dist/**` | Committed `tsc` output; never edited by hand. |
| `engine/test/*.test.mts`, `engine/test/fixtures/<name>/` | Suites import `../src/*.mts` directly. One end-to-end test spawns `dist/bin/integrity.mjs`. |

---

### Task 1: TypeScript toolchain and this repo's own pipeline (R0)

**Files:**
- Create: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `.github/workflows/self.yml`, `.github/workflows/self-automerge.yml`, `.github/pull_request_template.md`
- Modify: `.github/workflows/lint.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`, `README.md`

**Interfaces:**
- Produces:
  - `npm run check` = `npm test && npm run audit`. Task 2 prepends `npm run typecheck`, once there are `.mts` files to check, and Task 3 appends `build:check`.
  - `npm test` = `node --test` over the `scripts/` test files (`.mjs` until Task 2, `.mts` after) and `engine/test/**/*.test.mts`. Verify that a pattern matching no files does not fail the run; if it does, list only patterns that match today and widen them in Task 2.
  - `npm run audit` = `node scripts/audit-selftest.mjs && node scripts/audit-workflows.mjs .github/workflows`. Task 2 renames the files to `.mts`.
  - Check names: `gate` (from `self.yml`) and `actionlint` (from `lint.yml`).

- [ ] **Step 1: Toolchain.**
  - Root `package.json`:
    ```json
    {
      "name": "@nothingfortune/workflows",
      "private": true,
      "type": "module",
      "engines": { "node": ">=22" },
      "peerDependencies": { "knip": ">=6 <7" },
      "devDependencies": { "@types/node": "^24", "knip": "6.41.0", "typescript": "6.0.3" }
    }
    ```
    The engine is not shipped yet, so there is no `bin` or `files` until Task 3. Add the scripts from Interfaces.
  - Run `npm install`.
  - `.nvmrc` = `24`.
  - Root `tsconfig.json`:
    - compiler options `strict`, `module`/`moduleResolution` `nodenext`, `target` `ES2023`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `types: ["node"]`;
    - `include: ["scripts/**/*.mts", "engine/test/**/*.mts"]`.
  - Add `"typecheck": "tsc -p ."` but leave it out of `check` until Task 2. `tsc` errors on an empty include (TS18003).
  - Verify `npm run check` exits 0.

- [ ] **Step 2: This repo calls its own workflows.**
  - `self.yml`:
    - **Triggers:** `push: { branches: [main] }` and `pull_request`.
    - **Concurrency:** `group: "self-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}"`, `cancel-in-progress: true`.
    - **Permissions:** `contents: read`.
    - **`scope` job:** `uses: ./.github/workflows/scope.yml`.
    - **`check` job:** `needs: scope`, with `if: ${{ !cancelled() && needs.scope.outputs.doc_only != 'true' }}` and `uses: ./.github/workflows/ci.yml`.
    - **`gate` job:** `needs: [scope, check]`, `if: ${{ !cancelled() }}`, `runs-on: ubuntu-latest`, `timeout-minutes: 5`. It passes only when doc-only, or when `check` succeeded. Copy base's `gate` step, minus the docs lane.
    - Header comment, one line: "This repo's own gate: the same shared workflows consumers call, at this PR's version."
  - `self-automerge.yml`: the trigger and permissions from `dependabot-automerge.yml`'s caller snippet, calling `uses: ./.github/workflows/dependabot-automerge.yml`.
  - `lint.yml`: keep only the `actionlint` job, because it needs Docker and `check` can't run it. Delete the `security-invariants`, `release-rules`, `fleet-report` and `scope` jobs, because `npm run check` now runs all of them through `ci.yml`.
  - `release.yml`:
    - add SHA-pinned `actions/setup-node` with `node-version-file: '.nvmrc'` before the `node` steps, since Task 2 makes them `.mts`;
    - run `npm ci` before the tests.
  - `dependabot.yml`: add an `npm` ecosystem, Monday 04:00 UTC, one `npm-minor-and-patch` group, prefix `chore(deps)`, with a one-line comment that dev-tool bumps must not cut a release.
  - `.github/pull_request_template.md`: base's sections (Summary, Changes, Testing, Checklist), with the checklist item reading "`npm run check` passes locally".
  - README → "Conventions": add a line that this repo's PRs run the shared workflows through `self.yml`.

- [ ] **Step 3: Verify.**
  - `node scripts/audit-workflows.mjs .github/workflows`: OK. The two new caller files must satisfy INV-6 (permissions declared).
  - actionlint 1.7.7: clean.
  - `npm run check`: exit 0.
  - Push the branch and open the PR. Its checks must include `scope / scope`, `check / check`, `gate` and `actionlint`, all green.

- [ ] **Step 4: Branch ruleset.** This needs the user's approval before the real run.
  - Run `SETUP_REQUIRED_CHECKS=$'gate\nactionlint' bash ../base/bin/setup-github.sh --repo nothingfortune/workflows --dry-run` and show the user the plan.
  - On approval, run it without `--dry-run`. The existing classic protection (which requires `actionlint`) stays; the ruleset adds `gate`.
  - Record both outputs in the PR.

- [ ] **Step 5: Commit.**
  - `ci: this repo runs its own shared workflows; TypeScript toolchain`.
  - `ci(lint): checks move into npm run check`.

---

### Task 2: Convert this repo's scripts to TypeScript

**Files:**
- Rename and type: `scripts/next-version.mjs`, `scripts/next-version.test.mjs`, `scripts/fleet-report.mjs`, `scripts/fleet-report.test.mjs`, `scripts/scope.test.mjs`, `scripts/audit-workflows.mjs`, `scripts/audit-selftest.mjs`, all to `.mts`.
- Modify: `package.json` scripts (`check` gains `npm run typecheck &&` first; `test` and `audit` point at `.mts`), `release.yml` (`node scripts/next-version.mts`), `README.md` (every `scripts/*.mjs` mention).

**Interfaces:**
- Consumes: Task 1's `check`.
- Produces: unchanged exported function names and behavior. `isReleasablePath` arrives in Task 3.

- [ ] **Step 1:** Run `git mv` on each file, then add types:
  - parameter and return types on every exported function;
  - `type` declarations for the shapes (`Commit`, `Call`, `Release`, `RepoResult`);
  - no `any`; narrow `unknown` from `JSON.parse`.

  Imports name `.mts`. A test's `SCRIPT` path constant points at the `.mts` file and is spawned with `process.execPath`.
- [ ] **Step 2: Verify the behavior is unchanged.**
  - `npm run check`: typecheck and every suite pass. The test count matches the pre-conversion count: 15 + 11 + 7 suites' tests, plus the audit selftest.
  - `node scripts/next-version.mts` on this branch prints nothing.
  - `node scripts/fleet-report.mts | head -3` prints the table header.
- [ ] **Step 3: Commit** `refactor(scripts): TypeScript`. The type is `refactor` on non-releasable paths, so it does not release.

---

### Task 3: Engine scaffold, build and release rules

**Files:**
- Create: `engine/tsconfig.json`, `engine/src/bin/integrity.mts` (stub), `engine/dist/` (built), `engine/test/build.test.mts`
- Modify: `package.json` (`bin`, `files`, `build`, `build:check`, `check`), `scripts/next-version.mts`, `scripts/next-version.test.mts`, `README.md` → Releases

**Interfaces:**
- Produces:
  - bin `integrity` → `engine/dist/bin/integrity.mjs`;
  - `export function isReleasablePath(file: string, callable: (file: string) => boolean): boolean` in `scripts/next-version.mts`;
  - scripts `build` = `tsc -p engine` and `build:check` = `npm run build && git diff --exit-code -- engine/dist`;
  - `check` gains `&& npm run build:check`.

- [ ] **Step 1: Write the failing tests.**
  - `scripts/next-version.test.mts`, `'engine source, its dist and the root package.json are releasable; engine tests and the lockfile are not'`:
    - `isReleasablePath('engine/src/knip.mts', never)` is `true`;
    - `'engine/dist/knip.mjs'` → `true`;
    - `'package.json'` → `true`;
    - `'engine/test/knip.test.mts'` → `false`;
    - `'package-lock.json'` → `false`;
    - `'.github/workflows/ci.yml'` with `() => true` → `true`;
    - `'.github/workflows/lint.yml'` with `never` → `false`.

    Also a git-integration test in the existing `repo()` style: a `feat: engine` commit touching only `engine/src/x.mts` after `v1.0.0` prints `v1.1.0`.
  - `engine/test/build.test.mts`, `'the built bin runs'`: spawn `process.execPath engine/dist/bin/integrity.mjs` and assert exit 2 with stdout `integrity: not implemented`. That proves `dist/` exists and runs without type stripping.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`engine/tsconfig.json`:** extends the root config, but sets:
    - `noEmit: false` and `allowImportingTsExtensions: true`;
    - `rewriteRelativeImportExtensions: true`, `declaration: true`;
    - `rootDir: "src"`, `outDir: "dist"`;
    - `include: ["src"]`.
  - **The stub bin:** `#!/usr/bin/env node`, prints `integrity: not implemented`, `process.exitCode = 2`.
  - **`isReleasablePath`:** `engine/src/**`, `engine/dist/**`, exactly `package.json`, or a workflow path for which `callable` returns true. `main()` uses it, and the header comment and README → Releases say so.
  - **`package.json`:** add `"bin": { "integrity": "engine/dist/bin/integrity.mjs" }` and `"files": ["engine/dist"]`.
  - Run `npm run build` and commit `engine/dist/`.
- [ ] **Step 4: Verify.**
  - `npm run check` passes.
  - Change one character in `engine/src/bin/integrity.mts` without rebuilding: `npm run build:check` fails with a `git diff` of `engine/dist`. Revert.
- [ ] **Step 5: Commit** `feat(engine): package scaffold with committed dist; engine paths release`. This releases a minor whose new bin is a stub.

---

### Task 4: Rules table and findings

**Files:**
- Create: `engine/src/rules.mts`, `engine/src/finding.mts`
- Test: `engine/test/finding.test.mts`

**Interfaces:**
- Produces:
  - `export type RuleId = 'REF-001' | … | 'CYC-001'`, `Severity`, `Confidence`, `Classification`.
  - `export const RULES: Readonly<Record<RuleId, { classification: Classification; severity: Severity; confidence: Confidence }>>`.
  - `export type Finding = { ruleId; severity; confidence; classification; file: string; line?: number; column?: number; symbol?: string; message: string; evidence: string[]; remediation?: string; analyzer: string; fingerprint: string }`.
  - `export function normalizePath(p: string): string`. Turns `\` into `/` and drops a leading `./`. It throws `Error('<p> is outside the repo')` for an absolute path or a `..` segment.
  - `export function fingerprint(ruleId: RuleId, file: string, symbol?: string, expression?: string): string`.
  - `export function makeFinding(input: Omit<Finding, 'severity'|'confidence'|'classification'|'fingerprint'> & { ruleId: string; expression?: string }): Finding`. It throws `Error('unknown rule <id>')`.
  - `export function cycleSymbol(paths: string[]): string`.

- [ ] **Step 1: Write the failing tests:**
  - `'the same finding on Windows and POSIX paths has one fingerprint'`: `fingerprint('DEAD-001','src\\a.ts')`, `('DEAD-001','src/a.ts')` and `('DEAD-001','./src/a.ts')` are all equal.
  - `'line numbers never reach the fingerprint'`: findings that differ only in `line` (3 vs 30) have equal fingerprints.
  - `'rule, symbol and path each change the fingerprint'`: three unequal pairs.
  - `'a cycle symbol is stable under rotation'`: `cycleSymbol(['b.ts','c.ts','a.ts'])` equals `cycleSymbol(['a.ts','b.ts','c.ts'])`, and that equals `'a.ts -> b.ts -> c.ts'`.
  - `'makeFinding fills severity, confidence and classification from the rule'`: REF-003 gives `error`, `medium`, `broken-reference`.
  - `'an unknown rule or an escaping path throws'`: `/unknown rule NOPE-1/` and `/outside the repo/`.
- [ ] **Step 2: Run** `node --test engine/test/finding.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** using `node:crypto` `createHash('sha256')`.
- [ ] **Step 4: Run** `npm run check`, building and committing `dist/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): rules table, findings and identity fingerprints`.

---

### Task 5: knip adapter (both passes)

**Files:**
- Create: `engine/src/knip.mts`, `engine/test/fixtures/knip-defects/` (`package.json`, `knip.json`, `tsconfig.json`, `src/index.ts`, `src/used.ts`, `src/orphan.ts`, `src/test-only.ts`, `tests/x.test.ts`), `engine/test/fixtures/knip-clean/`
- Test: `engine/test/knip.test.mts`

**Interfaces:**
- Consumes: `makeFinding`, `cycleSymbol`, `Finding` (Task 4).
- Produces:
  - `export class AnalysisError extends Error {}`, written without parameter properties, for erasable syntax.
  - `export function resolveKnip(root: string): { bin: string; version: string }`. It uses `createRequire(path.join(root, 'package.json'))`. It throws `AnalysisError('knip is not installed in <root>')` when missing, or `AnalysisError('knip <v> is not supported; need >=6 <7')` for the wrong major.
  - `export function runKnip(root: string, opts: { production: boolean }): unknown`. It spawns `process.execPath <bin> --reporter json --no-progress [--production]` with `cwd: root`. Exit 0 or 1 parses stdout. Any other exit code, or unparseable output, throws `AnalysisError` carrying the first stderr line.
  - `export function mapKnip(json: unknown, pass: 'default' | 'production'): Finding[]`.
  - `export function mergePasses(def: Finding[], prod: Finding[]): Finding[]`.

**Type → rule map:**

| knip type | Rule |
| --- | --- |
| `files` | DEAD-001 |
| `dependencies`, `devDependencies`, `catalog` | DEAD-003 |
| `unlisted`, `binaries`, `optionalPeerDependencies`, `catalogReferences` | REF-002 |
| `unresolved` | REF-001 |
| `exports`, `nsExports`, `types`, `nsTypes`, `enumMembers`, `namespaceMembers`, `duplicates` | DEAD-002 |
| `cycles` | CYC-001; `symbol` = `cycleSymbol(member names)` |

- A row key outside this table, `file` and `owners` throws `AnalysisError('unknown knip issue type <t>')`.
- `symbol` is the issue's `name`, or `specifier` for unresolved imports; `line`/`column` come from `line`/`col`.
- `evidence` is `['knip <pass> pass: <type>']`.

**Merge rule:**
- Union by fingerprint.
- A production DEAD-001 or DEAD-002 absent from the default pass becomes DEAD-004 (symbol kept, evidence `reachable only from tests`).
- Production duplicates of default findings are dropped.

**Fixture `knip-defects`:**
- `src/index.ts` (entry `!`) imports `./used.ts`, `./missing.ts` (REF-001) and `left-pad`, which is unlisted (REF-002).
- `src/used.ts` exports `used` (consumed) and `unused` (DEAD-002).
- `src/orphan.ts` is imported by nothing (DEAD-001).
- `src/test-only.ts` is imported only by `tests/x.test.ts` (DEAD-004).
- `package.json` lists the unused dependency `is-odd` (DEAD-003).
- `knip.json` is `{"entry":["src/index.ts!"],"project":["src/**/*.ts!","tests/**/*.ts"]}`.
- knip resolves from this repo's `node_modules` by walking up.

- [ ] **Step 1: Write the failing tests:**
  - `'every planted defect yields exactly one finding'`: the merged `[ruleId, file, symbol]` multiset equals exactly:
    - `REF-001 src/index.ts ./missing.ts`
    - `REF-002 src/index.ts left-pad`
    - `DEAD-001 src/orphan.ts`
    - `DEAD-002 src/used.ts unused`
    - `DEAD-003 package.json is-odd`
    - `DEAD-004 src/test-only.ts`
  - `'a clean project yields no findings'`, over `knip-clean`.
  - `'an unrelated edit above a finding keeps its fingerprint'`: on a temp copy, prepend two blank lines and a comment to `src/used.ts`. The DEAD-002 fingerprint is equal and `line` differs.
  - `'an unknown knip issue type is an analysis failure'`: `mapKnip({ issues: [{ file: 'a.ts', brandNew: [{}] }] }, 'default')` throws `/unknown knip issue type brandNew/`.
  - `'knip missing and a config load error are analysis failures'`:
    - `resolveKnip(<empty temp dir>)` throws `/knip is not installed/`;
    - with `knip.json` containing `{`, `runKnip` throws `AnalysisError`, because knip exits 2.
  - `'cycles map to CYC-001 with a rotation-stable symbol'`: a row with `cycles: [[{name:'src/b.ts'},{name:'src/a.ts'}]]` gives one CYC-001 with `symbol: 'src/a.ts -> src/b.ts'`.
- [ ] **Step 2: Run** `node --test engine/test/knip.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check`. Rebuild `dist/` first.
- [ ] **Step 5: Commit** `feat(engine): knip adapter maps both passes to findings`.

---

### Task 6: Reference check (REF-003)

**Files:**
- Create: `engine/src/references.mts`, `engine/test/fixtures/refs/` (`package.json`, `knip.json`, `eslint.config.js`, `scripts/real.mjs`, `bin/real.sh`, `.github/workflows/ci.yml`, `.github/actions/local/action.yml`)
- Test: `engine/test/references.test.mts`

The fixture's `.mjs`/`.js`/`.sh` files are inert data the check looks for, not source.

**Interfaces:**
- Consumes: `makeFinding`, `Finding` (Task 4).
- Produces:
  - `export function scriptPaths(command: string): string[]`;
  - `export function workflowPaths(text: string): { path: string; line: number; via: 'run' | 'uses' }[]`;
  - `export function checkReferences(root: string): Finding[]`.

**What counts as a path:**
- **In a script command:** split on whitespace and on `&&`, `||`, `;`, `|`; skip quoted spans entirely. A token is a path when it matches `^(?:\.\/)?(?:[\w@.-]+\/)*[\w@.-]+\.(?:mjs|cjs|js|mts|cts|ts|sh|bash|py)$`. It is skipped when it:
  - starts with `-`;
  - contains `$`, `*`, `?`, `{` or `://`;
  - is the argument of `-e`, `-c`, `--eval` or `--print`.
- **In a workflow file**, on non-comment lines:
  - `uses: ./<p>` must name a directory holding `action.yml` or `action.yaml`;
  - a path-pattern token following `bash`, `sh`, `node` or `python`/`python3` (after flags) must exist.
- **In `knip.json`:** `entry` and `project` strings with no glob characters (after stripping a trailing `!`) must exist. Skip when there is no `knip.json`; skip `knip.config.*`.
- **Findings:** each missing path is one REF-003. `file` is the referencing file, `symbol` the missing path, and `line` where it was found. `evidence` is one of `package.json scripts.<name>`, `workflow run:`, `workflow uses:` or `knip.json entry`.

- [ ] **Step 1: Write the failing tests:**
  - `'a script naming a missing file is REF-003; real files and npm run are not'`:
    - `scriptPaths('node scripts/real.mjs && bash bin/gone.sh && npm run x')` deep-equals `['scripts/real.mjs','bin/gone.sh']`;
    - on the fixture, exactly one script finding, `symbol: 'bin/gone.sh'`.
  - `'evals, variables, globs, URLs and quoted spans are not paths'`: each of these gives `[]`:
    - `node -e "require('./x.js')"`
    - `bash -c 'scripts/a.sh'`
    - `bash $DIR/x.sh`
    - `node scripts/*.mjs`
    - `curl https://e.com/a.js`
  - `'a flag's path argument is still a path'`: `scriptPaths('eslint --config ./eslint.config.js .')` deep-equals `['./eslint.config.js']`.
  - `'a workflow run line and a local action are checked; comments are not'`: the fixture `ci.yml` holds:
    - `run: bash .github/scripts/gone.sh` (finding, line 9);
    - `run: node scripts/real.mjs`;
    - `uses: ./.github/actions/local`;
    - `uses: ./.github/actions/missing` (finding);
    - `# run: bash nope.sh`.

    Assert exactly two findings with those symbols and lines.
  - `'a non-glob knip entry that does not exist is REF-003; globs are not checked'`: `entry: ["src/gone.ts!", "scripts/*.mjs"]` gives one finding, `symbol: 'src/gone.ts'`.
  - `'a project with no scripts, workflows or knip.json has no findings'`.
- [ ] **Step 2: Run** `node --test engine/test/references.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check`. Rebuild `dist/` first.
- [ ] **Step 5: Commit** `feat(engine): REF-003 checks script, workflow and knip entry paths`.

---

### Task 7: Config, versions and policy

**Files:**
- Create: `engine/src/config.mts`, `engine/src/version.mts`, `engine/src/policy.mts`
- Test: `engine/test/config.test.mts`, `engine/test/policy.test.mts`

**Interfaces:**
- Consumes: `AnalysisError` (Task 5), `Finding` and `RULES` (Task 4).
- Produces:
  - `export type Mode = 'enforce' | 'observe'`.
  - `export function loadConfig(root: string): { mode: Mode }`.
    - A missing `integrity.json` gives `{ mode: 'enforce' }`.
    - Invalid JSON, an unknown key, or a bad `mode` throws `AnalysisError('integrity.json: <reason>')`. The only allowed keys are `$schema` and `mode`.
  - `export function engineVersion(root: string): string`.
    - It returns the 40-hex SHA after `#` in the consumer's `package-lock.json` → `packages["node_modules/@nothingfortune/workflows"].resolved`.
    - It returns `'dev'` when `root`'s `package.json` is named `@nothingfortune/workflows`, and `'unknown'` otherwise.
  - `export function evaluate(findings: Finding[], mode: Mode): { blocking: Finding[]; result: 'pass' | 'fail'; exitCode: 0 | 1 }`.

- [ ] **Step 1: Write the failing tests:**
  - `'no integrity.json means enforce'`.
  - `'bad JSON, an unknown key and a bad mode are analysis failures'`: three throws matching `/integrity\.json: /`.
  - `'enforce blocks errors and warnings but never info'`: REF-001 and DEAD-002 block, a hand-made info finding does not, and `exitCode` is 1.
  - `'observe never blocks'`: `exitCode` 0 and result `pass`.
  - `'engine version comes from the consumer lockfile'`:
    - a lockfile with `resolved: "git+ssh://git@github.com/nothingfortune/workflows.git#" + 'a'.repeat(40)` gives `'a'.repeat(40)`;
    - no lockfile gives `'unknown'`;
    - this repo's root gives `'dev'`.
- [ ] **Step 2: Run** both suites. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check`. Rebuild `dist/` first.
- [ ] **Step 5: Commit** `feat(engine): integrity.json modes, engine version and enforcement policy`.

---

### Task 8: Renderers, `run()` and the CLI

**Files:**
- Create: `engine/src/render.mts`, `engine/src/run.mts`
- Modify: `engine/src/bin/integrity.mts` (replace the stub), `engine/test/build.test.mts` (now asserts usage and exit codes)
- Test: `engine/test/render.test.mts`, `engine/test/run.test.mts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `export type Report = { schemaVersion: 1; engine: { version: string }; analyzers: { knip: string }; mode: Mode; durationMs: number; counts: Partial<Record<RuleId, number>>; findings: Finding[]; blocking: string[]; result: 'pass' | 'fail' }`. `blocking` holds fingerprints.
  - `export function renderText(report: Report): string`. Findings grouped by rule (`REF-001 src/index.ts:1 ./missing.ts — <message>`), then counts per rule, `Blocking: N`, `Result: PASS|FAIL` and `Duration: Xs`.
  - `export function renderSummary(report: Report): string`. A markdown counts table, then a findings table of up to 50 rows followed by `…and N more`.
  - `export function renderAnnotations(report: Report): string[]`. One `::error|::warning|::notice file=<f>[,line=<l>],title=<ruleId>::<message>` per finding, by severity.
  - `export function run(opts: { root: string; env: NodeJS.ProcessEnv }): { exitCode: 0 | 1 | 2; report?: Report; text: string }`.

**`run()` behavior:**
- `loadConfig`, then `resolveKnip`, both passes, `mergePasses`, `checkReferences`, `evaluate`.
- Write `build/integrity/report.json`, creating its directory.
- If `env.GITHUB_STEP_SUMMARY` is set, append `renderSummary`. If `env.GITHUB_ACTIONS === 'true'`, append the annotations to `text`.
- An `AnalysisError` gives exit 2, no report file, and `text` = `integrity: analysis failed: <message>`. Other errors are rethrown, and the CLI's top-level handler prints them and exits 2.
- The CLI takes `check [--root <dir>]`. Anything else prints `usage: integrity check [--root <dir>]` to stderr and exits 2.

- [ ] **Step 1: Write the failing tests:**
  - `'run on the defect fixture fails with exit 1 and writes a report'`: on a temp copy, `exitCode` is 1, `result` is `'fail'`, and `report.json` parses with `schemaVersion === 1`, `Array.isArray(findings)`, `typeof durationMs === 'number'` and `counts['DEAD-004'] === 1`.
  - `'run on the clean fixture passes with exit 0'`.
  - `'observe mode exits 0 but still reports'`: `{"mode":"observe"}` gives exit 0 and `findings.length === 6`.
  - `'an analysis failure exits 2 and writes no report'`: a broken `knip.json`.
  - `'outside Actions there are no annotations and no summary write'`:
    - with `env: {}`, there is no `/^::/m`;
    - with `{ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: tmp }`, there are 6 lines matching `/^::(error|warning) file=/m` and `tmp` contains `| DEAD-004 | 1 |`.
  - `'the built CLI maps run() to process exit codes'`: spawn `engine/dist/bin/integrity.mjs`. `check --root <defects copy>` exits 1, the clean fixture exits 0, and `bogus` exits 2 with stderr matching `/usage: integrity check/`.
  - Render units:
    - a finding with no `line` emits no `line=`;
    - 60 findings end the summary table with `…and 10 more`.
- [ ] **Step 2: Run** `npm test`. Expected: the new suites FAIL.
- [ ] **Step 3: Implement.** Then rebuild `dist/`.
- [ ] **Step 4: Run** `npm run check` (all pass), then `node engine/dist/bin/integrity.mjs check --root engine/test/fixtures/knip-defects`, which prints six findings and exits 1.
- [ ] **Step 5: Commit** `feat(engine): reports, run() and the integrity CLI`.

---

### Task 9: Document, review and release

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Write the README "Integrity engine" section**, after "Fleet report":
  - the rules table and the exit codes;
  - **Adoption:** add `"@nothingfortune/workflows": "github:nothingfortune/workflows#<sha>"` to devDependencies and `"integrity": "integrity check"` to scripts, then put `npm run integrity` in `check` in place of `knip`. Keep `knip.json` and mark production entries with `!`;
  - the optional `integrity.json` `mode`;
  - that Dependabot bumps the pin (confirmed in Task 11).
- [ ] **Step 2:** Run `npm run check`; actionlint 1.7.7 must be clean. `node scripts/next-version.mts` prints the next minor.
- [ ] **Step 3: Commit** `docs(engine): adoption and rules in the README`.
- [ ] **Step 4:** Open the PR, address review threads (Codex) and merge with a merge commit after the user approves. Confirm the release run published the tag and moved `v1`. Move R0 and I0–I1 to Done in `docs/ROADMAP.md` once Task 11 passes.

---

### Task 10: base adopts the engine

**Repo:** `nothingfortune/base`, on a new branch.

**Files (base):** `package.json`, `package-lock.json`, `.github/dependabot.yml`, `.gitignore`, `CLAUDE.md`, `docs/guides/quality-gates.md`

- [ ] **Step 1:** Run `npm install -D github:nothingfortune/workflows#<release sha>`. The lockfile's `resolved` must end `#<sha>`.
- [ ] **Step 2: Scripts.** Add `"integrity": "integrity check"`, replace `npm run knip` with `npm run integrity` in `check`, and remove the `knip` script. `build/` must be in `.gitignore`.
- [ ] **Step 3: Dependabot.** In the npm ecosystem, add a `nothingfortune-workflows` group with `patterns: ['@nothingfortune/workflows']`.
- [ ] **Step 4: Docs.**
  - `quality-gates.md`: rename "Dead code (knip)" to "Code integrity". Cover the rules, the two passes, exit 2 meaning analysis failure, `report.json`, and the summary and annotations. The Proof line records Step 5.
  - Update the `CLAUDE.md` command table row.
- [ ] **Step 5: Verify by planting, then reverting, each of these. Each must give exactly one finding of the named rule:**
  - an unused export in a new `src/lib/` module (DEAD-002);
  - an orphan `src/` file (DEAD-001);
  - a `src/` module imported only by a test (DEAD-004);
  - `"x": "node scripts/gone.mjs"` (REF-003).

  Then `npm run check` passes on the reverted tree, and the PR's step summary shows the integrity table.
- [ ] **Step 6:** Commit `ci: the integrity engine replaces the bare knip gate`, then open the PR with base's template.

---

### Task 11: Delivery acceptance (spec I0)

- [ ] **Step 1:** After the next release that follows Task 10, check base for a Dependabot npm PR that bumps `@nothingfortune/workflows`. Either wait for the Monday run, or have the user press "Check for updates" under Insights → Dependency graph → Dependabot.
- [ ] **Step 2: If no PR appears:**
  - re-pin to `github:nothingfortune/workflows#semver:^<major.minor.0>`;
  - record the outcome and the ref form in spec §5.1 and README → Integrity engine.
- [ ] **Step 3:** Record the I0 acceptance here:
  - base's `check` runs the engine;
  - a forced knip crash (a broken `knip.json`) exits 2;
  - the Dependabot result.
