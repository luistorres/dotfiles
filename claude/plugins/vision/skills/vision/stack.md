# Stacks

A stack is several PRs that one owner ships in order. Each task gets its own branch, worktree,
review and PR. You orchestrate: a fresh `vision:implementer` builds each task, which keeps every
task's reading out of your context.

## Decompose

The task list is part of what the owner approves at [1].

- Task 1 is the tracer bullet: the thinnest slice that crosses every layer the work needs and proves
  the shape end to end. When there are no layers, it is the foundational task.
- Every task is a vertical slice that ships and is reviewed on its own, with its own criteria.
- Prefer fewer, larger tasks to many small ones that each need the same context; every task pays
  for a fresh implementer's reading.
- Order the tasks by dependency. A task that depends on another branches from that task's branch.
- Each task carries its own risk, which can be higher than the stack's.

## State file

`docs/vision/<YYYY-MM-DD>-<slug>.md` in the main checkout:

```markdown
---
Status: in_progress
Shape: stack
Risk: standard
Current: 0/<N>
---
# <stack title>

<one line: what the whole stack delivers>

## [ ] Task 1: <title>
- [ ] build · [ ] review · [ ] fix · [ ] verify · [ ] pr
- **Branch:** lt/<task-slug>
- **Base:** origin/<default branch>
- **Risk:** standard
- **Worktree:**
- **Implementer:**
- **PR:**

### Acceptance criteria
- [ ] ...

## [ ] Task 2: <title>
- [ ] build · [ ] review · [ ] fix · [ ] verify · [ ] pr
- **Branch:** lt/<task-slug>
- **Base:** lt/<task-1-slug>
...

## Log
- <YYYY-MM-DD> framed: <N> tasks
```

When the stack has three or more tasks, the last task's steps line also carries the drift review,
`- [ ] build · [ ] review · [ ] fix · [ ] verify · [ ] drift · [ ] pr`, and the PR gate will not
open that PR until `drift` is ticked.

## Each task

1. Create its worktree from its base, as in [1], and record the path.
2. Dispatch a fresh `vision:implementer` with the worktree path, the task block, the plan path and
   the repository's known tooling traps (how to run its lint and tests, environment variables that
   break them, setup a fresh worktree needs). It does not have your memory, and a trap you know
   silently bites it. Record its agent id under `Implementer:`. Fix rounds resume that agent with `SendMessage`,
   because it already holds the worktree and its own reasoning. If the resume fails, or its context
   is spent, dispatch a fresh implementer with the task block and the findings.
3. Read its diff against the criteria yourself; an implementer reporting done is a claim.
4. Run `vision:review` with the task's risk.
5. For a task that depends on another, check `git merge-base --is-ancestor <base branch> HEAD`
   before its PR. If the base moved because fixes landed below, merge it forward, then grep the
   result for each of those fixes; a clean merge can still drop one. Never rebase a published
   stack, because that rewrites reviewed commits and force-pushes every PR above it.
6. Open the PR as [4] says, with `--head <task branch>` and, for a dependent task,
   `--base <base branch>` and `Depends on #<n> (<base branch>).` in the body. Tick the task, record
   its PR, and advance `Current:`.

Tasks with no dependency between them can be built at the same time, each in its own worktree with
its own implementer, dispatched in one message; never let two agents write to the same worktree. A
task that depends on another needs that task's code, not its review: its implementer can start as
soon as the base task is built, and merges forward the base's later fixes.

## Drift review

A per-task review never sees the stack as a whole: two tasks can disagree on a contract, name the
same thing two ways, or leave dead code behind the other. Once the stack is three tasks deep, run
one more `vision:code-reviewer` pass before the last task's PR, over the accumulated diff
(`origin/<default branch>...<tip branch>`) with the stack's criteria. Measured, the cross-task
criticals came only from stacks this deep. Fix each finding on the lowest branch that owns it, merge
forward to the tip in the same turn, and verify the fix commits as `vision:review` does. Tick the
last task's `drift` box when that verify pass reports no criticals.

After the last task's PR, set `Status: done`.
