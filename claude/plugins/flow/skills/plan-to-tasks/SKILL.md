---
name: plan-to-tasks
description: Decompose an approved implementation plan into a tasks file with one independently-shippable task per PR. Use after writing-plans has produced a plan and the user has approved it, when the plan covers more than a single PR's worth of work. Produces docs/flow/plans/<plan>-tasks.md tracking state across sessions.
---

# Plan to Tasks

Take an approved plan file and decompose it into a `<plan>-tasks.md` companion file. Each task is one vertical slice — one branch, one worktree, one PR. The tasks file is the orchestrator's canonical execution state, re-read at the start of every session.

This skill is a **one-shot writer**: it produces the initial tasks file. The `flow` orchestrator owns ticking boxes and appending PR URLs as tasks complete.

## When to invoke

**From `flow`:** automatically after the plan-review convergence loop completes and the user approves the plan.

**Standalone:** when you have an approved plan that's bigger than one PR and you want a checklist to work through.

**Skip when:** the plan is genuinely a single task (one file, one PR, one focused change). In that case `flow` skips this step.

## Inputs

- `{PLAN_PATH}` — absolute path to the approved plan file, e.g. `docs/flow/plans/2026-05-21-feature.md`
- `{BRIEF}` (optional) — the original user brief, used for the title

## Output

Write the tasks file to `{PLAN_PATH%-.md}-tasks.md` — same directory as the plan, with `-tasks.md` suffix instead of `.md`.

Example: plan at `docs/flow/plans/2026-05-21-feature.md` → tasks at `docs/flow/plans/2026-05-21-feature-tasks.md`.

## Process

1. **Read the plan in full.** Don't skim — every section matters.

2. **Identify the tracer bullet.** The thinnest vertical slice that touches every layer the feature will eventually need (UI, API, persistence, etc.) and proves the architecture works end-to-end. This is always Task 1 if a tracer exists; if the plan doesn't have layered architecture, skip the tracer notion and pick the foundational task as Task 1.

3. **Break the rest into tasks.** Each task must:
   - Be **independently shippable** (own branch, own PR, own review cycle).
   - Have **clear acceptance criteria** (testable, not vague).
   - Be **small enough for one focused execution session** (typically 1-4 hours of agent work).
   - **Name a branch slug** in the format `lt/<short-kebab-case>`.
   - **State dependencies explicitly** (which tasks must merge first, if any).

4. **Order tasks by dependency.** Topological sort. The orchestrator works through them top-to-bottom.

5. **Write the tasks file** in the exact format below.

## Tasks file format

```markdown
# Tasks: <feature title>

Plan: <relative path to plan file>
Status: in_progress
Current: 1 / <N>

---

## Dependency graph

- Task 1 → Task 2 → Task 4
- Task 1 → Task 3 (parallel with Task 2)
- Task 4 depends on Task 2 + Task 3

(Omit this section if there's only one task or no dependencies.)

---

## [ ] Task 1 — <Imperative verb + short noun phrase>

- **Branch:** `lt/<slug>`
- **Worktree:** (filled by orchestrator at execution time)
- **Status:** pending
- **Review cycles:** ___ / <cap>   ← `[3c]` agents-review; an unfilled blank here means the PR cannot open
- **Depends on:** none
- **Plan section:** <link or heading reference into the plan>

### Acceptance criteria
- [ ] Concrete, testable criterion 1
- [ ] Concrete, testable criterion 2
- [ ] ...

### Technical notes
<Files to touch, existing utilities to reuse, edge cases to mind.>

---

## [ ] Task 2 — <...>

- **Branch:** `lt/<slug>`
- **Worktree:** (filled by orchestrator at execution time)
- **Status:** pending
- **Review cycles:** ___ / <cap>
- **Depends on:** Task 1
- **Plan section:** <reference>

### Acceptance criteria
- [ ] ...

### Technical notes
<...>

---

## [ ] Task N — ...
```

## Field semantics (for the orchestrator)

- **Top-level `Status:`** — `in_progress` while the flow is live, `done` once all task checkboxes are
  ticked, or `parked` when the flow is deliberately shelved. This exact line is **load-bearing**: `flow`'s
  `[0]` resume greps `^Status: in_progress` across the flow tasks files under `FLOW_ROOT/plans/` (see the
  flow skill's Artifact-location section) to find the active flow, so the spelling and line-start position
  must not change. Write it as the literal first `Status:` line.
- **Top-level `Current:`** — `<n>/<N>` where `n` is the next unticked task. Updated by orchestrator after each PR opens.
- **Task checkbox `[ ]` / `[x]`** — `[x]` means the task's PR has been opened. Tasks aren't ticked just because code was written.
- **Task `Status:` line** — orchestrator updates this through the lifecycle: `pending` → `in_progress` → `review` → `pr-open`. After PR opens, the top-level checkbox is ticked and the per-task `Status:` becomes irrelevant.
- **Task `Worktree:` line** — filled when the orchestrator creates the worktree.
- **Task `Review cycles:` line** — ships as an UNFILLED blank (`___ / <cap>`) and stays unfilled until
  `[3c]` agents-review converges on that task's diff. It is the only per-task record that the review
  happened, so an unfilled blank next to an open PR is a visible defect. Never pre-fill it, never
  write `n/a`, and never tick a task's checkbox while it reads `___`.

After PR open, the orchestrator fills the blank and appends:

```markdown
- **PR:** <url>
- **Completed:** YYYY-MM-DD
- **Review cycles:** <n> / <cap>
```

## Guidelines

- Prefer **vertical slices** (feature through all layers) over horizontal slices (one layer at a time). The plan reviewer should have already caught horizontal slicing — if it slipped through, fix it here.
- Each task should deliver **visible, testable progress** — if a task can't be acceptance-tested on its own, it's not actually independently shippable.
- Keep tasks small. If a task has more than 5-6 acceptance criteria, consider splitting it.
- **Dependent tasks branch from the predecessor's branch**, not from base. The orchestrator handles this and notes the dependency in the PR description.
- **Do not pre-fill `Worktree:` or `PR:` lines** — those are owned by the orchestrator at runtime.
- **NEVER write process, review cadence, or PR policy into the tasks file.** No "execution model",
  no "ONE branch, ONE PR", no "agents-review after all tasks", no "review at the end". The tasks
  file records WHAT the work is and WHERE it stands; `flow`'s state machine owns HOW it is executed
  and reviewed. A process line here outranks nothing and misleads everything — an orchestrator
  reading the tasks file as canonical state will follow it and skip steps.
  (This is not hypothetical: a hand-written tasks file carrying "ONE branch, ONE PR … agents-review
  after ALL tasks" caused `[3c]` to be skipped on four consecutive tasks.)
- **This skill is the only sanctioned way to produce a tasks file.** Never hand-author one with a
  raw `Write` — a hand-written file is exactly how the process directive above got in, and how the
  `Review cycles:` blank goes missing.
- **Always write a Dependency graph section unless there's only one task** — it's the orchestrator's quickest way to plan execution order.
