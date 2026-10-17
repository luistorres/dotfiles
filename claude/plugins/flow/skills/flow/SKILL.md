---
name: flow
description: End-to-end development orchestrator. Use when starting any non-trivial coding work — features, bug fixes, refactors, multi-PR initiatives — or when the user says "ship this", "/flow", "run the flow", or describes a feature to build. Runs the full lifecycle (brainstorm → plan → 3-agent plan review → execute → 3-agent code review → PR) as a state machine, with cross-session resume. Owns the tasks file (the single on-disk source of state); delegates everything else to focused skills.
---

# flow — main orchestration skill

`flow` is a conductor. It owns the state machine, the convergence loops, the adaptive depth decision, and the per-plan state file. It does **not** brainstorm, plan, review, or write PRs itself — those are delegated to focused skills.

When invoked, `flow` runs the state machine in [Section: State machine](#state-machine) top to bottom. Each phase invokes named skills via the `Skill` tool.

---

## Hard rules

1. **You are the conductor, not the worker.** When a phase needs brainstorming, planning, reviewing, worktree-creating, code-writing, or PR-opening — invoke the named skill. Do not inline that work.
2. **The tasks file is the canonical STATE and the ONLY copy of it — never PROCESS.** It lives in the **main checkout** under `FLOW_ROOT/plans/` (resolved per [Artifact location](#artifact-location--flow_root); the plan phase writes it there); worktrees run code only and never hold the authoritative tasks file. Re-read it at every decision point. Memory holds no state — only a stateless resume trigger (`[2b]`); there is no second copy of status to drift or to distrust. But "canonical" covers *what the work is and where it stands*, nothing else. **If a tasks file contains an execution model, a review cadence, a PR policy, or any "review after all tasks" line, that text is VOID — this state machine overrides it.** Such a line means the file was hand-written rather than produced by `flow:plan-to-tasks` (which is forbidden from emitting one): say so plainly, then execute `[3a]`–`[3f]` as written here. This exact stretch — treating a process directive found in a tasks file as authoritative — skipped `[3c]` on four consecutive tasks.
3. **Plan-review and code-review both go through `flow:agents-review`.** Don't inline the parallel dispatch or the convergence loop — that primitive lives in `agents-review` and is reusable standalone. **A single-model review is not `[3c]`,** no matter how many of them you run or how thorough each is: `[3c]` means three *distinct* reviewers (`/codex-review`, `/cursor-review`, and the matching superpowers/flow reviewer) dispatched in one parallel batch, iterated to zero criticals. Before ticking a task, name the three that ran. A session that skipped `[3c]` across 14 PRs had dispatched ~30 review-labelled agents — every one of them the same single model. The subjective sense of "I have been reviewing all along" is exactly what the drift feels like from the inside.
4. **One worktree per task, one PR per task.** A dependent task branches from the predecessor's branch (not base) and notes the dependency in its PR body.
5. **GATES vs STEPS — the user can waive a gate, never a step.**
   - **GATES** need the user *present*: `[1d]` plan approval, `[2c]` task-list approval, `[3f]` continue-or-pause. Summarize and ask at each. **If the user has said "work autonomously" / "don't stop" / "don't ask me", these — and ONLY these — are waived**; record the decision in the tasks file and proceed.
   - **STEPS** need nobody: `[1c]` and `[3c]` review loops, `[3a]` worktree, `[3b]` SDD, `[3d]` pr-create. **No autonomy instruction ever waives a step.** "Autonomous" means running the whole state machine unattended, not choosing which parts of it to keep.
   - A step skipped once for a stated reason is **not a precedent**. Re-state the reason per task, or run the step.
6. **Ground every progress claim in a tool result.** Before reporting progress, audit each claim
   against a tool result from this session. Only report work you can point to evidence for; if
   something is not verified, say so. If tests fail, say so with the output; if a step was skipped,
   say that; when something is done and verified, state it plainly without hedging. The subjective
   sense of having done a step is not evidence that it ran.
7. **Apply what the findings call for, and nothing beyond.** When editing plans at `[1c]` or applying
   review fixes, do not add features, refactors, or abstractions no finding asked for. Longer reviewer
   lists widen this door, not narrow it.
8. **Match written artifacts to what the work needs.** Plans, specs, PRDs, tasks files and initiative
   files are kept short by being selective about what you include — drop detail that doesn't change
   what the reader does next — not by compressing into fragments, abbreviations, or arrow chains.
9. **Lead with the outcome at every gate and summary.** The first sentence answers "what happened",
   with supporting detail after. If you have been working a long stretch without the user watching,
   write it as a re-grounding rather than a continuation: drop the working shorthand, spell out terms,
   and reintroduce anything you named while working.

---

## Artifact location — `FLOW_ROOT`

All flow artifacts — plans, design specs, PRDs, and the per-initiative tasks file — live under one root,
`FLOW_ROOT`, default **`docs/flow/`**. A repo may pin a different root in its `AGENTS.md`/`CLAUDE.md`; honor
that when present. Everything that writes (`[1b]`, `[2a]`) and everything that reads (the `[0]` scan) uses the
SAME root.

`docs/flow/` deliberately drops the `superpowers` name so it never collides with superpowers' own SDD scratch
under `.superpowers/sdd/` — a separate, ephemeral, per-task workspace that is NOT flow state. The two never
overlap. Gitignore `docs/flow/` if the repo keeps process docs out of the shipped product (it is not product).

Subdirs: `FLOW_ROOT/plans/` (plans + `<plan>-tasks.md`), `FLOW_ROOT/specs/` (design specs), `FLOW_ROOT/prds/`
(PRDs). The tasks file is the canonical state and always lives in the **main checkout** (worktrees run code
only). Paths shown elsewhere as `docs/flow/...` are `FLOW_ROOT` made concrete — substitute the pinned root.

---

## State machine

```
[0] RESUME CHECK
[1] PLAN PHASE
    [1a] Adaptive depth proposal
    [1a′] Agent-atlas seam — route any LLM-over-data build to Station-0 (advisory)
    [1b] Run depth chain (brainstorm → optional grill → plan)
    [1c] Plan-review convergence loop (max 5 cycles)
    [1d] Plan approval gate
[2] DECOMPOSE PHASE
    [2a] Invoke plan-to-tasks
    [2b] Ensure resume trigger (stateless)
    [2c] Task list approval gate
    [2d] Run to completion (no self-termination; no turn ending on a promise)
    [2d′] Autonomy heartbeat (self-derived goal in state + ScheduleWakeup every turn)
[3] EXECUTE PHASE — for each unticked task:
    [3a] Create worktree
    [3b] Write code (subagent-driven-development)
    [3c] Code-review convergence loop (max 3 cycles; 5 for doc/prose)
    [3d] Open PR (pr-create)
    [3e] Update tasks file
    [3e′] Stack-drift review (every 3rd task)
    [3f] Continue-or-pause prompt
[4] DONE
```

### [0] Resume check

Before anything else — including any clarifying question — discover whether there's an active flow to resume. **State lives on disk in the tasks file, never in memory.** From the project root (`main`, not a worktree), the first action is the scan:

```bash
grep -l '^Status: in_progress' docs/flow/plans/*-tasks.md 2>/dev/null | sort
```

(Scans `FLOW_ROOT/plans/` — the default `docs/flow/plans/`; if the repo pins a different `FLOW_ROOT`, scan there.)

- **Zero hits** → no active flow. Treat as a fresh request; skip to `[1]`.
- **Any hit whose front matter carries `Autonomy: granted`** → after routing below, re-arm the heartbeat per `[2d′]` before the turn ends (a resume after compaction/handoff must not leave the flow heartbeat-less).
- **One hit** → open it. **If its front matter carries `Kind: initiative`, this is a Heavy initiative — resume via [Heavy depth — governed initiatives](#heavy-depth--governed-initiatives), not the task path below.** Otherwise it is a plain tasks file (Light/Medium, or a Heavy per-issue file): find the first unticked task `X`:
  - Worktree for `X` exists but no `PR:` line recorded → **interrupted**. Prompt:
    > "Task X (`<title>`) was started but not finished. The worktree at `<path>` still exists.
    > Resume that worktree, or restart task X clean (deletes worktree)?"
  - Else → **clean pause**. Prompt:
    > "Resuming `<plan title>` at Task X (Y of N). Continue?"
  - Branch on the answer: Continue → jump to `[3]` at X · Restart clean → delete the worktree, jump to `[3a]` at X · Cancel → exit.
- **More than one hit** → do NOT auto-pick. First fold away noise: a hit whose front matter carries `Parent: <initiative>` is a Heavy initiative's active child, not a standalone flow — show it under its parent initiative, never as its own line. Then list each remaining file as `path · plan date · Current n/N · first unticked task`, sorted by the `YYYY-MM-DD` filename prefix (never mtime — checkouts and worktree ops touch it), and ask which to resume.

The scan runs as `[0]`'s first action, so its result is **foreground tool output** — resume never depends on a background-context memory entry being noticed. A shelved flow carries `Status: parked` and is deliberately excluded from the scan; only an explicit "shelve this" writes that.

### [1] PLAN PHASE

#### [1a] Adaptive depth proposal

Based on the user's brief, propose one of three depths. Default to **Medium** when uncertain.

**Heuristics (tie-breakers, not hard rules):**

| Signal | Light | Medium | Heavy |
|---|---|---|---|
| Verb | fix, rename, tweak, adjust, hotfix | add, build, implement, wire | design, architect, migrate, platform, system |
| File count mentioned | 1 file | 2-5 files | 6+ files / new module |
| Brief length | < 80 chars | 80-500 chars | > 500 chars / multiple paragraphs |
| Subsystems mentioned | 1 | 1-2 | 3+ |

**What actually makes it Heavy — not raw size.** Heavy is for *structural uncertainty* (novel
architecture, a greenfield module) or *multi-owner async* work you decompose into separately-grabbable
issues because different people or sessions will pick them up. A large but coherent single-owner change
— many files, one clear shape, one person shipping the stack — is **Medium with many tasks**, not
Heavy: it wants one tasks file and one PR per task, not a PRD and an issue tracker. Reach for Heavy only
when the decomposition itself is the deliverable (issues others grab) or the design is genuinely
unsettled. The file-count and subsystem rows above are the weakest signal — do not pick Heavy on size alone.

**Depth → skill chain:**

- **Light:** `superpowers:brainstorming` → `superpowers:writing-plans`
- **Medium:** `superpowers:brainstorming` → `mattpocock-skills:grilling` → `superpowers:writing-plans`
- **Heavy:** `superpowers:brainstorming` → `mattpocock-skills:grilling` + `mattpocock-skills:domain-modeling` (invoke both before the interview starts, so the glossary and ADRs update as decisions land) → `write-a-prd` → `prd-to-issues` → **[Heavy depth — governed initiatives](#heavy-depth--governed-initiatives)** (flow files the issues to a user-chosen substrate, then runs each through the full `[3]` execute phase)

Present the proposal:

> "Based on your brief, I'd run this as **<Depth>** depth: `<chain>`. Override? [light / medium / heavy / accept]"

Wait for an explicit answer.

#### [1a′] Agent-atlas seam — does an LLM make a judgment over data?

Before running the depth chain, check the brief for **any LLM that will make a judgment over data** — generate, summarize, narrate, classify, extract, score, or decide — whose output something or someone downstream relies on. A loop+tools+memory or multi-agent build always qualifies; **so does a single LLM call** (the common case: an LLM narrating / summarizing computed or provided data). If there is one, **invoke `agent-atlas:agentic-dev` first** — let it run its Station-0 triage (is it even agentic? is it rigor-free? at what depth? which stations / off-ramp checks apply?), then **read the stations triage marks applicable and carry each one's must-address checklist into the plan** (open the docs — don't just name them or paraphrase the `00` router). That framing drives the plan the depth chain then writes.

- **Delegate proportionality to the atlas; don't pre-judge it here.** Do **not** filter out single-call work — the atlas's Station-0 *off-ramp* is the canonical place that decides *rigor-free → exit (in seconds)* vs *a deterministic/LLM boundary → pull the relevant slice (golden-case the computation · enforce the shape · ground the claims)*. Flow routes the LLM-bearing build there; it does not decide rigor itself.
- **Only skip** a *pure mechanical reformat with no data-judgment* (e.g. "uppercase this", "pretty-print this JSON") — no boundary, nothing to ground.
- **The walk of *applicable* stations is mandatory, not advisory.** Read each station Station-0 marks applicable and surface its real must-address checklist into the plan — naming the stations or paraphrasing the `00` router is **not** a walk (it produces confident-looking theater that passes review while the architecture/evals/production content is skipped). Proportionality still holds: "applicable" is the off-ramp's call and may be **zero** (a clean exit) or a single slice. Graceful **no-op if `agent-atlas` isn't installed** (proceed straight to [1b]).
- Rationale: a single call over computed/provided data still has a deterministic/LLM boundary — the computation can be confidently wrong, and the output's claims must ground to the data — exactly what a "single-call, done" pre-filter discards. Routing it to Station-0 surfaces those (plus "should this even be an agent? will it evolve?") *before* the plan is written.
- **Autonomy caveat:** this seam fires even when the user is away, and a forced walk raises the floor for an absent builder — but auto-invocation can't substitute for human judgment on the hard architecture/evals calls. For high-stakes design, invoke `agentic-dev` yourself, present and engaged.

#### [1b] Run depth chain

Invoke the chosen skills via the Skill tool, in order. Each writes its output under `FLOW_ROOT` (`FLOW_ROOT/specs/...` for brainstorming, `FLOW_ROOT/plans/...` for plans, `FLOW_ROOT/prds/...` for write-a-prd).

The final artifact going into the plan-review loop is the plan file at:
```
FLOW_ROOT/plans/YYYY-MM-DD-<topic>.md
```

For **Heavy** depth, `prd-to-issues` produces the issue set; flow then files it to the user-chosen substrate and drives each issue through the full `[3]` execute phase — worktree, SDD, the three-reviewer `[3c]`, PR, gates — under one governed umbrella it owns. See [Heavy depth — governed initiatives](#heavy-depth--governed-initiatives). It is NOT a lighter nested flow that re-picks its own depth or drops `[3c]`.

#### [1c] Plan-review convergence loop

**Walk-fidelity precheck (if [1a′] fired):** before the review loop, confirm the plan carries each *applicable* station's own must-address checklist with every item `addressed → <pointer to a plan section / file / decision>` or `deferred → <reason>` — **not** a paraphrase of the `00` router (a "station mapping" that restates `00` is the theater this guards against). If it's missing or paraphrased, send the plan back to [1b] to actually walk the stations before reviewing.

Delegate to `flow:agents-review`:

```
Skill: flow:agents-review
Args:
  target:      {PLAN_PATH}
  kind:        plan
  brief:       <1-3 sentence summary of the user's request>
  design_path: {DESIGN_PATH}   # path to brainstorming spec if one exists, else omit
  premortem:   true            # adds flow:premortem as a 4th reviewer, cycle 1 only
  # max_cycles defaults to 5 for kind=plan
  # auto_fix defaults to true
```

`agents-review` runs up to 5 cycles, dispatching `/codex-review`, `/cursor-review`, and `flow:requesting-plan-review` in parallel each cycle — plus, in the **first cycle only**, a `flow:premortem` pass (an Opus "assume this plan shipped and failed" analysis). It converges on zero criticals (any cycle, including cycle 1); premortem findings are triaged like any other reviewer's — only criticals force a fix + re-review cycle; importants are fixed at convergence without reopening the loop, and minors are listed rather than applied. At the cap it asks the user (accept / push one more / manual rework).

Receive the return payload (`status`, `cycles_run`, `final_verdicts`, `fixes_applied`, `remaining_issues`). Use that to brief the user at the next gate.

#### [1d] Plan approval gate

After convergence (or accepted cap), summarize the plan to the user and ask explicitly:

> "Plan is at `<path>`. Convergence: cycle <n>/5. Approve and proceed to decomposition?"

Include in the gate summary: important findings applied at convergence, any the orchestrator declined to apply with the one-line reason, and a one-line count of the `minor` findings that were listed but not applied (from `fixes_applied` / `remaining_issues`) — the user judges all of those here, and minors now reach them only through this line.

Wait for `yes`. If `no`, ask what's wrong, edit, ask again.

### [2] DECOMPOSE PHASE

#### [2a] Invoke plan-to-tasks

If the plan is large enough to be more than one task (multiple acceptance criteria sets, multiple distinct vertical slices), invoke `plan-to-tasks` with `{PLAN_PATH}` and `{BRIEF}`. Output goes next to the plan under `FLOW_ROOT/plans/<plan>-tasks.md`.

If the plan is a single task, skip `plan-to-tasks` and synthesize a one-task file inline with the same format.

#### [2b] Ensure the resume trigger exists

State lives in the tasks file — `[0]` finds it by scanning. Memory holds NO state, only a one-line **trigger** so a fresh session routes a "continue where we left off" request into this skill. Write it once, only if absent, and never update it again:

```markdown
---
name: active-flow
description: If work resumes on an existing initiative, invoke flow:flow — its [0] scan finds the active tasks file
metadata:
  type: project
---
If work resumes on an existing initiative, invoke `flow:flow`; its `[0]` scan of the flow tasks files finds the active one. This entry holds no state — the tasks file is the single source of truth.
```

Append a `MEMORY.md` pointer if one exists. Do **not** write plan paths, task numbers, or a status here — those live in the tasks file, and a second copy only drifts.

#### [2c] Task list approval gate

Show the task list (titles + branch slugs + dependency graph) and ask:

> "Decomposed into <N> tasks. Ready to start Task 1 (`<title>`)?"

Wait for `yes`. If `no`, ask what to revise; edit the tasks file; ask again.

#### [2d] Run to completion

**A flow runs to completion. Nothing about session length justifies stopping on your own.** When the
user has asked to work autonomously / to completion / "ship all the PRs", execute EVERY buildable task
through its PR without pausing. Do NOT split "plan in session 1, execute later"; do NOT stop at N tasks.

**You have ample context remaining. Do not stop, summarize, or suggest a new session on account of
context limits.** The harness compacts and continues on its own; a countdown in your context is not a
deadline and never a reason to park.

The tasks file is the durable state: if the harness itself hard-kills the session mid-task, the `[0]`
scan resumes cleanly from where it stopped — so a real interruption loses nothing and is not
something to preempt by stopping early. Parking early is the failure mode; it delivers nothing and
wastes the user's time.

The ONLY legitimate stops are: (1) the user explicitly says pause/shelve, (2) a `[3f]` prompt when
the user is present and NOT under an autonomy instruction, or (3) a genuinely unrecoverable error you
cannot work around. None of these is about budget.

**Heartbeat — the harness only runs you on a trigger.** A turn starts from the user, a background
task finishing, or a wakeup you scheduled. A hung subprocess never finishes, so under autonomy a
notification is NEVER your only wake signal: **before ending any turn that leaves background work
outstanding (reviewer CLI, implementer agent, CI poll), call `ScheduleWakeup` (≤ 20 min) with a
prompt that re-checks that work.** On wake, a task with no output past its expected duration is
inspected (read its log — e.g. codex's `Reading additional input from stdin...` means it hung),
killed and relaunched, never waited on further. A `/loop` the user started is the same heartbeat
from outside; when none is running, flow arms its own. (2026-08-22: a hung codex review with no
heartbeat idled a session for ~7 hours one step before a merge.)

**Before ending your turn, check your last paragraph.** If it is a plan, an analysis, a question, a
list of next steps, or a promise about work you have not done ("I'll…", "next I'll…"), do that work
now with tool calls. End the turn only when the task is complete or you are blocked on input only the
user can provide.

#### [2d′] Autonomy heartbeat — flow keeps itself alive

The harness runs you only on a trigger (user message, background task finishing, or a wakeup you
scheduled). When the user grants autonomy, **flow owns its own heartbeat** — it never depends on a
user-started `/loop` or on a notification arriving.

**Trigger.** Any autonomy grant in the conversation — "work autonomously", "don't stop", "run to
completion", "you can continue while I'm away", a `/goal` the user asks you to own, or the
initiative header's autonomy note. On the grant:

1. **Derive the goal yourself and write it down.** One line in the tasks file (or initiative file)
   front matter: `Goal: <what done looks like, from the plan's Goal line + the user's steer>` plus
   `Autonomy: granted <YYYY-MM-DD> — <what is waived: [1d]/[2c]/[3f]; what is NOT: owner decisions,
   merges>`. This is the loop's prompt source — the goal lives in state, never only in memory.
2. **Arm the heartbeat before ending EVERY turn** while the file is `Status: in_progress` and the
   user is not actively driving: call `ScheduleWakeup` with `prompt` =
   `flow heartbeat: <tasks-file path> — re-run [0]; inspect outstanding background tasks first
   (read their logs; a task silent past its expected duration is hung — kill + relaunch, never
   wait); then continue the state machine from the first unticked step; re-arm unless [4] DONE or
   the user paused`, and `delaySeconds` matched to what you wait on (CI/deploy: its real cadence;
   otherwise 1200–1800s fallback). If the harness shows a `/loop` tick ("Autonomous loop tick"),
   the user's loop is already the heartbeat — re-arm with the sentinel it asks for instead of a
   second loop; never run two.
3. **On wake:** `[0]` scan → background-task audit → continue. Blocked only on the user (owner
   decision, merge approval, account/quota)? `PushNotification` once per state, record the block
   in the tasks file, keep the heartbeat (a later tick re-checks cheaply).
4. **Stop the heartbeat only** at `[4]` DONE, on an explicit pause/shelve/stop from the user, or a
   genuinely unrecoverable error — `ScheduleWakeup stop`. A compaction or handoff does NOT stop it:
   re-arm on resume (`[0]` sees `Autonomy: granted` and the open steps).

Model-agnostic by construction: only `ScheduleWakeup` and `PushNotification` are used, both
available to every model that runs flow. The failure this prevents (2026-08-22): a reviewer CLI hung
silently, the session had no heartbeat, and it idled ~7 hours one step before a merge.

### [3] EXECUTE PHASE

For each unticked task in tasks-file order:

**Before starting each task, write its step checklist into the tasks file, unticked:**

```markdown
- [ ] 3a worktree · [ ] 3b SDD · [ ] 3c agents-review (3 reviewers, converged) · [ ] 3d pr-create · [ ] 3e ledger+pointer · [ ] 3f continue-or-pause
```

Tick each as you complete it. This is the whole point: **a skipped step must leave a visible
unticked box, not depend on you noticing its absence.** Todos tracked per *task* rather than per
*step* are what let one session ship 14 PRs with `[3c]` never once run — nothing in its working
state ever showed the step as outstanding. Do not tick `3d` while `3c` is unticked; do not tick the
task's top-level checkbox while any box remains.

Re-reading `flow` mid-session is NOT the safeguard and never has been — no session on record has
ever done it, adherent or otherwise. The checklist is the safeguard.

#### [3a] Create worktree

Invoke `superpowers:using-git-worktrees`. Branch name: `lt/<task-slug>` from the task file.

**Branching base:**
- Task with no dependencies → branch from the project's base branch (`main` or `master`).
- Task with `Depends on: Task K` → branch from `lt/<task-K-slug>` (the predecessor's branch).
- After worktree is created, write the path into the task's `Worktree:` field and set `Status: in_progress`.

#### [3b] Write code

Invoke `superpowers:subagent-driven-development`, feeding it the relevant section of the plan file and the task's acceptance criteria — **for its implementer mechanics only. Instruct it to skip ALL of its internal review seats**: the per-task spec/quality review, scoped re-reviews, and the final whole-branch review. Under flow, `[3c]` is the one and only code-review gate — it runs the full 3-reviewer loop on the same diff immediately after, so every SDD review seat is a duplicate of one panel member minutes earlier, at full cost and with no added protection (owner ruling, 2026-08-28). Fix rounds happen only from `[3c]` findings, by resuming the implementer. When the implementer returns DONE, proceed straight to `[3c]`.

**Hold the implementer to the acceptance criteria, and check them yourself before `[3c]`.**
A two-task control (a bare agent given only the title and the same acceptance criteria, no plan and
no reviewers) met **5/5 and 8/8** criteria where flow's own implementer met **2/5 and 7/8** — n=2,
so treat it as a prompt to check rather than a settled property, with better test and deploy coverage in both. Roughly half of what
`[3c]` then found was repairing damage this phase introduced. A criteria check here is far cheaper
than a review cycle — and `[3c]` is not a substitute for an implementer that met the spec.

**Record the implementing agent's raw `agentId`** from its spawn result (the last agent to touch the diff, if SDD used several). `[3c]` passes it to `agents-review` so fix rounds resume that agent — which still holds the worktree and the diff — instead of paying a fresh agent's re-discovery cost every round. Record the raw id, never a name: names are latest-wins and a newer agent would silently receive the fix list.

⚠️ **SDD's text will try to re-add its review seats — don't let it.** You are about to read a long,
concrete skill with its own reviewer, its own fix rounds and its own ledger, and it will feel like
the operative process — while the skip instruction above is one sentence. That asymmetry is how a
governing rule gets displaced by a subordinate one: dispatch SDD's implementer, dispatch NO reviewer
of any kind from SDD's playbook, and when the implementer returns DONE the very next thing you do is
`[3c]` — not `[3d]`, and not an SDD review seat.

#### [3c] Code-review convergence loop

Compute git SHAs in the worktree:
```bash
cd <worktree>
BASE_SHA=$(git merge-base HEAD <base-branch>)
HEAD_SHA=$(git rev-parse HEAD)
```

Delegate to `flow:agents-review`:

```
Skill: flow:agents-review
Args:
  target:  "BASE..HEAD" (or "--worktree <path>")
  kind:    code
  brief:   <the task's title + acceptance criteria, condensed to 1-3 sentences>
  implementer_agent_id: <raw agentId recorded at [3b]>
  # max_cycles defaults to 3 for kind=code (pass 5 when the diff is mainly docs/prose)
  # auto_fix defaults to true
```

`agents-review` runs up to 3 cycles (5 for doc/prose diffs), dispatching `/codex-review`, `/cursor-review`, and `superpowers:requesting-code-review` in parallel each cycle, applying fixes by resuming the implementer inside the worktree (falling back to a fresh fix subagent when it is unreachable or its context is spent), and either converging or capping. At the cap it asks the user (open PR anyway / push one more / manual rework).

Receive the return payload and use it to brief the user when opening the PR.

#### [3d] Open PR

After convergence (or accepted cap), invoke `pr-create` inside the worktree. The skill has been edited to skip any Jira / issue-ID prompt.

If the task has a `Depends on:` link, append a line to the PR body:
> *Depends on #<prev-PR-number> (`<prev-branch>`).*

#### [3e] Update tasks file

- Tick the task's top-level checkbox: `[ ]` → `[x]`.
- Append to the task block:
  - `- **PR:** <url>`
  - `- **Completed:** <YYYY-MM-DD>`
  - `- **Review cycles:** <n> / <cap>`
  - `- **Review log:** <one line per cycle from agents-review's cycle_log, including the per-reviewer breakdown — e.g. "c1: 1 crit / 3 imp / 4 minor, 5 fixes changed code [codex 1/2/1, cursor 0/1/2, code-reviewer 0/0/1]; c2: 0 crit / 1 imp / 2 minor, 1 fix [codex 0/0/1, cursor failed, code-reviewer 0/1/1]">` — telemetry for tuning caps on evidence. **Write the per-reviewer numbers, not just the totals:** they are what later answers whether a reviewer that approved in one cycle ever finds a critical in the next, which decides if cycles 2+ can skip re-running reviewers that already approved. `cycle_log` dies with the session; the tasks file is where it accumulates.
- Advance the top-level `Current:` to the next unticked task.

The tasks-file edits above are the whole of state maintenance — there is no memory status to update.

**Stacked-stack integrity check** (only when this task branched off a predecessor). Before ticking,
confirm the branch actually contains its predecessor's tip:

```bash
git merge-base --is-ancestor <predecessor-branch> HEAD || echo STALE
```

If it is stale, sweep forward in dependency order **now** — never leave it for later. Every fix that
lands on a lower branch re-stales every link above it, so drift compounds silently: one stack reached
30 commits of drift with a security fix stranded below the tip and reported as done.

After each merge-forward, **grep for the specific predicate each prior fix introduced**. A
clean-looking merge can be half-broken: git once resolved a rename-vs-modify conflict "the obvious
way" (a function MOVED to a new file on one side, MODIFIED in place on the other) and silently
reverted a security predicate. "No conflicts" is not evidence.

**Never rebase a published stack** — those branches carry review history; a rebase rewrites published
commits, invalidates every review and force-pushes N PRs. Merge forward.

#### [3e′] Stack-drift review (cadence-gated)

`[3c]` reviews **one task's diff**. Nothing in the loop ever looks at the stack as a whole, so
drift between tasks is structurally invisible to every individual review: inconsistent data shapes
or contracts across tasks, divergent naming for the same concept, duplicated or conflicting logic,
dead code left behind when a later task superseded an earlier one.

Run it when the stack is **3 or more stacked tasks deep** — after every 3rd completed task from
that point, and always before the last task's PR. Review the *accumulated* diff of the tip branch vs
the base branch, not each task in isolation:

**Measured:** across 8 drift reviews in two weeks, all 5 of their criticals — and 12 of 14
uncatchable crit/important findings — came from the four multi-PR stacks. Four of the eight found
nothing a single-task review could not. Depth of the stack, not a task counter, is what predicts
yield.

```bash
cd <current worktree>
git diff <base-branch>...HEAD
```

Delegate to `flow:agents-review` with `kind=code`, `mode=review`, and a brief naming the tasks in
the stack. Findings are **top priority**: fix them before starting the next task, because every task
built on a drifted contract multiplies the fix. A finding that spans tasks already merged into
lower branches goes to the lowest branch that owns it, then sweep forward per `[3e]`.

Skip when the stack is fewer than 3 tasks deep — there is little or no cross-task surface to drift. (The "always before the last task's PR" run above applies only once the stack has reached that depth.)

#### [3f] Continue-or-pause prompt

Notify the user and ask:

> "✅ PR opened: <url>. Tasks: <n>/<N> done. Continue with Task <n+1> (`<title>`) in a new worktree, or pause?"

- **Continue** → loop back to `[3a]` with the next task.
- **Pause** → exit. The tasks file keeps `Status: in_progress`, so the `[0]` scan finds it on resume. (Pause ≠ park: only an explicit "shelve this" writes `Status: parked`.)

### [4] DONE

When the last task is ticked:

1. Set the tasks file's top-level `Status: done` — this drops it from the `[0]` resume scan.
2. Summarize:
   > "🎉 All <N> tasks shipped.
   > PRs:
   >  - Task 1: <url>
   >  - Task 2: <url>
   >  - ...
   > Plan: <plan path>. Tasks file: <tasks path>."

Exit.

---

## Heavy depth — governed initiatives

Heavy is the only depth that decomposes into **separately-grabbable issues** instead of a single tasks
file — the *set of issues* is the deliverable, often for other people or sessions to pick up. That is
exactly where flow historically let go of the wheel: it filed the issues, then ran each as an
improvised lighter pass and forgot its own state machine. It must not. flow stays the conductor across
the whole set; the linear `[2]`/`[3]` phases still do the work per issue, and this section governs the
umbrella around them. **This overlay applies to Heavy only — Light and Medium never reach it.**

### H1 — Choose the issue substrate (gate)

After `prd-to-issues` produces the issue set, ask where the issues live:

> "Heavy initiative: file these <N> issues **locally** (a governed initiative file), or in a **remote
> tracker** (e.g. GitHub via `gh`) so others can grab them? [local / remote]"

The choice sets where *status* lives. It is a gate — wait for the answer.

### H2 — Write the umbrella (flow's state)

Both modes write one initiative file under `FLOW_ROOT/plans/<YYYY-MM-DD>-<feature>-initiative.md`
carrying `Status: in_progress` and `Kind: initiative` (so `[0]`'s scan finds it and routes here). It is
the single umbrella `[0]` resumes.

**Local mode — the file IS the state:**
```markdown
---
Status: in_progress
Kind: initiative
Current: 0/<N>
---
# <feature> — initiative
- [ ] 1. <issue title> · tasks: <unset until picked>
- [ ] 2. <issue title> · Depends on: 1
```

**Remote mode — the tracker is the source of truth for status; the file is a thin pointer:**
```markdown
---
Status: in_progress
Kind: initiative
Tracker: github:<owner>/<repo>
Current: 0/<N>
---
# <feature> — initiative
- #<n> · <issue title> · tasks: <unset until picked>
```
Create the tracker issues now, with self-contained bodies (see `prd-to-issues` — never a pointer to a
local planning doc). Record each issue id in the pointer. **Do not copy open/closed status into the
pointer as authority** — the tracker owns it.

### H3 — Execute each issue through the full `[3]`

Walk the issues in dependency order. For each:
- Run `superpowers:writing-plans` for that issue, then `plan-to-tasks` → a normal per-issue tasks file
  (identical format to Medium's), adding `Parent: <initiative path>` and, in remote mode, `Issue: #<n>`.
  The `Parent:` line is what folds this file out of `[0]`'s multi-hit list.
- Run the **entire `[3]` execute phase** on it — `[3a]` worktree, `[3b]` SDD, `[3c]` the three-reviewer
  convergence loop, `[3d]` PR, `[3e]` tasks-file update, `[3f]` gate. Same gates, same steps. An issue is
  not a "smaller" unit that earns a lighter review; `[3c]` runs on every issue's diff.
- On ship: local mode ticks the issue's row and bumps `Current:`; remote mode closes/labels the tracker
  issue (the tracker is authority) and refreshes the pointer's `Current:` from the tracker, not a local tally.

### H4 — Resume (`[0]` routed here on `Kind: initiative`)

- **Local mode:** the initiative file is authoritative. Find the first unticked issue and resume its
  per-issue tasks file exactly as `[0]`'s one-hit path does.
- **Remote mode:** the local pointer may be stale — a teammate may have grabbed or closed an issue.
  **Re-read the issue set's state from the tracker first**, reconcile the pointer, and if anything
  diverged, surface it and confirm before continuing:
  > "Initiative <feature>: since last session, #<a> was closed and #<b> assigned to <someone>. Resume at
  > #<c> (next open, unassigned)?"

  Never resume an issue the tracker shows closed or owned by someone else on the strength of a stale local row.

When every issue is shipped (all rows ticked / all tracker issues closed), set the initiative file
`Status: done` and run `[4]`.

---

## Reviewer-loop details: see `flow:agents-review`

The convergence loop, verdict schema, parallel-dispatch pattern, and cap behavior all live in the `flow:agents-review` skill. `flow` just calls it twice — once with `kind=plan` at [1c], once with `kind=code` at [3c]. If you find yourself wanting to know "what exactly happens during a review cycle", read the `agents-review` SKILL.md.

`agents-review` returns a JSON payload (`status`, `cycles_run`, `final_verdicts`, `fixes_applied`, `remaining_issues`) plus a short prose summary. `flow` uses both: the prose for user-facing gates, the JSON for downstream decisions (e.g. should the PR description note that the cap was reached and there are unresolved important issues).

---

## Hand-off cheat sheet

| State machine step | Skill / tool invoked |
|---|---|
| [0] resume check | (inline — `grep '^Status: in_progress'` over `FLOW_ROOT/plans/*-tasks.md`) |
| [1a′] agent-atlas seam | `Skill: agent-atlas:agentic-dev` (advisory; any LLM-judgment-over-data build incl. single-call; skip only a pure mechanical reformat; no-op if not installed) |
| [1b] light/medium/heavy entry | `Skill: superpowers:brainstorming` |
| [1b] medium stress-test | `Skill: mattpocock-skills:grilling` |
| [1b] heavy stress-test | `Skill: mattpocock-skills:grilling`, `Skill: mattpocock-skills:domain-modeling` |
| [1b] heavy PRD | `Skill: write-a-prd`, `Skill: prd-to-issues` |
| [1b] heavy governance | see [Heavy depth — governed initiatives](#heavy-depth--governed-initiatives) (substrate gate + umbrella file + per-issue full [3]) |
| [1b] plan write | `Skill: superpowers:writing-plans` |
| [1c] plan review loop | `Skill: flow:agents-review` (kind=plan, cap 5) |
| [2a] decompose | `Skill: flow:plan-to-tasks` |
| [2b] resume trigger | (inline — one-line memory, only if absent) |
| [2d] run to completion | (inline — no self-termination; check the last paragraph before ending a turn) |
| [2d′] autonomy heartbeat | (inline — `ScheduleWakeup` every turn with the goal-bearing prompt; `PushNotification` when blocked on the user; stop only at [4]/pause) |
| [3a] worktree | `Skill: superpowers:using-git-worktrees` |
| [3b] code write | `Skill: superpowers:subagent-driven-development` |
| [3c] code review loop | `Skill: flow:agents-review` (kind=code, cap 3; 5 for doc/prose) |
| [3d] PR open | `Skill: pr-create` |
| [3e] tasks file update | (inline — Edit on tasks file) |
| [3e′] stack-drift review | `Skill: flow:agents-review` (kind=code, mode=review; every 3rd task) |

---

## Anti-patterns

- ❌ Skipping the plan-review loop because "the plan looks fine to me."
- ❌ **Opening a PR at `[3d]` without `[3c]` having converged on that exact diff.** The #1 historical failure of this skill: 14 PRs once shipped unreviewed because a waiver of `[3f]` was read as a waiver of `[3c]`. 38% of that session went on redoing the review — and because the review was deferred, every fix then landed on a *lower* branch and silently staled the whole stack (one branch ended 30 commits behind its predecessor, with a security fix stranded below the tip).
- ❌ **Shipping any task without at least one adversarial review pass.** In both control runs the
  bare-agent implementation passed lint, typecheck and every test, and still shipped a defect no
  automated check could see — one endpoint that never once reached the vendor, one staging path that
  marked every captured lead `sent` while delivering nothing. That class of defect is exactly and
  only what an adversarial reader catches. This is the floor; nothing waives it.
- ❌ **Treating a doc-only or "trivial" task as exempt from `[3c]`.** In that same issue the doc-only PR's review found ~30 real findings, two of which would have caused code defects — a glossary defining a state as its opposite, and an ERD asserting a constraint the ADR forbids.
- ❌ Inlining the parallel review dispatch instead of invoking `flow:agents-review`. The loop primitive lives there.
- ❌ Inlining brainstorming / planning / writing instead of invoking the skill for it.
- ❌ Marking a task `[x]` before its PR is open.
- ❌ Auto-continuing to the next task without the continue-or-pause prompt.
- ❌ Editing the plan file outside of the plan-review loop. After approval, the plan is frozen; further changes go in PRs.
- ❌ Recording flow status anywhere but the tasks file — a status line in memory or a second file only drifts from the tasks file, which is the single source `[0]` scans.
- ❌ Letting the authoritative tasks file live in a worktree. It belongs in the main checkout under `FLOW_ROOT/plans/`; a worktree copy is a stale island the `[0]` scan won't (and shouldn't) find.
- ❌ **Heavy handing off to the issue tool and forgetting flow** — filing the issues, then running each as a lighter nested pass that re-picks its depth or skips `[3c]`. Heavy files issues *and* drives each through the full `[3]` under a governed initiative file that is flow's, not the tracker's.
- ❌ **Trusting a stale local status over a remote tracker.** In remote mode the tracker owns issue status; resume re-reads it and reconciles before continuing.
