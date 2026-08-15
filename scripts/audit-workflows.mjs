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

/** Secret names declared under `on.workflow_call.secrets:`. */
function declaredSecrets(text) {
  const out = new Set();
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s{4}secrets:\s*$/.test(l));
  if (start === -1) return out;
  const indent = lines[start].length - lines[start].trimStart().length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lead = line.length - line.trimStart().length;
    if (lead <= indent) break;
    const m = /^\s*([A-Z0-9_]+):\s*$/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
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
      if (/\$\{\{\s*secrets\./.test(t)) add('INV-3 secret inside run:', n, t.trim().slice(0, 80));
    }
  }

  // INV-4 — every stored secret referenced must be DECLARED under
  // workflow_call.secrets. This is the guard that survives `secrets: inherit`:
  // inherit hands over ALL of a caller's secrets, so the only real limit is
  // what this code is permitted to name — and adding a name becomes a visible,
  // reviewable diff instead of a silent widening.
  const declared = declaredSecrets(text);
  const seen = new Set();
  for (const m of text.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    const secretName = m[1];
    if (AUTO_SECRETS.has(secretName) || seen.has(secretName)) continue;
    seen.add(secretName);
    if (!declared.has(secretName)) {
      const line = text.slice(0, m.index).split('\n').length;
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
  if (/toJSON\(\s*secrets\s*\)/.test(text)) {
    add('INV-5 environment dump', text.slice(0, text.indexOf('toJSON')).split('\n').length, 'toJSON(secrets)');
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
  // them through `env:` instead so the shell never parses them.
  const UNTRUSTED =
    /\$\{\{\s*github\.event\.(issue|pull_request|comment|review|review_comment|head_commit|commits)\b[^}]*\}\}/;
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
