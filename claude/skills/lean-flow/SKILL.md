---
name: lean-flow
description: "Ship a task end-to-end — frame it, work in a worktree, keep resumable state, run adversarial review before it ships, open the PR. Use when the deliverable is a diff and you want the workflow skeleton rather than an ad-hoc run. Autonomy-aware: keeps itself alive across turns and resumes cleanly after a kill."
---

# lean-flow

You are shipping to a repository other people depend on. The work is done when the diff is correct
and open for review — not when it looks finished, and not when the tests pass. Tests passing is the
weakest signal here: the defects that cost the most pass lint, typecheck and every test.

Deliver what was asked, at the scope intended. Make routine judgment calls yourself. If the request
is mistaken or a better approach exists, say so in a sentence and continue. Finish the whole task;
if part of it is blocked, finish the rest and say plainly what you left out.

Two things you cannot do for yourself, and this workflow exists for exactly those: you cannot
review a seam you wrote both halves of, and you cannot resume a session you are not in. `[3]` is
the first; the state file is the second. Everything else here is yours to judge.

---

## Working autonomously

**One gate, and it is the only thing autonomy waives:** the approval at the end of `[1]`.
Everything else — the worktree, the build, both trace passes, the fix round, the PR — is a step,
and **no autonomy instruction waives a step.** Working autonomously means running the whole thing
unattended, not choosing which parts to keep.

When autonomy is granted, record it in the state file front matter and proceed:

```
Autonomy: granted <YYYY-MM-DD> — waived: plan approval. NOT waived: both trace passes, the fix
round, or anything that needs an owner decision (merging, non-draft PRs, scope changes).
```

**Run to completion.** Session length is not a reason to stop. Context is not a deadline — the
harness compacts and continues, and the state file means a hard kill resumes cleanly from `[0]`.
Parking early delivers nothing. The only legitimate stops are: you are told to stop, an owner
decision is required, or an error you genuinely cannot work around.

**Keep yourself alive — arm the heartbeat before ending EVERY turn, not only when something is
running.** The harness runs you on a trigger: a message, a background task finishing, or a wakeup
you scheduled. Under autonomy no message is coming, and a turn that ends with nothing outstanding
has no notification coming either — so a turn that ends without an armed wakeup is the end of the
run until a human notices.

While the state file says `Status: in_progress` and autonomy is granted, **the last action of every
turn is `ScheduleWakeup`** (≤ 20 min), with a prompt naming the state file and saying: re-run `[0]`,
inspect any outstanding background work first, then continue from the first unticked step, and
re-arm. Check the tool result — if it did not arm, arm it again before you stop.

- **Re-arm after a compaction, handoff or resume.** `[0]` sees `Autonomy: granted` and open steps;
  arming again is part of resuming.
- **On waking, audit before continuing.** Read the logs of anything still running. A task silent
  past its expected duration is hung — kill and relaunch it rather than keep waiting.
- **Stop the heartbeat only** at `[4]` with `Status: done`, on an explicit stop from the owner, or
  on an error you cannot work around. If a `/loop` is already ticking, that is the heartbeat —
  re-arm with its sentinel rather than running two.

**Before ending a turn, read your last paragraph.** If it is a plan, a question, or a promise about
work you have not done, do that work now with tool calls. End the turn only when the task is
complete or you are blocked on something only the owner can give.

**When blocked, say so once and keep the heartbeat.** `PushNotification` once per distinct blocker,
record it in the state file's `Log`, and keep waking to re-check — a blocker that clears while you
are asleep should not cost the rest of the run.

## [0] RESUME CHECK

Before anything else, from the project root (not a worktree):

```bash
grep -l '^Status: in_progress' docs/flow/lean/*.md 2>/dev/null | sort
```

- **No hits** → fresh task, go to `[1]`.
- **One hit** → open it. It carries the criteria, the worktree path and the step ticks. Resume at
  the first unticked step. If the worktree is gone, re-create it at `[1]`'s last line and keep the
  file.
- **More than one** → list them and ask which; never auto-pick.

## [1] FRAME

Write the acceptance criteria before anything else — concrete, checkable, and complete enough that
someone could verify the work without asking you a question.

**Reach for more when the work wants more.** A written plan, a PRD, `grill-me` when the open
question is "does this make sense as a system", `flow:premortem` before code exists — all
available, none required. A premortem is the cheapest way to find a design defect while it is still
free to fix. If the design is settled and the deliverable is one diff, criteria alone are enough.

**Invoke `agent-atlas:agentic-dev` if an LLM will make a judgment over data** — generate,
summarize, classify, extract, score, decide — including a single call. Carry the applicable
stations' checklists into the criteria. A loaded skill is not an invoked skill, and its absence is
invisible because the run still looks confident.

**Use native plan mode to write it down** — that is how you get an approval gate before code
exists. Work out the criteria and the approach against the actual code, present it, and on approval
write the state file. It is state and plan in one:

```markdown
---
Status: in_progress
Kind: lean
Worktree:
Branch: lt/<task-slug>
---
# <task title>

## Acceptance criteria
- [ ] ...

## Approach
<the seams this touches, the files it will change, anything the criteria don't imply.>

## Steps
- [ ] 1 frame · [ ] 2 build · [ ] 3 trace (x2) · [ ] 3f fix round · [ ] 3v verify pass · [ ] 4 ship

## Log
- <date> framed
```

Path: `docs/flow/lean/<YYYY-MM-DD>-<slug>.md` in the **main checkout**, never in the worktree — a
worktree copy is an island the `[0]` scan will not find.

**Tick the step boxes as you go, and append one line to `Log` at each step.** A step that was
skipped must leave a visible unticked box; that is the whole mechanism. A working state that never
shows a step as outstanding is how work ships with a gate silently missing.

Then create the worktree: `superpowers:using-git-worktrees`, branch `lt/<task-slug>`. Record its
path in the front matter immediately.

**The plan is a hypothesis, not a specification.** It is what you believed before you opened the
code. When the repository contradicts it — a convention you did not know about, a generated
artifact that must be regenerated, a doc that is already false, a guard the change needs to work at
all — **the code wins.** Do the right thing, then edit the state file to say what changed and why.
Never build to a plan you have learned is wrong.

Two limits on that licence: it does not extend to changing what the task *is* (that is a new task,
and it needs the owner), and every deviation gets a `Log` line so review and the approval gate can
see it.

## [2] BUILD

Build it against the acceptance criteria.

## [3] TRACE

Dispatch **two** adversarial passes in parallel — same brief, both of them. Two, not one: which
defects a single pass misses is largely random, so the second pass is a second sample, and it is
where the gain is. This is the one place delegation is not optional: a reviewer that did not write
the code is the only thing here you cannot substitute for yourself.

Give each pass the brief in `reviewer-brief.md` next to this file, **verbatim**, substituting
`{WORKTREE} {BASE} {HEAD} {TITLE} {CRITERIA} {DEST}`. Do not summarise or re-order it — its ten
checks are ordered by how many real defects each one reaches, and restating them from memory loses
half the coverage. Check 10 (user-facing surfaces) is skipped when the diff touches none.

**Run the strongest model available for these passes, at high effort.** Review quality is the whole
product of this step; a cheaper reviewer finds roughly half as much.

**A third, differently-blind sample is worth buying when the diff is high-consequence,
security-touching, or in territory you do not know well** — `codex-review`, `cursor-review` or
`opencode-review`. It is the slowest seat and the lowest-yield one; a deliberate extra sample, not
a default.

**Triage the union of the passes by tier** — the tiers carry very different hit rates, so treat
them differently:
- **Critical** (~92% real) → fix, then re-run ONE pass against the fixed diff. A wrong fix is what
  a second look reliably catches.
- **Important** (~56% real) → apply the ones you agree with; list the ones you decline with a reason.
- **Minor** (~6% real) → **list only, never auto-apply.** Auto-applying them manufactures fix rounds
  that are more likely to break something than the minor was to matter.

**After the fix round, re-run ONE trace pass against the fixed diff.** This is not the same as the
re-review for criticals — it runs even when the round applied only importants. Fixes are code,
written under time pressure, by something that just read a list of complaints: a fix round can
close five defects and open two, and the new ones are in exactly the places nobody is looking.

If criticals survive that pass, stop and escalate rather than shipping past them.

**A finding you decline because it needs an owner's decision is not closed — escalate it.**
`PushNotification` the owner, record it in the `Log`, and say plainly in the PR body that it is
open. Declining to fix is a decision to escalate, never a decision to ship.

## [4] SHIP

`pr-create` in the worktree. Then set the state file's `Status: done` — this drops it from the
`[0]` scan — and record the PR url in its `Log`.

---

## Anti-patterns

- ❌ Skipping the verify pass because the fix round "only applied importants".
- ❌ Treating a declined finding as closed. Declining is escalation, not resolution.
- ❌ Running one trace pass instead of two. The second pass is where recall comes from.
- ❌ Auto-applying minors because they look cheap.
- ❌ Reviewing your own diff in place of `[3]`. You wrote both halves of every seam.
- ❌ Keeping the state file in the worktree. It lives in the main checkout or `[0]` cannot find it.
- ❌ Recording progress in memory instead of the state file. Memory holds no status; a second copy
  only drifts from the file that `[0]` actually scans.
- ❌ **Ending a turn under autonomy without an armed wakeup.** No message is coming and no task is
  finishing; the run is over until a human notices. Arm it, then verify the tool result.
- ❌ Treating a doc-only task as not needing `[3]`. Prose asserts things that go false silently.
