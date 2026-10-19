# workflows

Reusable GitHub Actions workflows (`workflow_call`) — the CI patterns every
repo sources instead of re-porting. Battle-tested in
[dollyVision](https://github.com/nothingfortune/dollyVision); templated by
[base](https://github.com/nothingfortune/base).

**Versioning:** every release gets an immutable semver tag (`v1.1.1`) and a
GitHub release; `v1` moves to the newest `v1.x.y`. Callers pin the release's
commit SHA with its tag as a comment — `@<sha> # v1.1.1` — and Dependabot
bumps them. It reads the tag to title the PR ("from 1.1.0 to 1.1.1") and to
classify it as patch, minor or major, which is what lets auto-merge take
patches and minors; a commit with no semver tag gives an untitled,
unclassified SHA-to-SHA bump that always waits for a human.

## Releases

Releases are automatic. On every push to `main`, `release.yml` runs
`scripts/next-version.mts` over the commits since the last semver tag and,
when a release is due, tags it, moves the major tag and publishes the release
with generated notes.

A release is due only when a commit touches a releasable path: a **callable**
workflow (one with `workflow_call`) — the contract consumers pin — or the
integrity engine (`engine/src/**`, its committed build in `engine/dist/**`, and
the root `package.json`). Engine tests, the lockfile and this repo's own CI,
scripts or docs never release, so consumers get no Dependabot noise from them.
The commit type sets the level:

| Commit | Release |
| --- | --- |
| `type!:` or a `BREAKING CHANGE:` footer | major (`v2.0.0`; starts the `v2` tag) |
| `feat` | minor |
| `docs`, `chore`, `ci`, `test`, `style` | none |
| anything else (`fix`, `build(deps)`, `security`, no type, …) | patch |

An unrecognised type errs toward releasing; deleting a callable workflow
counts as touching it. The highest level among the commits wins. The rules
are tested in `scripts/next-version.test.mts`, which `npm run check` (via
`self.yml`) and `release.yml` both run.

Releases run one at a time. When merges land faster than releases finish,
GitHub drops all but the newest waiting run, and that run releases every merge
since the last tag as one version. The major tag only moves forward: re-running
an older release republishes it but leaves `v1` on the newest release.

## Fleet report

`node scripts/fleet-report.mts` reads every non-archived source repo in
`nothingfortune` and `hestiamediagroup` (or each `--owner` you pass) with your
`gh` login and prints a table. It shows each call to a shared workflow, the
release it pins, and whether that release is current, behind, unpinned
(`@v1`) or not a release at all. It also lists repos whose workflow file has
the same name as a shared workflow but never calls it, which is usually a
copy that has stopped getting fixes, and repos that call nothing.
`--strict` exits 1 when anything needs attention. It runs locally because
reading private repos in other orgs needs your token, not a workflow's.

## Integrity engine

`integrity check` finds broken references, dead code and import cycles in a
consumer repo. It runs the repo's own knip twice, once in the default mode and
once with `--production`, and adds its own check for paths that do not exist.
It writes `build/integrity/report.json`. In GitHub Actions it also appends a
step summary and emits `::error`, `::warning` and `::notice` annotations. The
engine is built from `engine/src/` into the committed `engine/dist/`, and
`npm run build:check` fails when the two differ.

`integrity check --root <dir>` analyzes another directory. The engine needs
knip `>=6 <7` installed in the consumer (it is a peer dependency) and Node 22
or newer.

### Rules

| Rule | Finds | Severity |
| --- | --- | --- |
| REF-001 | A broken reference (an import that does not resolve) | error |
| REF-002 | An unlisted dependency | error |
| REF-003 | A path that does not exist, named in a `package.json` script, a `knip.json` `entry` or `project`, or a workflow `run:` or `uses: ./` line | error |
| DEAD-001 | An orphaned file | warning |
| DEAD-002 | An unused export | warning |
| DEAD-003 | An unused dependency | warning |
| DEAD-004 | A disconnected file | warning |
| CYC-001 | A circular dependency | warning |

REF-003 skips git-ignored build output. Confidence (high for every rule except
REF-003, which is medium) is reported but never decides whether a finding
blocks. In `enforce` mode errors and warnings block and info never does.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Pass, or `observe` mode |
| `1` | Blocking findings |
| `2` | Analysis failure, invalid config, or an unknown knip issue type |

### Adoption

1. Add the engine to `devDependencies` and a script. Pin the commit SHA:

   ```json
   {
     "scripts": { "integrity": "integrity check" },
     "devDependencies": { "@nothingfortune/workflows": "github:nothingfortune/workflows#<sha>" }
   }
   ```

2. Put `npm run integrity` in your `check` script in place of `knip`.
3. Keep `knip.json`. Mark production entries with `!` (for example
   `"src/main.ts!"`) so the `--production` pass sees them.
4. Git-ignore `build/`, where the report is written.

Dependabot should bump the pin like any other dependency. That is expected but
not yet confirmed: it is verified after the first release that carries the
engine.

### Modes

By default the engine runs in `enforce` mode. To report without failing, add
an `integrity.json` at the repo root:

```json
{ "mode": "observe" }
```

`observe` never blocks, so the exit code is `0`, except that the conditions
behind exit code `2` still exit `2`. The only keys allowed are `$schema` and
`mode`; anything else is an invalid config.

## The workflows

| Workflow                    | What it does                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                    | The gate: `npm ci` + `npm run check`, least-privilege.                                                                |
| `scope.yml`                 | Doc-only classifier: outputs `doc_only` = `true`/`false`/`unknown`; callers gate jobs with `if:` and pick the fail direction.|
| `e2e.yml`                   | Playwright vs the BUILT app; draft-skipped; dormant (no-op) until the repo has a `playwright.config.*`.               |
| `deploy-design-preview.yml` | Static design suite → Cloudflare Pages; main = production, branches = previews; project auto-named `<repo>-design`.   |

## Caller snippets

Each workflow's header comment carries its full caller snippet — copy from
there (they stay current with the workflow). The shape:

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: }
# PRs cancel their superseded runs; every push to main gets its own group.
concurrency: { group: "ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}", cancel-in-progress: true }
jobs:
  check:
    uses: nothingfortune/workflows/.github/workflows/ci.yml@<sha> # v<X.Y.Z>
```

Callers own **triggers** and **concurrency**; this repo owns the jobs.
The Cloudflare workflow additionally needs the two repo secrets named in its
header, passed explicitly: `secrets: inherit` is rejected for a required
secret when the caller is in another org.

## Conventions carried by these workflows

- Gates run against the **built artifact**, never dev servers or stale
  local state.
- The e2e job skips on drafts — run the reviews-done gate as
  `DRAFT_SKIPPED_CHECK=e2e` so a draft-era skip can't ride into a merge.
- Dormancy over deletion: workflows self-activate when a repo adopts the
  capability (Playwright config, design path) — fresh clones stay green.
- This repo's own PRs run the shared workflows through `self.yml`.

## Security invariants

These workflows run **with each consumer's secrets, inside each consumer's
repo**. One bad commit here would land on every project at once, so the repo
enforces seven structural invariants in CI (`npm run audit`, run by
`self.yml`). `actionlint` proves the YAML is *correct*; this proves
it is *safe*.

| Rule | Invariant | Why |
| --- | --- | --- |
| INV-1 | No `pull_request_target` | Runs with a write token against fork-authored code |
| INV-2 | Every action pinned to a 40-char SHA | A tag is mutable; whoever controls it controls what runs with your secrets |
| INV-3 | No `secrets.*` inside a `run:` block | In `with:`/`env:` a secret is handed to a process; in `run:` it is interpolated into a shell, where one added `curl` exfiltrates it and log masking can be defeated by encoding |
| INV-4 | Every stored secret referenced is **declared** in `workflow_call.secrets` | The guard that survives `secrets: inherit` — inherit hands over *all* of a caller's secrets, so the real limit is what this code may name, and adding a name becomes a reviewable diff |
| INV-5 | No environment dumps (`printenv`, bare `env`, `set -x`, `toJSON(secrets)`) | Spills every value the job holds into the log at once |
| INV-6 | Explicit top-level `permissions:` | Without it the job inherits the repo default, which can be write-all |
| INV-7 | No untrusted `github.event.*` interpolated into `run:` | Titles, branches and comment bodies can carry `$( )`; read them via `env:` so the shell never parses them |

Run locally:

```bash
node scripts/audit-selftest.mts          # proves the auditor can fail
node scripts/audit-workflows.mts .github/workflows
```

`scripts/fixtures/` holds one deliberately-broken workflow per invariant. The
selftest asserts each is caught **and** that every invariant has a fixture, so
a rule cannot silently rot into a no-op — a guard that only ever passes is
indistinguishable from no guard. (Both bugs found while writing it were
false-negative/false-positive bugs in the auditor itself, caught by these
fixtures: INV-1 missed the inline `on: pull_request_target` spelling, and
INV-6 flagged `permissions: {}` — the *most* restrictive setting — as missing.)

### For consumers

Prefer passing secrets explicitly over `secrets: inherit`:

```yaml
secrets:
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

`inherit` forwards **every** secret the calling repo holds, so a repo that
later gains an unrelated token silently widens what it hands over. INV-4 means
this code can only ever *name* declared secrets, but explicit passing caps the
grant at the source. Always pin the `uses:` reference to a commit SHA.
