---
name: opencode-review
description: Run a second-opinion code or design review using the `opencode` CLI headlessly (default model `opencode/muse-spark-1.2-contributor-free`, read-only via `--agent plan`). Use whenever the user says "opencode review", "review with opencode", asks for "opencode's take", or wants opencode as an extra/4th reviewer alongside codex/cursor. Also the substitute reviewer when codex-review or cursor-review fails on quota exhaustion, and the reference for driving `opencode run` headlessly and read-only in general.
---

# opencode review

Drive the `opencode` CLI headlessly in read-only mode for an independent review of a diff or design doc. Its verdict is one more opinion — surface disagreements rather than silently adopting them. The free-tier default is a light reviewer: it corroborates more than it originates, so weight disagreements toward codex/cursor/opus.

Its main job in this setup is **substitute reviewer**: when `codex-review` or `cursor-review` dies on quota, run the same brief through opencode instead of dropping to two reviewers.

## Prerequisites

- `opencode` on PATH. Check with `opencode --version` (it installs to `~/.opencode/bin`, which may not be on a non-login shell's PATH — prefix `export PATH="$HOME/.opencode/bin:$PATH"` if `which opencode` comes back empty). If missing, tell the user to install it; don't install it yourself.
- Authenticated: `~/.local/share/opencode/auth.json` holds an OpenCode Zen credential. On an auth failure, ask the user to run `opencode providers` themselves.
- User config lives at `~/.config/opencode/opencode.jsonc`.

## Models

Default: **`opencode/muse-spark-1.2-contributor-free`** — free tier, fast, fine for a corroborating pass. `opencode/big-pickle` (OpenCode's own model) is the other tested default-grade option and is stronger; use it when the review matters. It is genuinely free — `opencode models opencode --verbose` reports `cost` all zeroes — but its upstream endpoint is **intermittently unavailable** (roughly half of calls failed on 2026-08-27). Retry once or twice before falling back to the default; the id and flags are not the problem.

Models on Zen that require credits (`gpt-5.6-terra`, `gemini-3.1-pro`, `claude-opus-5`, …) fail with
`Unauthorized: {"type":"error","error":{"type":"CreditsError","message":"No payment method..."}}`
until a payment method is added to the Zen workspace. **Treat that error as "pick a free model", not as a broken CLI.** `opencode models` lists everything available.

Don't pick a model that duplicates a reviewer already in the batch — codex is GPT, cursor is Grok, the in-process subagent is Opus.

## Read-only guarantee (verified)

Run with **`--agent plan`**. The `plan` agent is read-only at the *tool* level: its write/edit tools and shell writes are both refused.

Verified in a scratch repo: under `--agent plan`, both a `write` tool call and `bash: echo X > canary.txt` were blocked and no file appeared; the same prompt under `--agent build` wrote the file immediately.

Do **not** rely on opencode's permission system for this — this user's config sets `"permission": "allow"` globally, so `opencode agent list` shows `*: allow` even for `plan`. The agent choice is the guarantee, not the permissions.

**NEVER pass `--auto`** for a review — it auto-approves every permission-gated call. `--agent plan` plus no `--auto` is the safe pair.

## What to review

A PR-style review of the branch, same as codex/cursor.

**Don't extract and inline the diff yourself.** opencode has workspace + shell access under `plan`, so it runs `git diff` on its own. Pulling the diff into your context to forward it is double work and bloats both sides.

Tell it where to look: the base ref and branch (or `gh pr diff <num>` for a named PR). Prefer the local `git diff <base>...HEAD` — faster and offline. If only uncommitted work matters, say so.

## Building the brief

Same shape as the codex/cursor briefs — where to look, goal/approach, what to flag:

```
You are reviewing a pull request. You have shell + read access to the workspace — use them.

## How to gather the changes
- `git diff <base>...HEAD` for committed changes on this branch.
- `git diff HEAD` and `git diff --cached` for uncommitted/staged work.
- `git log <base>..HEAD --oneline` for the commit list.

Don't review the diff in isolation. Open the changed files in full, follow callers and callees,
check related types and tests.

## Goal
<from the user's original request, or the PR title/description>

## Approach
<what was implemented, plus any non-obvious decisions and why>

## What to look for
- Bugs or logic errors
- Missed edge cases (empty input, error paths, concurrency, lifecycle)
- Design concerns or things you'd do differently
- Contract/API breakage for existing callers (check them — don't guess)
- Test coverage gaps
- Style/idiom mismatches with the surrounding code

Be concrete — cite file paths, line numbers, function names. If you don't see issues, say so;
don't manufacture concerns. The review text is the deliverable.
```

Fill in the real base ref and goal/approach. Keep it under ~100 lines.

## Running the review

```bash
opencode run --agent plan -m opencode/muse-spark-1.2-contributor-free --variant high \
  --dir "$REPO" "$(< /tmp/opencode-brief.txt)" > /tmp/opencode-review.log 2>&1
```

Run it with `run_in_background: true` (like codex/cursor) and read the log when it completes.

- `run` — headless: send prompt, print the response, exit. No TUI.
- `--agent plan` — the read-only guarantee (see above). Never `build`, never `--auto`.
- `-m provider/model` — see Models.
- `--variant high` — reasoning effort, for the models that expose it. `muse-spark-1.2-contributor-free` declares minimal/low/high; `big-pickle` declares none, so the flag is accepted but does nothing there — omit it. Check with `opencode models opencode --verbose`.
- `--dir "$REPO"` — the repo or worktree to review; defaults to cwd. Pass it explicitly when reviewing a worktree.
- `> log 2>&1` — capture to a file so you `Read` the findings instead of pulling the transcript into context.
- Long brief: write it to a file and pass `"$(< file)"`.
- `--format json` emits a JSON event stream if you need structured output; `-c` continues the last session for a follow-up question.

## Reporting back

1. Don't paste raw output verbatim if long — summarize which findings are real, which are noise, which you're unsure about.
2. Flag disagreements explicitly: "opencode flagged X, but I don't think it applies because Y."
3. Don't auto-apply suggestions — recommendations until the user approves.
4. **Always name the model that ran**, especially when substituting for a failed CLI reviewer: "cursor was out of quota, ran opencode/muse-spark-1.2-contributor-free instead." Different model, different blind spots — the user weighs the findings accordingly.

## If a run fails

- `CreditsError` → a paid model was selected; switch to a free one (see Models).
- `Error from provider (Console): Upstream request failed: Endpoint is unavailable.` → a transient outage on that model's endpoint. **Not** a credits problem and not a wrong id or flag — the two failure modes are distinct. Retry once or twice; if it persists, fall back to the default model and say which model actually ran.
- Empty log / no findings → the brief was too open-ended and it explored until it stopped. Point it at the diff first and say the review text is the deliverable.
- Auth errors → surface to the user; don't silently retry.

## Costs

- Free-tier models cost nothing; paid Zen models bill the user's workspace.
- One more model, not an oracle — a peer review, useful and fallible.
