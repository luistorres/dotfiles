---
name: codex-review
description: Run a second-opinion code review of recent changes using OpenAI's Codex CLI with the GPT-6.1 Sol model (a different model with different blind spots, high reasoning effort tuned for substantive reviews). Use this whenever the user says "codex review", "review with codex", "codex second opinion", asks to "have codex look at this", or wants an independent check on work just completed before moving on. This is the default workflow for any "get codex's take on what we just did" request — don't try to substitute your own self-review.
---

# GPT-6.1 Sol Codex review

Pipe the recent diff to OpenAI's Codex CLI running GPT-6.1 Sol with high reasoning effort so a different model with deliberate reasoning can flag bugs, missed cases, and design concerns you may have missed. Codex's verdict is one more opinion — surface disagreements rather than silently adopting them.

## Prerequisites

- `codex` CLI on PATH, **version 0.144.4 or newer**. Check with `codex --version`. If missing, tell the user to install Codex CLI (`brew install --cask codex` or via `npm i -g @openai/codex`); don't try to install it yourself.
- **`gpt-6.1-sol` is gated on the CLI version.** An older CLI (0.140.0 confirmed) accepts the `--model` flag, prints `warning: Model metadata for 'gpt-6.1-sol' not found`, then dies on an API `400 invalid_request_error`: "The 'gpt-6.1-sol' model requires a newer version of Codex." That's a stale binary, not a bad model ID — fix it with `brew upgrade --cask codex` (or the npm equivalent) rather than downgrading the model.
- User must already be authenticated. `codex login status` should show a logged-in account. If not, ask the user to run `codex login` themselves — it's an interactive browser flow you can't drive headlessly.

## What to review

The typical use case is a **pull-request-style review** of the entire branch.

**Don't extract and inline the diff yourself.** Codex `exec` has shell + workspace access with the read-only sandbox, so it can run `git diff` (and read files) on its own. Pulling the diff into your context just to forward it to codex is double work — it bloats your context with code you don't need to read, and codex receives the same content twice (once in the prompt, again when it re-reads files for surrounding context). Instead, point codex at the right refs in the prompt and let it pull.

What to tell codex in the prompt:

- Default: review the current branch vs its base. Identify the base (`main` for most repos, `develop` for some) and the current branch name with `git rev-parse --abbrev-ref HEAD` if needed — or just let codex figure it out.
- **Strongly prefer `git diff <base>...HEAD` over `gh pr diff <num>`** — even when the user names a PR. `gh` does a network round-trip, and when it stalls (auth refresh, DNS, GitHub flakiness, restricted sandbox) codex sits silently in its `exec` subprocess and you see nothing for minutes. Local `git diff` is the same content from your perspective, just faster and offline. Only fall back to `gh pr diff` / `gh pr view` if the PR body or comments matter for the review.
- If only uncommitted work matters (rare for a PR review), say so explicitly.

If you genuinely can't tell what the user wants reviewed (e.g. multiple branches in play, ambiguous "this"), ask once before burning the API call.

## Building the review prompt

The prompt is a **brief**, not a payload. It tells codex what's being reviewed and why, then steps out of the way and lets codex pull the actual code itself. Three parts:

1. **Where to look** — refs / PR number to diff against; tell codex to use its shell access.
2. **Goal & approach** — what was asked and what was built (small, valuable context codex can't infer from the diff alone).
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

**Fallback for weird cases:** if codex's workspace ends up looking at the wrong repo state (worktree, detached HEAD, etc.) and can't pull the right diff itself, only then fall back to inlining: `git diff main...HEAD > /tmp/review.diff` and reference it in the prompt. Verify with the user before doing this.

## Running the review

```
stdbuf -oL -eL codex exec --model gpt-6.1-sol --sandbox read-only -c model_reasoning_effort=high "<prompt>" </dev/null > /tmp/codex-review.log 2>&1
```

Why each flag:

- `stdbuf -oL -eL` — forces line-buffered stdout/stderr. **Critical when codex is invoked from a non-TTY context** (any tool call that pipes output to a file, `tail`, or `head`). Without it codex block-buffers its progress lines and you see nothing — including no signal that it's stuck — until the whole run finishes. With it you see each `exec` shell command codex runs as it happens, which is how you spot a subprocess hang in real time.
- `exec` — headless; output to stdout, scriptable. No interactive TUI.
- `--model gpt-6.1-sol` — the user's chosen model. Don't substitute a smaller tier, an older `gpt-6-sol`, or a `gpt-5-codex` variant — all undercut the point of running this. If the run 400s asking for a newer Codex, upgrade the CLI (see Prerequisites); don't fall back to an older model.
- `--sandbox read-only` — codex can read repo files (and is encouraged to, per the prompt) but cannot edit or run write commands. Right mode for a review; never weaken this without the user explicitly asking.
- `-c model_reasoning_effort=high` — high reasoning effort is intentional: the user invokes this skill only for substantive reviews, where deeper reasoning catches the subtle bugs a quicker pass would miss.
- `</dev/null` — **mandatory when running from a tool / background shell.** Per `codex exec --help`: "If stdin is piped and a prompt is also provided, stdin is appended as a `<stdin>` block." When the Bash tool runs codex with `2>&1 | tee` (or any pipeline), stdin is non-TTY and codex blocks forever waiting for it to close — the only output you ever see is the single line `Reading additional input from stdin...`. Redirecting from `/dev/null` closes stdin immediately and lets the prompt argument do its job. Symptom of forgetting this: the codex process stays alive but the log file holds exactly that one stdin-prompt line and never grows.
- `> /tmp/codex-review.log 2>&1` — write the transcript to a file so you can `Read` selected sections (the verdict is at the tail) instead of pulling 2000+ lines of intermediate `exec` traces into your context. Combine with `wc -l` to gauge progress without ingesting the body.

The workspace defaults to the cwd, so codex sees the same repo state. With high reasoning effort, expect the review to take longer than a `medium` run — 1–5min on substantive diffs is normal, not stuck.

### Long prompts

If the brief is more than a few short paragraphs, write it to a file and pass it as the positional argument via shell expansion rather than inlining a giant quoted string:

```
# Step 1: Write the prompt to a file (use the Write tool, not a heredoc).
# Step 2:
stdbuf -oL -eL codex exec --model gpt-6.1-sol --sandbox read-only -c model_reasoning_effort=high "$(< /tmp/codex-prompt.txt)" </dev/null > /tmp/codex-review.log 2>&1
```

Don't try to pipe the prompt in via stdin (`cat prompt.txt | codex exec ...`) — that defeats `</dev/null`, brings back the stdin-block bug, and codex treats the piped content as appended `<stdin>` material rather than as the primary prompt.

### If codex appears to hang

Confirmed hang signatures observed in this project:

1. **Stdin attached but never closed (the most common hang from the Bash tool).** When codex is invoked from a shell that pipes its output (`| tee`, `>file 2>&1`, the harness's background mode), stdin defaults to a non-TTY descriptor that stays open with no data. Codex sees "stdin is piped" and waits indefinitely for it to close, even though you also passed a positional prompt — the log file contains exactly one line (`Reading additional input from stdin...`) and never grows. **Mitigation:** always append `</dev/null` to the invocation (see "Running the review"). This is mandatory, not optional.
2. **`gh pr diff` waiting on network/auth that the calling shell can't satisfy.** Sandboxed `gh` calls can wait indefinitely on a credential refresh or HTTPS round-trip while codex sits in its `exec` waiting for the subprocess to exit. **Mitigation:** keep the prompt pointed at `git diff` (see "What to review" above) so codex never reaches for `gh` in the first place.
3. **Block-buffered stdout hiding live progress.** Without `stdbuf`, codex's intermediate `exec` lines never reach your terminal/file until the process exits — so a stuck subprocess looks identical to a process producing no output. **Mitigation:** always wrap with `stdbuf -oL -eL` as shown above. If you're already past that and need to confirm whether codex is actually working or hung, `ps aux | grep codex` and check whether its child processes are alive and producing CPU/file activity.
4. **Very long, dense prompts.** A 300+ line brief with many numbered sub-questions, embedded code, and shell-special characters has empirically been more prone to silent hangs than a short focused brief. **Mitigation:** keep the prompt under ~100 lines; if the context is genuinely large, write it to a file and inline it with `"$(< file.txt)"` (see "Long prompts" above) rather than stuffing a giant quoted heredoc into the shell argument.

If you've already passed the point of intervention (long wait, no output even with `stdbuf`), kill the process (`pkill -f 'codex exec'`) and rerun with a tightened prompt and `</dev/null`. Don't let a hung codex eat tens of minutes of session time. Quick diagnostic before killing: `wc -l <logfile>` and `Read` the first ~5 lines — if you see only `Reading additional input from stdin...`, it's hang signature #1 and `</dev/null` is the fix.

## Reporting back

Once the review returns:

1. **Don't paste the raw output verbatim** if it's long. Summarize: which findings are real, which are noise, which you're unsure about.
2. **Flag disagreements explicitly.** If codex flags something you believe is wrong, say so: "Codex flagged X, but I don't think that applies because Y — your call." Silently flipping your approach based on codex's review erases the value of having two opinions.
3. **Don't auto-apply suggestions.** Even strong findings are recommendations until the user approves. Ask before editing.
4. Keep it tight. A bulleted list of findings, each with your read (agree / disagree / unsure), is usually plenty.

## Costs the user should know

- Each review is one Codex API call on the user's account (or counts against their ChatGPT plan quota).
- Big diffs are slow.
- Codex is one more model, not an oracle. Treat its output as a peer review — useful, fallible, worth weighing.
