---
name: pr-review-watch
description: Watch GitHub for PRs requesting Luis's review across repos cloned under ~/projects, and for each new one run a triangulated review (codex + opus) in an isolated worktree, posting a single COMMENT review only when there are actionable findings. Invoke for one scan-and-process pass — typically driven on an interval by /loop. Triggers on "run the pr-review-watch skill", "check my review queue", "scan for new review requests".
---

# pr-review-watch — automated PR-review-request watcher

Does **one scan-and-process pass**: find PRs currently requesting Luis's review, skip the ones already handled, and for each genuinely-new one dispatch an isolated **Opus** subagent that reviews the PR in a git worktree and posts a single `COMMENT` review **only if there's something actionable**. Designed to be driven by `/loop` on a ~30-minute interval (see [Running the watcher](#running-the-watcher)).

**Design contract — keep the orchestration cheap and lean:**
- The orchestrator (this skill, run by the loop on **Sonnet**) does only: query → dedup → dispatch → record. It must **not** read PR diffs or review output into its own context — that all lives and dies inside the per-PR subagent.
- Each PR review runs in **one throwaway subagent pinned to `model: opus`**. Its context is discarded on return; only a one-line outcome comes back.
- **State lives in a file** (`~/.claude/pr-review-watch/state.json`), never in chat history, so the orchestrator never needs to "remember" prior ticks and compaction is lossless.

---

## Flags (args)

| Flag | Meaning |
|---|---|
| `--once` | One scan-and-process pass, then return. **This is the default** and what the loop passes. |
| `--dry-run` | Scan + run reviews + **print** findings, but **do not post** and **do not write** `state.json`. For first-time testing. |
| `--seed` | Mark all currently-pending requests as **seen without reviewing them** (writes `state.json` only). Use once to start the watcher "clean" and ignore the existing backlog. |
| `--force` | Ignore the per-PR auto-review cap **and** the head-SHA dedup for this pass — deliberately (re-)review even capped/unchanged PRs. For manual use ("force-review #123"), never passed by the loop. |

If no flag is given, behave as `--once`.

---

## Files & paths

- **State ledger:** `~/.claude/pr-review-watch/state.json`
- **Worktrees:** `~/.claude/pr-review-watch/worktrees/<owner>-<repo>-pr<number>` (created + removed per review)
- **Repo resolver:** `~/.claude/skills/pr-review-watch/scripts/resolve-repo.sh` (maps `owner/repo` → local clone path under `~/projects`, matching on git remote so folder-name ≠ repo-name is handled, e.g. `acme/widgets` → `acme-corp/widgets-platform`)

### `state.json` schema

```json
{
  "acme/widgets#123": {
    "head_sha": "0123456789abcdef0123456789abcdef01234567",
    "review_count": 1,
    "reviewed_at": "2026-06-17T16:20:00Z",
    "outcome": "posted",
    "review_url": "https://github.com/acme/widgets/pull/123#pullrequestreview-456"
  }
}
```

`outcome` ∈ `posted` | `clean` | `skipped_not_cloned` | `error` | `capped` | `already_reviewed`. `review_count` = number of reviews actually completed for this PR (`posted` or `clean`); it gates the auto-review cap. The dir/file may not exist on first run — create them.

### Dedup rule + auto-review cap

A PR is **auto-reviewed** iff **all** hold:
1. it appears in the search, **and**
2. `key absent in state` **OR** `state[key].head_sha != current head_sha` (new commits since last review — a re-push re-triggers exactly one fresh review; nothing already-reviewed is touched twice), **and**
3. **Luis has not already reviewed the current head himself** — i.e. no review by `luistorres` whose `commit_id == current head SHA` (see check below), **and**
4. `(state[key].review_count || 0) < MAX_AUTO_REVIEWS`.

**Already-reviewed guard (condition 3).** Submitting any review clears you from GitHub's requested-reviewers list, so a PR you've reviewed normally drops out of the search on its own. But if you're later **re-requested**, this guard prevents re-reviewing code you already looked at. For each candidate that passed conditions 1–2, check whether you already reviewed *this exact head*:
```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate \
  --jq "[.[] | select(.user.login==\"luistorres\") | .commit_id]"
```
If the current head SHA is in that list → **skip**, record `outcome: already_reviewed` (don't spawn a subagent, don't spend tokens, don't increment `review_count`). If the head has moved **past** your last review (new commits you haven't seen), the guard doesn't fire and the PR is reviewed normally — that's genuinely new code. This counts both your manual reviews and the watcher's (it reviews as you), so it's one consistent rule.

**`MAX_AUTO_REVIEWS = 2`** (constant, condition 4). The first review request is review 1; a re-push + re-tag is review 2 (run *with* the prior conversation as context, per the subagent's steps 2 & 4). A **third** push is **not** auto-reviewed — record `outcome: capped` (keep the latest `head_sha`, leave `review_count` at 2), log it, and spend no tokens. This stops a PR that keeps getting pushed + re-tagged from draining bandwidth indefinitely.

- **Manual override:** `--force` bypasses the cap, the head-SHA dedup, **and** the already-reviewed guard for this pass, so you can deliberately re-review a capped or already-reviewed PR ("review my queue, force #123"). A forced review still increments `review_count`.
- `error` records don't count toward the cap and are retried next pass. `skipped_not_cloned` / `capped` / `already_reviewed` don't count. Only a completed `posted`/`clean` review increments `review_count`.

---

## Procedure (orchestrator — the loop runs this each tick)

### Step 1 — discover PRs requesting review

```bash
gh search prs --review-requested=@me --state=open \
  --json repository,number,title,url,author --limit 50
```

This covers **all of `~/projects`** (org-agnostic). It reflects live state — a request that's been reassigned away simply won't appear. Drop any PR authored by `luistorres` (defensive; shouldn't occur).

### Step 2 — load state, compute the work set

Read `state.json` (treat missing/empty as `{}`). For each PR from Step 1, fetch the authoritative head SHA + metadata you'll need (one call per PR):

```bash
gh pr view <number> --repo <owner/repo> \
  --json number,title,body,headRefOid,baseRefOid,baseRefName,headRefName,isDraft,url,author
```

Skip `isDraft: true` PRs (don't review WIP). Apply the **dedup rule + already-reviewed guard + auto-review cap** to get the work set:
- A PR you **already reviewed at the current head** (condition 3) is **not** added — record `outcome: already_reviewed`, log `"#<n> skipped (already reviewed this head)"`, move on. No subagent, no tokens.
- A PR whose head changed but is already at `review_count == MAX_AUTO_REVIEWS` is **not** added — record `outcome: capped` (with the new `head_sha`), log `"#<n> capped (2 auto-reviews already; force to re-review)"`, move on.
- (With `--force`, ignore the cap, the head-SHA dedup, and the already-reviewed guard, and review every in-scope PR.)

### Step 3 — handle flags & the empty case

- `--seed`: for every PR in Step 1, write `state[key] = {head_sha, reviewed_at: <now ISO8601 UTC>, outcome: "seeded"}` **without** reviewing. Log how many were seeded and return.
- Work set empty: log `"scanned HH:MM — 0 new"` and return. (This is the cheap path — most ticks.)
- **First run** (state was missing/empty and not `--seed`): the work set is the whole current backlog. Process it — these genuinely await review. Log `"first run — N pending"` so the burst isn't a surprise.

### Step 4 — review each new PR (sequentially)

For each PR in the work set, one at a time (sequential keeps load + output readable and avoids worktree contention):

1. **Resolve the local repo:**
   ```bash
   bash ~/.claude/skills/pr-review-watch/scripts/resolve-repo.sh <owner/repo>
   ```
   If it exits non-zero / prints empty → record `state[key] = {head_sha, reviewed_at, outcome: "skipped_not_cloned"}`, log it, continue. **Never auto-clone.**

2. **Dispatch ONE Opus review subagent** (see [The review subagent](#the-review-subagent)) — pass the repo path, owner/repo, number, head/base SHAs, title+body (the brief), and the `dry_run` flag.

3. **Record the outcome** the subagent returns into `state.json` (skip the write entirely if `--dry-run`). Use the **`reviewed_sha`** from the subagent's return as `state[key].head_sha` — not the SHA you pre-fetched — since the subagent reviews the latest head, which may have moved since the scan. **Increment `review_count`** (treat absent as 0) when the outcome is `posted` or `clean`; leave it unchanged on `error` (so it retries) and on `skipped_not_cloned`. This is what enforces the 2-review cap. On `outcome: posted`, optionally fire a `PushNotification` with the review URL (posted outcomes only — never for `clean`/`skipped`, to avoid noise).

4. **Safety cleanup:** after the subagent returns (any outcome), if `~/.claude/pr-review-watch/worktrees/<owner>-<repo>-pr<number>` still exists, run
   ```bash
   git -C <repo-path> worktree remove --force <wt-path> 2>/dev/null; git -C <repo-path> worktree prune
   ```
   This catches a leak if the subagent died mid-review.

### Step 5 — summarize

Log one line per pass, e.g. `"reviewed #123 (3 findings posted), #124 (clean), #125 (skipped: not cloned)"`. Return. The loop's scheduler handles the next tick; **do not** schedule anything yourself here.

---

## The review subagent

Dispatch with the **Agent tool**, `subagent_type: "claude"`, **`model: "opus"`** (pinned — reviews are always full-strength regardless of the loop's session model). One subagent per PR. Fill the template below.

> You are an unattended PR-review subagent acting as Luis (`luistorres`). Review ONE pull request in an isolated worktree using a triangulated review, and **post a single GitHub review only if there are actionable findings**. You are running unattended — there is no human to confirm with, so apply the posting decision yourself per the rules below.
>
> **PR:** `{owner}/{repo}` #{number} — "{title}"
> **Local repo:** `{repo_path}`
> **Head SHA:** `{head_sha}`  **Base SHA:** `{base_sha}`  **Base branch:** `{base_ref}`
> **Brief (PR title + body):**
> {title_and_body}
> **dry_run:** {true|false}
>
> ### 1. Check out the LATEST code in an isolated worktree (never touch the user's checkout)
> The `{head_sha}` passed in can be stale if the author pushed after the orchestrator scanned. Resolve the **current** head first, then build the worktree from it:
> ```bash
> WT=~/.claude/pr-review-watch/worktrees/{owner}-{repo}-pr{number}
> git -C {repo_path} fetch --quiet origin pull/{number}/head
> CUR_HEAD=$(gh pr view {number} --repo {owner}/{repo} --json headRefOid --jq .headRefOid)
> git -C {repo_path} worktree add --detach "$WT" "$CUR_HEAD"
> ```
> Use `$CUR_HEAD` as the head everywhere below (it may differ from `{head_sha}`; if so, note it and return the actual `reviewed_sha`). All review work happens inside `$WT` (detached HEAD at the latest PR head).
>
> ### 2. Read the existing PR conversation FIRST
> Before reviewing, pull what's already been said so you don't re-raise, contradict, or ignore prior outcomes:
> ```bash
> gh api repos/{owner}/{repo}/pulls/{number}/reviews  --paginate --jq '.[] | {user: .user.login, state, submitted_at, body}'
> gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate --jq '.[] | {user: .user.login, path, line, body, in_reply_to_id}'
> gh api repos/{owner}/{repo}/issues/{number}/comments --paginate --jq '.[] | {user: .user.login, body}'
> ```
> Build a compact **prior-context summary**: which issues were already raised (and by whom), which the **author refuted or already fixed** (look for replies, "fixed in `<sha>`", resolved threads), and whether **Luis (`luistorres`) already reviewed this PR**. You'll use this in steps 4 and 5. If Luis already reviewed and nothing material changed since, expect few or zero net-new findings — that is a valid outcome, not a failure.
>
> ### 3. Run the triangulated review (NO nested Claude subagents)
> You are Opus and you are the second reviewer + the verifier yourself. Gather two independent opinions over `{base_sha}...$CUR_HEAD`:
> - **codex (GPT-6.1 Sol):** invoke the `/codex-review` skill. Because `$WT` is a **detached-HEAD worktree**, tell codex explicitly to diff `{base_sha}...$CUR_HEAD` (don't rely on it inferring the base). Include a short **"Prior review context"** block in the brief (the summary from step 2 — what's already been raised/refuted/fixed) so it reasons about it instead of repeating it. Standard flags: `stdbuf … codex exec --model gpt-6.1-sol --sandbox read-only -c model_reasoning_effort=high "…" </dev/null > /tmp/codex-{owner}-{repo}-pr{number}.log 2>&1` (the repo slug in the path keeps logs unique if PRs are ever reviewed in parallel). Read the verdict from the tail of the log.
> - **opus (you):** read the diff (`git -C "$WT" diff {base_sha}..$CUR_HEAD`) and the surrounding files yourself; form your own findings.
>
> These reviewers run as external CLIs / your own reasoning — **do not** call `flow:agents-review` or spawn any Task/Agent subagent (nesting is unreliable here).
>
> If codex fails/times out, proceed with your own review and note it (a missing reviewer never blocks).
>
> **Resilience — transient API errors.** If any step fails with a transient server error (HTTP 429 / 529 / "overloaded"), pause briefly and **retry that step once** before giving up — don't discard codex/cursor output an earlier step already produced. The codex and cursor verdicts persist in their `/tmp/*-{owner}-{repo}-pr{number}.log` files, so on retry, reuse a log that already completed instead of re-running that CLI. If it still fails after one retry, jump to cleanup (step 6) and return `OUTCOME=error` with a short `note`; the orchestrator retries the whole PR next tick and, since nothing was posted, there's no double-post risk.
>
> ### 4. Merge → verify → synthesize, then SUBTRACT what's already covered (review-mode R3/R5)
> Combine all findings. **Adversarially verify**: for each `critical`/`important`/`high`/`medium` finding, re-read the actual code in `$WT` and try to **refute** it — drop false positives, correct over-stated severity. Dedupe across reviewers. Then **subtract anything already handled in the prior conversation (step 2)**: drop findings already raised by an existing review/comment, already **refuted by the author or a prior reviewer**, or already **fixed in the code at `$CUR_HEAD`** (re-check the current code — never trust a stale claim either way). Leave nits as-is. Produce a final list of **net-new** findings sorted by severity (blocker → high → medium → low → nit), each with `file`, head-revision `line` (or null), and a one-line recommendation. **Surgical, actionable-only** — no praise, no restating prior findings, no "looks good".
>
> ### 5. Post — ONLY if there's something NET-NEW and actionable, and ONLY if not dry_run
> **Actionable = ≥1 surviving net-new finding of severity ≥ low** (after refutation + subtraction). Pure-nits-only, zero net-new, or "the important points are already covered in the existing conversation" ⇒ **post nothing**, outcome `clean`.
> - If `dry_run` is true: **print** the synthesized net-new findings and **do not post**. Outcome `dry_findings`.
> - If actionable and not dry_run: post **ONE** PR review object via the GitHub API (see [Posting format](#posting-format-r6)). `event: "COMMENT"` always — never APPROVE/REQUEST_CHANGES. Line-anchored findings go inline (verify head line numbers against `git diff {base_sha}..$CUR_HEAD -- <file>` first, since reviewer line numbers drift); anchorless ones (test gaps, PR-description mismatches, cross-cutting concerns) go as one-line bullets in the review body. **Never** post a "refuted / dropped / no-action-needed / what we verified" section.
>
> ### 6. Clean up — ALWAYS (even on error)
> ```bash
> git -C {repo_path} worktree remove --force "$WT"
> git -C {repo_path} worktree prune
> ```
>
> ### 7. Return exactly one line (this is your entire return value)
> `OUTCOME=<posted|clean|error> | findings=<n_net_new_actionable> | reviewed_sha=<$CUR_HEAD> | url=<review_url_or_-> | note=<≤12 words>`
> On `posted`, `url` is the `html_url` from the API response. Use `note` to flag a failed reviewer or findings skipped as already-covered/refuted. Always return `reviewed_sha` (the head you actually reviewed) so the orchestrator records the correct SHA.

---

## Posting format (R6)

One review object, posted atomically:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input /tmp/review-pr{number}.json
```

```json
{
  "event": "COMMENT",
  "body": "<anchorless ACTIONABLE findings only, one-line severity-prefixed bullets — or omit/empty if all findings are inline. NEVER a refuted/dropped/what-we-verified section.>",
  "comments": [
    { "path": "lib/foo.ts", "line": 42, "side": "RIGHT", "body": "**Medium —** <finding + fix>" },
    { "path": "lib/bar.ts", "start_line": 78, "line": 87, "side": "RIGHT", "body": "**Low —** <finding + fix>" }
  ]
}
```

- Single-line anchor: `{path, line, side: "RIGHT"}`. Span: `{path, start_line, line, side: "RIGHT"}` with `start_line < line`.
- A line is inline-eligible only if it's an added/changed RIGHT-side line (or context line inside a hunk). If a finding doesn't sit on a diff line, demote it to a body bullet — don't force a wrong anchor or drop it.
- Build the JSON in a file and pass `--input`; don't inline a huge `-f body=` string.

---

## Running the watcher

Start a **dedicated session on Sonnet** (cheap orchestration) and drive this skill on an interval:

```
# in a terminal:
claude --model sonnet
# then, inside that session:
/loop 30m run the pr-review-watch skill for one pass
```

The per-PR review subagent is pinned to Opus inside this skill, so reviews stay full-strength even though the loop session is Sonnet. Stop the watcher by cancelling the loop. Empty ticks (no new requests) cost cents; real cost is incurred only when there's genuinely a new PR — the same review you'd run by hand.

**First time:** run `--dry-run --once` manually to watch one full pass without posting, then `--seed` if you want to ignore the current backlog, then start the loop.

---

## Edge cases & guarantees

- **Repo not cloned** → `skipped_not_cloned`, logged, never auto-cloned.
- **Draft PRs / own PRs** → skipped.
- **Worktree leak** → subagent cleans up on all paths; orchestrator Step 4.4 is a backstop.
- **Reviewer failure** (codex/cursor times out) → review proceeds with the rest; noted in `note`. Never blocks.
- **No tick overlap** in a single session — the next tick can't fire until the current turn yields, so a PR can't be reviewed twice concurrently. (A future headless/launchd variant would need a lockfile.)
- **Already reviewed by you (manual or watcher)** → never auto-reviewed at a head you've already reviewed. Submitting any review clears your GitHub review-request, so the PR usually leaves the search on its own; and even if you're re-requested, the already-reviewed guard (no `luistorres` review with `commit_id == current head`) skips it without spending tokens. Only genuinely new commits past your last review get picked up.
- **Re-push after review** → head SHA changes → one fresh review next pass, **up to the 2-review cap**. A 3rd push is recorded `capped` and not auto-reviewed (use `--force` to re-review manually).
- **Multiple PRs in one tick** → reviewed **sequentially**, one Opus subagent at a time (controlled load/cost, readable output, no `git worktree` lock contention). Worktree paths and `/tmp` review logs are keyed by `{owner}-{repo}-pr{number}`, so nothing collides across PRs — the design is parallel-safe if you ever want to flip processing to concurrent.
- **Team-based review requests:** `review-requested:@me` matches **direct** requests. If a PR requests review via a team Luis belongs to, add a `team-review-requested:<org>/<team>` pass — out of scope until needed.
