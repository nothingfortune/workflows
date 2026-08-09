# workflows

Reusable GitHub Actions workflows (`workflow_call`) — the CI patterns every
repo sources instead of re-porting. Battle-tested in
[dollyVision](https://github.com/nothingfortune/dollyVision); templated by
[base](https://github.com/nothingfortune/base).

**Versioning:** callers pin `@v1`. Rollout = moving the tag (deliberate,
blast-radius controlled). A breaking change to a workflow's contract cuts
`v2`; dependabot bumps callers.

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
    uses: nothingfortune/workflows/.github/workflows/ci.yml@v1
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
