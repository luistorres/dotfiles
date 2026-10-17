---
name: cursor-review
description: Run a second-opinion code review of recent changes using Cursor's CLI. Defaults to Grok 4.7 high; GPT-5.6 Sol high is available as an explicit upgrade when the user asks. Use this whenever the user says "cursor review", "gpt review", "review with cursor", "second opinion", asks to "have another model look at this", or wants an independent check on work just completed before moving on. This is the default workflow for any "get another model's take on what we just did" request — don't try to substitute your own self-review.
---

# Cursor review (Grok 4.7 high default; GPT-5.6 Sol high on request)

Pipe the recent diff to Cursor's CLI running Grok 4.7 high so a different model can flag bugs, missed cases, and design concerns you may have missed. Cursor's verdict is one more opinion — surface disagreements rather than silently adopting them.

Grok 4.7 is a Cursor-owned model, so it doesn't draw on the third-party monthly quota — that's why it's the default. It can still hit an account usage limit, which falls through to `auto`. If the user explicitly asks for deeper reasoning ("use gpt-5.6", "gpt review"), upgrade to GPT-5.6 Sol high for that run instead.

## Prerequisites

- `agent` CLI on PATH. Check with `which agent`. If missing, tell the user to install Cursor's CLI; don't try to install it yourself.
- User must already be authenticated. `agent status` should show "Logged in as ...". If not, ask the user to run `agent login` themselves — it's an interactive browser flow you can't drive headlessly.

**To verify a model ID before invoking, use `agent --list-models` (NOT `agent models`).** The `agent models` subcommand returns a partial list missing newer models — `grok-4.7-high`, `gpt-5.6-sol-*`, and `claude-opus-4-8-*` only appear in `--list-models`. Trust `--list-models`.

## What to review

The typical use case is a **pull-request-style review** of the entire branch.

**Don't extract and inline the diff yourself.** Cursor's `ask` mode has shell + workspace access, so it can run `git diff` (and read files) on its own. Pulling the diff into your context just to forward it to cursor is double work — it bloats your context with code you don't need to read, and cursor receives the same content twice (once in the prompt, again when it re-reads files for surrounding context). Instead, point cursor at the right refs in the prompt and let it pull.

What to tell cursor in the prompt:

- Default: review the current branch vs its base. Identify the base (`main` for most repos, `develop` for some) and the current branch name with `git rev-parse --abbrev-ref HEAD` if needed — or just let cursor figure it out.
- If the user names a specific PR (e.g. "gpt review PR #123"), tell cursor to use `gh pr diff <num>` and `gh pr view <num>` instead of the local branch.
- If only uncommitted work matters (rare for a PR review), say so explicitly.

If you genuinely can't tell what the user wants reviewed (e.g. multiple branches in play, ambiguous "this"), ask once before burning the API call.

## Building the review prompt

The prompt is a **brief**, not a payload. It tells cursor what's being reviewed and why, then steps out of the way and lets cursor pull the actual code itself. Three parts:

1. **Where to look** — refs / PR number to diff against; tell cursor to use its shell access.
2. **Goal & approach** — what was asked and what was built (small, valuable context cursor can't infer from the diff alone).
3. **Ask** — what to flag.

Skeleton:

```
You are reviewing a pull request. The code is in your workspace and you have shell + read access — use them.

## How to gather the changes
- Run `git diff <base>...HEAD` for committed changes on this branch (base is usually `main`).
- Run `git diff HEAD` and `git diff --cached` for uncommitted/staged work.
- Run `git log <base>..HEAD --oneline` for the commit list.
- (Or, if a specific PR was named: `gh pr diff <num>` and `gh pr view <num>` instead.)

Don't review the diff in isolation. Open the changed files in their full form, follow callers and callees, check related types and tests. A diff hides context — the workspace gives it back.

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

Be concrete — cite file paths, line numbers, function names. If you don't see issues, say so; don't manufacture concerns.
```

Fill in the actual base ref, current branch, and goal/approach — keep these tight. The whole prompt should be under a few hundred lines, not thousands.

**Fallback for weird cases:** if cursor's workspace ends up looking at the wrong repo state (worktree, detached HEAD, etc.) and can't pull the right diff itself, only then fall back to inlining: `git diff main...HEAD > /tmp/review.diff` and reference it in the prompt. Verify with the user before doing this.

## Running the review

**Default — Grok 4.7 high:**

```
agent --print --trust --mode ask --model grok-4.7-high "<prompt>"
```

Why each flag:

- `--print` — headless; output to stdout, scriptable.
- `--trust` — **mandatory in headless mode.** Without it, the very first run in any new workspace fails with `⚠ Workspace Trust Required` and exits 1 (Cursor will not prompt interactively under `--print`). Symptom: an 11-line log file containing only the workspace-trust banner. The flag means "this is my workspace, proceed without the trust prompt" — never weaken it by skipping; it's just acknowledging the workspace, not lowering safety.
- `--mode ask` — read-only Q&A. Cursor can read repo files (and is encouraged to, per the prompt) but cannot edit or run commands. Right mode for a review; never weaken this without the user explicitly asking.
- `--model grok-4.7-high` — the default. A Cursor-owned model, so it does not burn the third-party monthly quota that meters GPT-5.6. It is **not** unconditionally unlimited — it can still return an out-of-usage error, in which case fall through to `auto` (see the quota fallback chain). `grok-4.7-high` (Cursor UI: "Grok 4.7") runs at high reasoning effort — the right setting for a substantive review. Cursor also lists `-low`, `-medium`, and `-fast` siblings; `high` is the one this skill wants — don't swap in a lower-effort sibling. (Verify the exact ID with `agent --list-models` if a run rejects it — `agent models` returns a partial list missing newer entries.)

The workspace defaults to the cwd, so Cursor sees the same repo state. Expect 1–3min on substantive diffs; not stuck.

## Optional upgrade to GPT-5.6 Sol high

Grok 4.7 high is the default. When the user explicitly asks for GPT-5.6 (e.g. "use gpt-5.6", "gpt review", "deeper reasoning"), run that single review with GPT-5.6 Sol high instead:

```
agent --print --trust --mode ask --model gpt-5.6-sol-high "<prompt>"
```

`gpt-5.6-sol-high` (Cursor UI: "GPT-5.6 Sol 1M High") is a third-party model metered on the user's monthly quota, so only use it on request, not by default. Cursor also lists `gpt-5.6-terra-*` and `gpt-5.6-luna-*` siblings — Sol is the one this skill wants; don't swap in a sibling because it sorts first in the list.

## Quota fallback chain

**Quota signals:** `usage limit`, `quota`, `rate limit`, `monthly limit`, `402`, `429`, `not enough credits`, `upgrade your plan`, `You're out of usage`, `ActionRequiredError`.

On any of those, step down one rung and rerun that review:

```
gpt-5.6-sol-high  →  grok-4.7-high  →  auto
```

`auto` (Cursor UI: "Auto") is the terminal rung: Cursor picks an available model server-side. It keeps working when the named models are exhausted — slower, and you do not control which model answers, but a review still happens.

```
agent --print --trust --mode ask --model auto "<prompt>"
```

**Grok is not exempt.** It is Cursor-owned, but it is *not* immune to quota exhaustion — a `grok-4.7-high` run has been observed returning `ActionRequiredError: … You're out of usage. Switch to Auto`. When the default rung fails this way, fall through to `auto` rather than reporting the reviewer as dead.

When you fall back, **say so explicitly in your report-back**, naming both rungs: "GPT-5.6 Sol quota was exhausted, ran with Grok 4.7 instead", or "Grok 4.7 was out of usage, ran with Auto instead." Each rung is a different model with different blind spots — the user should know which one produced the findings so they can weigh them accordingly. On `auto`, say that the specific model is unknown.

Don't fall back on non-quota failures (auth, invalid flag, prompt too long, network). Surface those to the user instead — silently retrying masks real problems.

## Reporting back

Once the review returns:

1. **Don't paste the raw output verbatim** if it's long. Summarize: which findings are real, which are noise, which you're unsure about.
2. **Flag disagreements explicitly.** If cursor flags something you believe is wrong, say so: "Cursor flagged X, but I don't think that applies because Y — your call." Silently flipping your approach based on cursor's review erases the value of having two opinions.
3. **Don't auto-apply suggestions.** Even strong findings are recommendations until the user approves. Ask before editing.
4. Keep it tight. A bulleted list of findings, each with your read (agree / disagree / unsure), is usually plenty.

## Costs the user should know

- GPT-5.6 Sol runs draw from the user's monthly Cursor quota. Grok 4.7 is Cursor-owned and doesn't — the reason it's the default — but it is still subject to account usage limits, and falls through to `auto` when it hits one.
- Big diffs are slow — high reasoning effort + workspace reads add up.
- Cursor is one more model, not an oracle. Treat its output as a peer review — useful, fallible, worth weighing. Whichever model produced the review matters: Grok 4.7 has different strengths and blind spots than GPT-5.6 Sol, so always tell the user which one ran.
