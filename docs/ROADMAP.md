# Roadmap

What this repo is building toward: every project meets one standard without
anyone remembering to port anything. Shared CI is called, never copied, and
one report shows the whole fleet. The design is
[`specs/2026-10-18-fleet-standards-design.md`](specs/2026-10-18-fleet-standards-design.md).
The fleet is `nothingfortune` and `hestiamediagroup`; `ur-cdt` is out of
scope.

Each phase gets its own plan in [`plans/`](plans/) when it starts. Update
this page in the PR that finishes a phase.

## Done

| Item | Where |
| --- | --- |
| Automatic semver releases on merge; caller snippets pin release SHAs | #10 |
| Job timeouts, grouped action bumps, caller snippets that parse | #14 (v1.1.2) |
| Fleet report (`scripts/fleet-report.mjs`) | #15 (v1.2.0) |
| Shared doc-only classifier (`scope.yml`), fail-closed on a failing diff | #15 (v1.2.0) |
| base: knip production pass (test-only modules) and inline annotations | base#27 |
| Fleet standards spec and requirements | #16 |

## Now

| Phase | What | Plan |
| --- | --- | --- |
| R0 | This repo dogfoods its own pipeline: TypeScript toolchain, a root `npm run check`, self-calls to `ci.yml`, `scope.yml` and `dependabot-automerge.yml`, base's branch ruleset, a PR template | [`plans/2026-10-18-fleet-standards-i0-i1.md`](plans/2026-10-18-fleet-standards-i0-i1.md) Tasks 1–2 |
| base#29 | base uses `scope.yml`; copied `doc-only.sh` (fail-open on a failing diff) removed; pins v1.2.0 | open, ready to merge |
| I0–I1 | Integrity engine package (TypeScript, committed `dist/`) and reference integrity; base adopts it | same plan, Tasks 3–11 |

## Next

| Phase | What |
| --- | --- |
| F1 | `fleet.json` profiles per repo, so "possible copy" becomes exact "missing"; unclassified repos reported |
| I2 | Baseline and suppressions (owner, reason, expiry); dollyVision adopts with its existing debt |
| A | Adoption PRs, one per repo: sawdustAtlas, meridianCore, azeronMappings, silentCartographer, sovereignWard |

## Later

| Phase | What |
| --- | --- |
| I3 | TS edge extractor shared with feature-map: dynamic references (DYN-001), islands vs orphans, cycles with policy, `integrity explain` |
| F2 | Fleet report reads engine pins, baseline size trends, branch protection |
| F3 | Weekly fleet run with a read-only GitHub App; one tracking issue edited in place |
| I4 | Boundary rules, feature tiers from `features.json`, opt-in SARIF |
| FM | feature-map core in `engine/` (catalog, Mermaid, e2e selection); outerReach and then fleetDemo adopt through it |

## Parked (worth doing, not scheduled)

| Item | Why parked |
| --- | --- |
| Local dev tools from one source: PR review-loop scripts (`await-*`, `pr-reviews-done`), `pre-push`, preflight | Not CI; needs its own delivery path (likely the same package, as bins). The 4-variant drift is real. |
| Shared `mutation.yml` with an optional `mutate` input and the kills > 0 check | base and dollyVision copies differ |
| `check-security-headers.sh` as a shared check | base backlog; pairs with deploy workflows |
| Fleet fixes the report already shows: dollyVision's own `dependabot-automerge.yml`, outerReach calling no shared workflow, fleetDemo on `@v1` and `v1.1.0` | One small PR each in those repos |
| `docker/login-action` v3 → v4 (Dependabot #4) | A major; needs a deliberate test of `docker-image.yml` |
