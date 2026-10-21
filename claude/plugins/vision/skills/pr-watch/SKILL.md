---
name: pr-watch
description: Watch GitHub for pull requests that request your review, and review each new one unattended, posting a single COMMENT review only when there is something net-new to raise. Runs one scan-and-review pass; drive it with /loop. Use for "check my review queue" or "watch my review requests".
argument-hint: "[--dry-run] [--seed] [--force]"
---

# pr-watch

One pass: find the pull requests that request your review, skip what is already handled, and hand
each new one to its own `vision:pr-reviewer` agent. You only route work. A review's reading stays in
its agent and is discarded with it, so a loop that runs all day stays cheap.

## A pass

1. Run `pr-watch scan`, passing on `--dry-run`, `--seed` or `--force` if the arguments carry them.
   It applies the rules below, records every skip in the state file, names each skip on stderr, and
   prints one JSON work item per pull request to review. When it prints nothing, log
   `scanned <HH:MM>: nothing new` and end the pass.
2. For each work item, one at a time:
   - Dispatch `vision:pr-reviewer` with the work item's line, adding "This is a dry run." under
     `--dry-run`. Its last line is `OUTCOME=… SHA=… URL=… NOTE=…`.
   - Unless this is a dry run, record it: `pr-watch record <key> <outcome> <SHA> [<URL>]`.
   - If `~/.claude/vision/pr-watch/worktrees/<owner>-<repo>-<number>` still exists, the agent died
     before cleaning up: run `git -C <clone> worktree remove --force <path>` and
     `git -C <clone> worktree prune`.
   - On `posted`, send one `PushNotification` with the URL.
3. Log one line for the pass, naming each pull request and its outcome.

Never schedule a wake-up: the loop is the heartbeat.

## What scan skips

- Drafts, your own pull requests, and requests made to a team rather than to you.
- A head already reviewed, by the watcher or by you; a new push gets one fresh review.
- A third automatic review of the same pull request: later pushes are recorded `capped`. `--force`
  lifts the cap and the head checks for one pass.
- A repository with no local clone, recorded `skipped_not_cloned` and retried every pass. Clones are
  found one or two levels below each directory in `VISION_CLONE_ROOTS` (colon-separated, default
  `~/projects`), matched on their origin remote. Nothing is ever cloned for you.

A failed review (`error`) is retried on the next pass and does not count toward the cap. `--seed`
marks every pending request as seen without reviewing it; `--dry-run` reviews and prints, but posts
nothing and writes no state. The state lives in `~/.claude/vision/pr-watch.json`
(`VISION_PR_WATCH_STATE` overrides it).

## Running it

In a session of its own, on an inexpensive model:

```
claude --model sonnet
/loop 30m /vision:pr-watch
```

Reviews still run at full strength, because the reviewer agent and its passes choose their own
models. The first time, run `/vision:pr-watch --dry-run` to see one pass, then `--seed` if the
current backlog should be skipped, then start the loop.
