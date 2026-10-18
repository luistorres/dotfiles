---
name: vision
description: Ship a coding task end-to-end, from a one-line fix to a stack of PRs or a set of issues for other people, with resumable state and adversarial review sized to the risk. Use when the deliverable is one or more pull requests, or when resuming a vision run.
---

# vision

You are shipping to a repository other people depend on. The work is done when the diff is correct
and open for review, not when it looks finished and not when the tests pass. Tests passing is the
weakest signal here: the defects that cost the most pass lint, typecheck and every test.

Deliver what was asked, at the scope intended. Make routine judgment calls yourself. If the request
is mistaken or a better approach exists, say so in a sentence and continue. Finish the whole task;
if part of it is blocked, finish the rest and say plainly what you left out.

You cannot review a seam you wrote both halves of, and you cannot resume a session you are not in.
Review covers the first and the state file covers the second.

## Rules

1. **One gate; every step runs.** The owner's approval at the end of [1] is the only gate. Autonomy
   waives that gate and nothing else: every step below runs whether or not anyone is watching.
2. **No PR without review.** Every diff gets at least one adversarial pass before its PR, doc-only
   diffs included. A hook blocks `gh pr create` while the run's review, fix or verify step is
   unticked.
3. **The state file is the only state.** Tick each step as it completes and append one Log line. A
   step with nothing to do is ticked with a Log line saying why, so an unticked box always means the
   step has not run. Never keep status in memory.
4. **Every token is paid for.** The day's budget is fixed, so spend it where it buys quality:
   - Run the cheapest check that can fail first: tests, typecheck, lint, and a criterion-by-criterion
     read of your diff, before any reviewer sees it.
   - Read what the change touches and its callers, not the wider codebase.
   - Delegate only for independence (review) or isolation (one task of a stack), never to
     double-check your own work.
   - Batch independent tool calls into one message, and questions for the owner into one message.
   - Do not switch models mid-run; the next request re-reads the whole conversation uncached.
5. **Ground every claim in a tool result.** Report only what a command or a file in this session
   shows, and mark what you could not confirm.
6. **Apply what the findings call for, and nothing beyond.**
7. **Keep artifacts short.** State files, plans and PRDs are re-read at every step. Keep only what
   changes what the reader does next, in full sentences.

## Autonomy

When the owner grants autonomy ("work autonomously", "don't stop", a goal they ask you to own),
record it in the state file's front matter and carry on:

```
Autonomy: granted <YYYY-MM-DD>. Waived: plan approval. Not waived: any step, or a decision only the
owner can make (merging, a non-draft PR, a scope change).
```

Run to completion. Context is not a deadline: the harness compacts and continues, and the state
file makes a hard kill resumable from [0]. End a turn only in one of these states:

- **Done:** the last step is ticked.
- **Blocked on the owner:** send `PushNotification` once per distinct blocker, log it, and end the
  turn. Their reply resumes you; a timed wake-up would only re-read the whole context to find
  nothing changed.
- **Waiting on background work:** its completion resumes you, but a hung process never notifies, so
  arm one `ScheduleWakeup` as a fallback, at about twice the work's usual duration. On waking, check
  that work first, and stop and relaunch anything silent past that time. A `/loop` already ticking
  is the heartbeat; do not arm a second one.

Before ending a turn, read your last paragraph. If it is a plan, a question you could answer
yourself, or a promise about work you have not done, do that work now.

## [0] Resume

From the main checkout, not a worktree:

```bash
grep -l '^Status: in_progress' docs/vision/*.md 2>/dev/null | sort
```

- **None:** a fresh task; go to [1].
- **One:** open it and resume at the first unticked step (in a stack, the first unticked task). If
  its worktree is gone, recreate it from the recorded branch. A run whose front matter says
  `Autonomy: granted` continues under it.
- **Several:** list each with its title and first unticked step, and ask which. Never pick one
  yourself. Files with a `Parent:` line are listed under their parent.

## [1] Frame

Work these out against the actual code, then present them in plan mode for approval:

- **Acceptance criteria:** concrete, checkable, and complete enough that someone could verify the
  work without asking you anything.
- **Shape:** `single` (one PR); `stack` (several PRs one owner ships in order; read `stack.md` next
  to this file); or `issues` (a set of issues other people or sessions will pick up; read
  `issues.md`). Choose by what the deliverable is, not by size: a large change with one clear shape
  is a stack.
- **Risk:** `low`, `standard` or `high`, as `vision:review` defines them. It sets how much review
  the work gets.
- **Design:** if it is settled, the criteria and approach are the plan. If it is not (several viable
  shapes, a new module, territory nobody knows), write a short plan at
  `docs/vision/plans/<YYYY-MM-DD>-<slug>.md` and run `vision:review` on it before approval. When the
  open questions are about the product rather than the code, ask the owner first, in one message,
  or run `mattpocock-skills:grilling` if it is installed.
- If an LLM will make a judgment over data (generate, summarise, classify, extract, score or
  decide, a single call included), invoke `agent-atlas:agentic-dev` and carry the checklists of the
  stations it marks applicable into the criteria.

On approval, write the state file `docs/vision/<YYYY-MM-DD>-<slug>.md` in the main checkout; a copy
in a worktree is one the [0] scan never finds. A stack or an issue set uses the format in its own
reference file. A single PR uses this one:

```markdown
---
Status: in_progress
Shape: single
Risk: standard
Branch: lt/<slug>
Worktree:
---
# <task title>

## Acceptance criteria
- [ ] ...

## Approach
<the seams this touches, the files it changes, and anything the criteria don't imply>

## Steps
- [ ] frame · [ ] build · [ ] review · [ ] fix · [ ] verify · [ ] ship

## Log
- <YYYY-MM-DD> framed: <risk>; <design settled, or the plan's path>
```

Then create the worktree from an up-to-date base, and record its path in the front matter:

```bash
git fetch origin
git check-ignore -q .claude/worktrees/<slug> || echo '.claude/worktrees/' >> "$(git rev-parse --git-common-dir)/info/exclude"
git worktree add .claude/worktrees/<slug> -b lt/<slug> origin/<default branch>
```

The plan is a hypothesis: it is what you believed before opening the code. When the repository
contradicts it (a convention you did not know, a generated artifact to regenerate, a doc already
false, a guard the change needs), the code wins. Do the right thing and log what changed and why.
That licence never covers changing what the task is; that is a new task, and it needs the owner.

## [2] Build

Work in the worktree (`EnterWorktree` with its `path`) and build against the criteria. For every
guard, validation or check you add, break what it guards, watch it fail, then restore it. Before
review, run the repository's gates and walk each criterion against the diff. Commit.

A stack builds each task in a fresh `vision:implementer` instead; `stack.md` says how.

## [3] Review

Invoke `vision:review` with the worktree, BASE (the merge base with the base branch), HEAD, the
title, the criteria and the risk. Tick review, fix and verify as each completes.

## [4] Ship

Run `pr-create` in the worktree, as a draft under autonomy. Set `Status: done` (this drops the run
from the [0] scan) and log the PR URL.

## Anti-patterns

- Treating a declined finding as closed. Declining is escalation, not resolution.
- Reviewing your own diff in place of [3].
- Re-reviewing a whole diff after a fix round, instead of verifying the fix commits.
- Applying minors because they look cheap.
- Scheduling wake-ups while the only thing you are waiting for is the owner.
- Keeping the state file in a worktree, or progress in memory.
