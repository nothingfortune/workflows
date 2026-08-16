#!/usr/bin/env node
// Security invariants for the reusable workflows in this repo.
//
// WHY THIS EXISTS: consumers call these workflows across repo boundaries, and
// at least one caller forwards credentials (`secrets: inherit`). A reusable
// workflow is therefore a privileged position: a single commit here runs with
// the caller's secrets, in the caller's repo, on every consuming project at
// once. actionlint (lint.yml) proves the YAML is CORRECT; this proves it is
// SAFE. The two are complementary and neither substitutes for the other.
//
// Every rule below is a structural constraint that makes a class of leak
// impossible to introduce without failing CI — not a style preference.
//
// Run: node scripts/audit-workflows.mjs [dir]   (exit 1 on any violation)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHA40 = /^[0-9a-f]{40}$/;
// GITHUB_TOKEN is minted per-run by Actions, not a stored secret, so it needs
// no workflow_call declaration.
const AUTO_SECRETS = new Set(['GITHUB_TOKEN']);

/** Lines of a `run:` block, with their 1-based numbers. A run block starts at
 * `run:` (optionally `run: |`) and continues while lines are deeper-indented
 * or blank. Line-oriented on purpose: the questions here are "does this text
 * appear where it can execute", which survives YAML-shape changes. */
function runBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const block = [{ n: i + 1, text: m[2] ?? '' }];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') {
        block.push({ n: j + 1, text: '' });
        continue;
      }
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break;
      block.push({ n: j + 1, text: line });
    }
    blocks.push(block);
  }
  return blocks;
}

/** Secret names declared under `on.workflow_call.secrets:`. Anchored to the
 * `workflow_call:` block by indentation walking, NOT a fixed 4-space depth —
 * the earlier fixed-depth regex could mistake a job-level `secrets:`
 * pass-through for the declaration set (or miss a differently-indented real
 * one entirely). */
function declaredSecrets(text) {
  const out = new Set();
  const lines = text.split('\n');
  const wc = lines.findIndex((l) => /^\s*workflow_call:\s*$/.test(l));
  if (wc === -1) return out;
  const wcIndent = lines[wc].length - lines[wc].trimStart().length;
  for (let i = wc + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lead = line.length - line.trimStart().length;
    if (lead <= wcIndent) break; // left the workflow_call block
    if (!/^\s*secrets:\s*$/.test(line)) continue;
    const secIndent = lead;
    for (let j = i + 1; j < lines.length; j += 1) {
      const inner = lines[j];
      if (inner.trim() === '') continue;
      const innerLead = inner.length - inner.trimStart().length;
      if (innerLead <= secIndent) break;
      const m = /^\s*([A-Za-z0-9_]+):\s*$/.exec(inner);
      if (m && innerLead === secIndent + 2) out.add(m[1]);
    }
    break;
  }
  return out;
}

/** Every secret reference inside ${{ }} expressions, in EVERY spelling GitHub
 * accepts: context names are case-insensitive, and both dot and bracket index
 * syntax work — `${{ SECRETS.X }}` and `${{ secrets['X'] }}` execute exactly
 * like `${{ secrets.X }}`. The lowercase-dot-only version of this matcher was
 * a verified full bypass of INV-3 and INV-4. */
const SECRET_REF =
  /\$\{\{[^}]*?\bsecrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*['"]([A-Za-z0-9_]+)['"]\s*\])/gi;

function secretRefs(text) {
  const refs = [];
  for (const m of text.matchAll(SECRET_REF)) {
    refs.push({ name: m[1] ?? m[2], index: m.index });
  }
  return refs;
}

export function auditFile(name, text) {
  const findings = [];
  const lines = text.split('\n');
  const add = (rule, line, detail) => findings.push({ file: name, rule, line, detail });

  // INV-1 — pull_request_target runs with a WRITE token against a fork's code.
  // Combined with a checkout of the PR head it is the classic total compromise.
  // Matched as a bare word, not `token:`, because every trigger spelling must
  // be caught: block (`  pull_request_target:`), inline (`on:
  // pull_request_target`) and list (`on: [push, pull_request_target]`). The
  // colon-anchored version of this rule missed the inline form — caught by the
  // negative fixture, which is the whole reason that fixture exists.
  lines.forEach((l, i) => {
    if (/\bpull_request_target\b/.test(l)) add('INV-1 pull_request_target', i + 1, l.trim());
  });

  // INV-2 — every third-party action pinned to a full commit SHA. A tag is
  // mutable: whoever controls it controls what runs with the caller's secrets.
  lines.forEach((l, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(l);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./')) return; // local composite
    const at = ref.lastIndexOf('@');
    if (at === -1) return add('INV-2 unpinned action', i + 1, `${ref} has no ref`);
    const rev = ref.slice(at + 1);
    if (!SHA40.test(rev)) add('INV-2 unpinned action', i + 1, `${ref} is not a 40-char SHA`);
  });

  // INV-3 — a secret expression must never appear inside `run:`. In `with:`/
  // `env:` the value is handed to an action or the process environment; inside
  // `run:` it is interpolated into a shell command, where a single added
  // `curl`/`echo` exfiltrates it and log masking can be defeated by encoding.
  for (const block of runBlocks(lines)) {
    for (const { n, text: t } of block) {
      SECRET_REF.lastIndex = 0;
      if (SECRET_REF.test(t)) add('INV-3 secret inside run:', n, t.trim().slice(0, 80));
    }
  }

  // INV-4 — every stored secret referenced must be DECLARED under
  // workflow_call.secrets. This is the guard that survives `secrets: inherit`:
  // inherit hands over ALL of a caller's secrets, so the only real limit is
  // what this code is permitted to name — and adding a name becomes a visible,
  // reviewable diff instead of a silent widening.
  const declared = declaredSecrets(text);
  const seen = new Set();
  for (const { name: secretName, index } of secretRefs(text)) {
    if (AUTO_SECRETS.has(secretName) || seen.has(secretName)) continue;
    seen.add(secretName);
    if (!declared.has(secretName)) {
      const line = text.slice(0, index).split('\n').length;
      add('INV-4 undeclared secret', line, `secrets.${secretName} is not declared in workflow_call.secrets`);
    }
  }

  // INV-5 — no environment dumping. `printenv`, a bare `env`, `set -x`, or
  // toJSON(secrets) spills every value the job holds into the log at once.
  for (const block of runBlocks(lines)) {
    for (const { n, text: t } of block) {
      const bare = t.trim();
      if (/^env\s*$/.test(bare) || /\bprintenv\b/.test(bare) || /^set\s+-[a-z]*x/.test(bare)) {
        add('INV-5 environment dump', n, bare.slice(0, 80));
      }
    }
  }
  // Case-insensitive: both the function name and the context name are —
  // `toJson(SECRETS)` executes identically.
  const dumpMatch = /tojson\s*\(\s*secrets\s*\)/i.exec(text);
  if (dumpMatch) {
    add('INV-5 environment dump', text.slice(0, dumpMatch.index).split('\n').length, dumpMatch[0]);
  }

  // INV-6 — an explicit top-level `permissions:` declaration. Without one the
  // job inherits the repo default, which can be write-all. Inline forms count:
  // `permissions: {}` is the MOST restrictive setting possible, and an earlier
  // block-only regex flagged it as missing — a false positive that would have
  // punished the safest possible configuration.
  if (!/^permissions:/m.test(text)) {
    add('INV-6 no explicit permissions', 1, 'workflow declares no top-level permissions');
  }

  // INV-7 — attacker-authored event text must not be interpolated into a
  // shell. Titles, branch names and comment bodies can carry `$( )`; read
  // them through `env:` instead so the shell never parses them. Covers the
  // TOP-LEVEL contexts too: `github.head_ref` (the PR branch name — the
  // textbook injection vector) and `github.ref_name` live directly on
  // `github.*`, not under `github.event.`, and the event-only version of this
  // rule let `run: git checkout ${{ github.head_ref }}` straight through.
  // Case-insensitive like every context lookup.
  const UNTRUSTED =
    /\$\{\{[^}]*\bgithub\s*\.\s*(?:head_ref|ref_name|event\s*\.\s*(?:issue|pull_request|comment|review|review_comment|head_commit|commits|client_payload)\b[^}]*)/i;
  for (const block of runBlocks(lines)) {
    for (const { n, text: t } of block) {
      if (UNTRUSTED.test(t)) add('INV-7 untrusted input in run:', n, t.trim().slice(0, 80));
    }
  }

  return findings;
}

export function auditDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((f) => auditFile(f, readFileSync(join(dir, f), 'utf8')));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const dir = process.argv[2] ?? '.github/workflows';
  const findings = auditDir(dir);
  if (findings.length === 0) {
    console.log(`security invariants OK — ${dir}`);
    process.exit(0);
  }
  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}\n    ${f.detail}`);
  console.error(`\n${findings.length} violation(s)`);
  process.exit(1);
}
