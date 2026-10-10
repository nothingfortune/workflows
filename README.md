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
`scripts/next-version.mjs` over the commits since the last semver tag and,
when a release is due, tags it, moves the major tag and publishes the release
with generated notes.

A release is due only when a commit touches a **callable** workflow (one with
`workflow_call`) — the contract consumers pin. Changes to this repo's own CI,
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
are tested in `scripts/next-version.test.mjs`, which `lint.yml` and
`release.yml` both run.

## The workflows

| Workflow                    | What it does                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                    | The gate: `npm ci` + `npm run check`, least-privilege.                                                                |
| `e2e.yml`                   | Playwright vs the BUILT app; draft-skipped; dormant (no-op) until the repo has a `playwright.config.*`.               |
| `deploy-design-preview.yml` | Static design suite → Cloudflare Pages; main = production, branches = previews; project auto-named `<repo>-design`.   |

## Caller snippets

Each workflow's header comment carries its full caller snippet — copy from
there (they stay current with the workflow). The shape:

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  check:
    uses: nothingfortune/workflows/.github/workflows/ci.yml@<sha> # v<X.Y.Z>
```

Callers own **triggers** and **concurrency**; this repo owns the jobs.
The Cloudflare workflow additionally needs `secrets: inherit` and the two
repo secrets named in its header.

## Conventions carried by these workflows

- Gates run against the **built artifact**, never dev servers or stale
  local state.
- The e2e job skips on drafts — run the reviews-done gate as
  `DRAFT_SKIPPED_CHECK=e2e` so a draft-era skip can't ride into a merge.
- Dormancy over deletion: workflows self-activate when a repo adopts the
  capability (Playwright config, design path) — fresh clones stay green.

## Security invariants

These workflows run **with each consumer's secrets, inside each consumer's
repo**. One bad commit here would land on every project at once, so the repo
enforces seven structural invariants in CI (`lint.yml` →
`security-invariants`). `actionlint` proves the YAML is *correct*; this proves
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
node scripts/audit-selftest.mjs          # proves the auditor can fail
node scripts/audit-workflows.mjs .github/workflows
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
