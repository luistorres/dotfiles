---
name: agents-review
description: Run a 3-agent parallel review of a plan file or a code diff, iterate with fixes until the reviewers converge or a cycle cap is hit. Use when you want a high-confidence verdict on a plan or PR — invoke standalone for ad-hoc reviews, or it's called by `flow` at its plan-review and code-review phases. Dispatches /codex-review, /cursor-review, and the matching superpowers review subagent in a single parallel batch each cycle.
---

# agents-review — convergence loop primitive

Run a triangulated review (Codex + Cursor + Opus) against a plan file or a code diff, applying fixes between cycles until all reviewers report no critical issues, or until the cycle cap is hit. Returns a verdict summary that the caller can act on.

**Why the panel works — it averages variance, not just model blind spots.** Measured on one diff: 7
runs of the *same* model with byte-identical prompts recalled 5–11 of 14 defects individually, and
**14/14 as a union**. Which defects any single pass misses is largely random. So the panel's main
job is drawing several samples, and three seats of the same calibre beats one seat run three times
only insofar as the models genuinely differ — which is a smaller effect than the sampling. The practical consequence is hard rule 5: a dead seat is better replaced by a second run
of a live one than by nothing, because a second sample of a live reviewer recovers much of what the
missing seat would have found.

Note what this does NOT say. A converged cycle 1 ends the loop (hard rule 3), so the extra samples
inside one cycle are the *seats*, not the cycles — three seats in cycle 1 is already three draws.
Cycle 2 exists for a different reason: it re-reviews a target that CHANGED, which is how it catches
a wrong cycle-1 fix. The caps in hard rule 2 come from measured yield per cycle, not from this.

This skill is the loop primitive that `flow` uses at [1c] and [3c]. It can also be invoked standalone — "review this plan", "run the 3-agent loop on this PR".

---

## Hard rules

1. **All reviewers run in parallel — dispatch them as tools, not as Skills.** A single message
   carries the two CLI reviewers as `Bash` calls and the third reviewer as a direct `Agent` call
   (plus, on a `kind=plan` cycle-1 loop with `premortem=true`, a 4th `Agent` call). Three reviewers
   normally; four on that one cycle. Never serially.

   **Why not `Skill:`.** Invoking `Skill: flow:requesting-plan-review` does not dispatch a reviewer —
   it loads that skill's instructions into your context, and the actual `Agent` dispatch then happens
   in your *next* message. So a batch built from Skill calls is structurally serial: the CLI reviewers
   run while the third has not started. Read the template file and dispatch the `Agent` yourself, in
   the same message as the Bash calls. The `requesting-plan-review` and `premortem` skills remain for
   standalone invocation, where the extra hop costs nothing.
2. **Cycle caps are hard limits.** Plan default = **5**, code default = **3** (doc/prose diffs keep 5). At the cap, stop and report — do not silently iterate further.

   **Measured, 2 weeks / 47 code loops / 13 plan loops.** Code: 72% converge at cycle 1, 87% by cycle 2, and cycles 3+ produced **zero** criticals on code diffs — hence 3, not 5. The exception is doc/prose work, the only place a cycle-4 or -5 critical ever appeared (one plan-text loop raised criticals at c2, c3, c4 and went clean only at c5), so those keep 5. Plan review is the opposite problem: **9 of 13 plan loops never converged inside the old 3-cap** and shipped cycle-3 fixes with no verifying cycle — one ran 15 cycles and was still finding criticals at c14. Raising the plan cap to 5 closes a gate that was silently failing, it does not loosen one. **A cap does not rescue a pathological loop** — the 15-cycle case would not have converged at 5 either, and its real tell was that it applied ~60 findings with **zero declined**. A loop that never disagrees with a reviewer is not converging, it is being rewritten; surface that at the cap rather than raising it again.
3. **Convergence requires zero critical — every cycle, including cycle 1.** A cycle converges iff there are zero critical/blocker findings across all reviewers. `important` findings never block convergence or trigger a new review cycle: apply the ones you agree with at convergence (see 1c), and surface the full list — plus any you declined, with why — to the caller/approval gate.
4. **Critical-driven fixes apply between cycles, then re-review.** When criticals force another cycle, never carry cycle N's fixes forward without re-running the reviewers in cycle N+1. (Important fixes applied at convergence are exempt — they do not reopen the loop. Minors are listed, not applied; see Step 1c.)
5. **A failed CLI reviewer is replaced by `opencode-review`, not skipped.** When `codex-review` or `cursor-review` fails — quota exhausted, token limit, subscription error, timeout — rerun the *same* brief through `opencode-review` (`~/.claude/skills/opencode-review/SKILL.md`; `opencode run --agent plan -m opencode/muse-spark-1.2-contributor-free`) and use its verdict in that slot, naming the substitution in the cycle summary. If the substitute also fails, **re-run a live seat a second time with the same brief and count it as a separate verdict**, naming it as a re-run in the cycle summary — do not simply proceed short-handed. **The in-process reviewer is different:** if IT fails, proceed without it — never substitute a CLI for it, and never substitute a second in-process pass for a failed CLI seat.

   **Why a re-run is a real seat, not a consolation prize.** Measured on one diff, 7 runs of the *same* model with byte-identical prompts: individual recall was 5, 6, 8, 8 and 6, 8, 9, 11 out of 14 — no single run above 11 — while the **union of the runs was 14/14**. Which defects a run misses is largely random, so a second sample of a live reviewer recovers much of what a dead seat would have contributed. Two thirds of loops in the corpus ran short-handed on quota and nobody ever re-ran them.
6. **Never accept "this is already covered" from a fix agent.** Verify it — run the named test, or revert the fix and watch a *specific* test fail. That claim has been made twice and was false twice, and both times the untested thing was the exact defect the fix existed to close.
7. **Green is not evidence — apply both blind-spot lenses before accepting a clean cycle.** A cycle
   where every reviewer approves is exactly when these earn their keep. Pass them to the `kind`-appropriate
   third reviewer at [1a] and to the verify agent at [R3]:
   - **Ask what the verifier structurally cannot see.** For each check that passes, name the class of
     failure it is blind to. A browser test driving synthetic key events cannot notice a keyboard has
     no numpad; a fuzzer that never starts the server cannot see a bug in joining. The gap between
     "the test passes" and "the behavior is right" is where the surviving bugs live.
   - **Sabotage-test the safety nets.** For any check, invariant, or lint rule this diff *adds*: break
     the thing it guards, confirm it fails, restore. A check nobody has watched fail is not yet a
     check — it is an assertion that it exists. This is cheap and it repeatedly catches guards wired
     to the wrong condition.
8. **A thin verdict is not an approval — but a clean cycle is.** A reviewer counts as *failed*
   (Hard rule 5) only when its output is empty, errored, or shows no evidence of having read the
   target: no file, line, or section references. A structured verdict that engages with the target and
   reports nothing critical is a genuine approval — and convergence at any cycle is exactly that.
   Never treat a converged cycle as a reviewer failure; that would make the loop non-terminating.
   Under-reporting is a real failure mode of a reviewer given conservative instructions, so judge the
   engagement, not the length.
9. **Check every fix instruction against the ADR that owns the rule BEFORE issuing it.** A fix instruction is a claim about the design and gets the same scrutiny as a reviewer's finding. Three fix instructions in one review pass contradicted ADRs; one shipped a consent defect that permanently barred a data subject from ever consenting — and it violated a distinction the orchestrator had itself written into the glossary two PRs earlier.

---

## Inputs

| Arg | Required | Description |
|---|---|---|
| `target` | yes | For `kind=plan`: absolute path to the plan file. For `kind=code`: a git SHA range string like `BASE..HEAD` or `--worktree <path>`, computed by the caller. |
| `kind` | yes | `plan` or `code`. Determines which 3rd reviewer is used and the default cycle cap. |
| `mode` | no | `converge` (default) or `review`. `converge` = the iterate-with-fixes loop (what `flow` uses). `review` = single read-only pass with batched adversarial verification, no fixes, no loop — for reviewing a PR you are not shipping (a colleague's PR, an ad-hoc check). See [Review mode](#review-mode-single-pass-read-only). |
| `brief` | yes | 1-3 sentence summary of what the work is supposed to do. Passed to all reviewers as context. |
| `design_path` | no | For `kind=plan`: path to the brainstorming spec, if one exists. Passed to `requesting-plan-review`. |
| `max_cycles` | no | Override the default cap. Default: 5 for `plan`, 3 for `code` (5 when the diff is mainly documentation or prose). Hard upper bound: 10 (don't go higher; if you need more, the work needs human judgement, not more cycles). |
| `auto_fix` | no | Default `true`. When `false`, skip fix application — return after the first cycle's verdicts so the caller can iterate manually. |
| `implementer_agent_id` | no | For `kind=code`: the raw `agentId` of the agent that produced the diff. Fix rounds resume that agent instead of spawning a fresh one, which skips the re-discovery cost (see [1d](#1d-apply-fixes)). Omit when there is no such agent (standalone review of someone else's work) and the fallback spawn is used. Pass the raw id, never a name — names are latest-wins. |
| `premortem` | no | Default `false`. When `true` AND `kind=plan`, dispatch `flow:premortem` as a 4th parallel reviewer in **cycle 1 only**. Ignored for `kind=code` and on cycles 2+. `flow` sets this at its plan-review phase. Premortem findings are triaged exactly like any other reviewer's — only criticals force a fix + re-review cycle; importants are folded in at convergence and minors are listed for the caller (Step 1c). Premortem output does **not** automatically force a cycle 2. |

---

## Outputs

Return to the caller:

```json
{
  "status": "converged" | "max_reached" | "user_stopped",
  "cycles_run": <n>,
  "cap": <max_cycles>,
  "final_verdicts": [
    { "reviewer": "...", "verdict": "...", "critical": [...], "important": [...], "minor": [...], "notes": "..." },
    { "reviewer": "...", ... },
    { "reviewer": "...", ... }
  ],
  "fixes_applied": [
    { "cycle": 1, "summary": "fixed X, Y, Z" },
    { "cycle": 2, "post_convergence": true, "summary": "..." }
  ],
  "cycle_log": [
    { "cycle": 1, "critical": 2, "important": 3, "minor": 4, "fixes_changing_target": 5,
      "reviewers": [
        { "reviewer": "codex",         "critical": 2, "important": 1, "minor": 1, "status": "ok" },
        { "reviewer": "cursor",        "critical": 0, "important": 1, "minor": 2, "status": "ok" },
        { "reviewer": "plan-reviewer", "critical": 0, "important": 1, "minor": 1, "status": "ok" }
      ] },
    { "cycle": 2, "critical": 0, "important": 1, "minor": 2, "fixes_changing_target": 1,
      "reviewers": [
        { "reviewer": "codex",         "critical": 0, "important": 0, "minor": 1, "status": "ok" },
        { "reviewer": "cursor",        "critical": 0, "important": 0, "minor": 0, "status": "failed" },
        { "reviewer": "plan-reviewer", "critical": 0, "important": 1, "minor": 1, "status": "ok" }
      ] }
  ],
  "remaining_issues": {
    "critical":  [...],
    "important": [...],
    "minor":     [...]
  }
}
```

Plus a short prose summary (1-3 sentences) suitable for showing the user: outcome, number of cycles, and what's left.

**Review mode (`mode=review`)** returns a flatter payload — no cycle accounting, no fixes:

```json
{
  "mode": "review",
  "findings": [
    { "title": "...", "file": "...", "line": <int|null>, "end_line": <int|null>,
      "severity": "blocker|high|medium|low|nit", "verdict": "confirmed|uncertain",
      "recommendation": "...", "scope": "inline|summary" }
  ],
  "dropped_false_positives": <n>
}
```

`findings` is already sorted by `severity` and deduped, and is the *only* author-facing content. `dropped_false_positives` is an internal count for the caller's telemetry — never posted to the PR. There is no "what's good" field by design.

`line` is a precise integer line number in the **head** revision (or `[line, end_line]` for a span), or `null` when the finding doesn't map to one changed line. `scope` is set during posting (see [R6](#r6--post-the-review-when-asked)): `inline` for findings whose line is present in the diff, `summary` for everything else.

---

## Process

**Mode routing:** if `mode=review`, skip Steps 0–3 and follow [Review mode](#review-mode-single-pass-read-only). Steps 0–3 below are the `mode=converge` path — the default, used by `flow`.

### Step 0 — pick the 3rd reviewer and the cycle cap

| `kind` | 3rd reviewer | Default cap |
|---|---|---|
| `plan` | `flow:requesting-plan-review` | 5 |
| `code` | `superpowers:requesting-code-review` | 3 (5 for doc/prose diffs) |

If `max_cycles` is provided, override the default.

**For `kind=code`, validate the target here, before any reviewer is dispatched.** Confirm the SHA
range actually contains the task's files (`git diff --name-only BASE..HEAD`). A range that does not
burns an entire cycle: in one recorded loop three of six "findings" were reviewers correctly
reporting that the subject of the task was missing from the diff they were handed.

When `kind=plan` and `premortem=true`, a 4th reviewer — `flow:premortem` — joins the parallel batch in **cycle 1 only** (see Step 1a). It never runs on `kind=code` or on cycles 2+.

### Step 1 — cycle loop

For `cycle in 1..max_cycles`:

#### 1a. Dispatch the reviewers IN PARALLEL

One message, three tool calls (four on a `kind=plan` cycle-1 loop with `premortem=true`). Write the
shared review prompt to a file first so both CLI calls can read it without duplication.

**For `kind=plan`:**
- `Bash` (background): `stdbuf -oL -eL codex exec --model gpt-6.1-sol --sandbox read-only -c model_reasoning_effort=high "$(< PROMPT)" > LOG 2>&1 < /dev/null` — see `codex-review`'s SKILL.md. **The `< /dev/null` is mandatory.** Without it `codex exec` blocks forever on `Reading additional input from stdin...` under a non-interactive shell; that is the hang `[2d′]`'s heartbeat exists to survive, and it is cheaper to prevent than to detect.
- `Bash` (background): `agent --print --trust --mode ask --model grok-4.7-high "$(< PROMPT)"` — see `cursor-review`'s SKILL.md, including its quota fallback chain.
- `Agent`: `subagent_type: flow:plan-reviewer`. The prompt carries only the per-run inputs — the plan path, the brief, and the design spec path if one exists. Its instructions, model (`opus`), effort (`xhigh`) and read-only tool set live in the agent definition; do not restate them, and do not invoke the skill.
- **Cycle 1 only, if `premortem=true`:** a 4th `Agent` call, `subagent_type: flow:premortem-reviewer`, same three inputs. Do **not** include it on cycles 2+.

**For `kind=code`:**
- `Bash` (background): the `codex-review` invocation inside the worktree (or against the SHA range) — with `> LOG 2>&1 < /dev/null`, same mandate as the plan branch above
- `Bash` (background): the `cursor-review` invocation inside the worktree
- `Agent`: `general-purpose`, prompt = the template at `superpowers:requesting-code-review`'s `code-reviewer.md` with `{BASE_SHA, HEAD_SHA, DESCRIPTION=brief, PLAN_OR_REQUIREMENTS=<plan section if available, else brief>}` substituted.

Background the Bash calls so the message returns immediately and all reviewers run concurrently; collect them as their notifications arrive.

If a CLI reviewer's log comes back as a quota/auth failure rather than a review, dispatch `opencode-review` with the same prompt file in its place (hard rule 5).

#### 1a′. Reject incomplete reviewer output BEFORE parsing

**This does NOT change what counts as an approval — hard rule 8 still governs that.** A verdict
without the `####` headings is still a verdict if it engages with the target; parse it with the
fallbacks in 1b.

What this step catches is a *truncated run*, which is a different thing: a CLI killed by a timeout,
a quota wall, or a stopped parent leaves a **tool trace** that ends mid-work and reads as a short,
calm review. Treat a log as a failed seat (hard rule 5) only when it shows the run did not finish:
it ends mid-tool-output, carries a quota/auth/usage error string, or contains no file or line
reference anywhere. A finished review that cites files and reports nothing critical is an approval,
headings or not.

#### 1b. Coerce verdicts

Each reviewer returns markdown. Parse into the verdict schema:

```json
{
  "reviewer": "...",
  "verdict": "approve" | "issues",
  "critical":  ["short, addressable item", ...],
  "important": [...],
  "minor":     [...],
  "notes":     "1-2 sentences"
}
```

**Normalize severity as you parse.** Reviewers calibrate differently — some suppress, some inflate —
so re-rate every finding against one definition before `1c` computes `all_critical`:

> **Critical** = executing this plan as written produces broken or wrong code; for a diff, merging it
> produces broken or wrong behavior. Everything else is important or minor.

Re-rating is the filter pass that lets reviewers report everything they find. Do not ask a reviewer to
be conservative to compensate — a suppressed finding is lost, an over-rated one is cheap to downgrade
here.

**Parsing strategy (in order, fall through on failure):**

1. **Structured headers** — look for `#### Critical`, `#### Important`, `#### Minor` sections. Parse each bullet into the corresponding array. This is what the `requesting-*-review` templates produce; CLI reviewers may or may not.
2. **Keyword scan** — if headers are absent, classify each finding sentence: contains "critical" / "must fix" / "bug" / "broken" / "data loss" → critical; "should" / "consider" / "missing" / "gap" → important; "minor" / "nit" / "style" / "polish" → minor.
3. **Last resort: classifier subagent** — dispatch a single small `Task(general-purpose)` call with the raw markdown and ask it to return JSON in the schema. Costs one extra turn; use only when the first two strategies clearly drift.

#### 1c. Decide

Compute across all reviewers that ran this cycle (three normally; four on a `kind=plan` cycle-1 loop with `premortem=true`):
- `all_critical = union(verdicts[*].critical)`
- `all_important = union(verdicts[*].important)`

Convergence rule (every cycle, including cycle 1):
- converged iff `all_critical == []`

If converged → **apply the `important` fixes you agree with before returning** (skip if `auto_fix=false`), using the same mechanics as 1d (inline Edit for `kind=plan`; resume the implementer for `kind=code`).

**Do NOT auto-apply `minor` findings.** List them for the caller and stop there; apply one only if the user asks. Measured over 2,283 attributed findings: a finding's reported severity predicts whether it is a real defect — **Critical 328/356 = 92% real, Important 507/906 = 56%, Minor 46/762 = 6%**. Of the minors that were actually applied, 583 were applied and 45 were real: ~538 fix-round items that changed the target for nothing. Importants are the opposite case and must keep being applied — dropping them would have discarded ~505 real defects.

No re-review afterwards — post-convergence fixes do not reopen the loop. Record them in `fixes_applied` as `{cycle: <n>, post_convergence: true, summary}`. Important findings you chose NOT to apply go in `remaining_issues` with a one-line reason each, so the caller can surface them (and your disagreements) at the approval gate. Then exit loop with `status: "converged"`.

If `cycle == max_cycles` and not converged → exit loop with `status: "max_reached"` (caller will prompt user; see Step 2).

Else → continue to fix application.

#### 1d. Apply fixes

Skip this step if `auto_fix=false` (return after cycle 1 instead).

Synthesize a **fix list** from `all_critical ∪ all_important`. Group related items, drop duplicates.

Apply fixes based on `kind`:

- **`kind=plan`:** **fixes are applied by something that already holds the context** — normally YOU, the orchestrator, editing `target` INLINE with the Edit tool. You hold the plan, the codebase facts, the reviewers' findings, and the prior cycles' fixes, which makes this the default and near-universal path for the whole fix set — clarifications, new sections, added tasks, and structural rewrites alike (a split into sub-plans is still your edit; reach for `Skill: superpowers:writing-plans` only when genuinely starting a plan over, not to apply review fixes).
  - **Never hand plan fixes to a FRESH subagent.** A new agent re-discovers the schema/codebase from scratch and re-derives context that already exists — expensive, slow (empirically ~10–15 min per round, turning a 3-cycle loop into ~50 min), and lower-fidelity. The cost is the re-discovery, not the delegation.
  - Delegating to an agent that *already holds* the context is fine — a resumed or long-lived agent carrying this plan's history, or a cheaper executor handed the full synthesized fix list plus verified symbols so it does not re-discover. Weigh it against the latency above; when unsure, apply inline yourself.

- **`kind=code`:** **resume the agent that wrote the diff** — `SendMessage` to the implementer's `agentId` (passed in as `implementer_agent_id`; see below for the fallback). It still holds the worktree, the diff, and its own reasoning, so it applies fixes with no re-discovery. Message: the fix list, and the constraint to make minimal targeted changes without scope-expanding. Wait for it to commit the fixes.
  - **Why resume rather than spawn.** A completed agent is not dead — a send resumes it from its transcript with context intact. Measured: a resumed agent recalled facts held only in its working memory and acted in seconds, whereas a fresh fix subagent re-reads `AGENTS.md`, re-explores the repo, and rebuilds a ~300k-token picture before touching code — empirically 14–25 min and ~400k uncached tokens per round.
  - **Address it by raw `agentId`, not by name.** Names are latest-wins, so a newer agent can steal the name and silently receive your fix list. Record the `agentId` from the spawn result at dispatch time and reuse that exact string.
  - **Fallback — spawn a fresh `Task(general-purpose)` fix subagent inside the worktree** when no implementer is reachable: standalone invocation with no `implementer_agent_id`, the implementer's context is near its limit (a long implement phase plus several fix rounds), or the resume errors. Prompt it with the fix list, the task description (brief), and the same minimal-change constraint. Prefer this over resuming when the earlier cycles have already left the implementer's context exhausted — a resumed agent that compacts mid-fix is worse than a clean one.

Append `{cycle: <n>, summary: "<one-line summary of what was fixed>"}` to `fixes_applied`.

Continue to next cycle (re-run reviewers against the now-updated target).

### Step 2 — handle cap

If `status == "max_reached"`, present remaining issues to the user and ask:

> "Reached {cap}-cycle review cap on {target}. Remaining issues:
>   Critical: <n>
>   Important: <n>
>   Minor: <n>
>
> Options:
>   1. Accept and continue (return as-is)
>   2. Push one more cycle (will hit cycle {cap+1})
>   3. Drop into manual rework (skill exits, caller takes over)"

Branch on the answer:
- Accept → return with `status: "user_stopped"`, the current verdicts, and the remaining-issues summary.
- Push one more → run one more cycle (treat this as a special case; record it as cycle `cap+1` and don't loop further).
- Manual rework → return with `status: "user_stopped"` and a marker that the user is taking over.

### Step 3 — return

Compose the JSON output and the short prose summary. Hand both back to the caller.

Include `cycle_log` — one entry per cycle run: total finding counts by severity, how many fixes actually changed the target, and a **per-reviewer breakdown** (`reviewers[]`, with `status: ok | failed` so a reviewer that errored is never confused with one that found nothing). This is telemetry only — zero effect on what reviewers see or do.

**Record the per-reviewer rows even on a converged cycle**, and persist them. They answer a question the loop cannot otherwise settle: *when a reviewer reports zero criticals in cycle N, how often does it report a critical in cycle N+1?* If that rate is near zero, cycles 2+ can safely stop re-running reviewers that already approved and hand them only the fix delta — a real saving, since the cycle's wall-clock is its slowest reviewer. If it is not near zero, re-running everyone is load-bearing and must stay. Nobody can answer that from a single run, which is exactly why the rows have to accumulate.

---

## Review mode (single-pass, read-only)

`mode=review` is the cheap path for reviewing a PR you are **not** shipping yourself — a colleague's PR, a pre-merge sanity check. It runs the three reviewers **once**, verifies their findings in **one batched pass**, and returns a prioritized, actionable list. No fix application, no convergence loop. Reach for it whenever the goal is *findings to post*, not *code to converge*.

**Why a separate mode:** the convergence loop's cost scales with cycles × reviewers × the fix subagent — justified when `flow` must converge before opening a PR, wasteful when you only want a review. Review mode is one cycle plus one extra agent.

**Surgical, not reassuring.** A review's only job is to flag what isn't right. Never restate what the PR gets right — no "looks solid", no "nicely done", no summary of correct behavior, no "verified X is fine". If something is correct, say nothing about it. Every sentence the author sees must be an actionable finding or the explanation of one. The adversarial verification still runs internally to drop false positives; its confirmations are not surfaced.

### R1 — dispatch the three reviewers IN PARALLEL (one cycle only)

Identical to [1a]: one message carrying the two CLI reviewers as backgrounded `Bash` calls and the third as a direct `Agent` call with the filled template. Do **not** loop after this.

### R2 — coerce verdicts

Identical to [1a′] then [1b]: reject any log showing a run that did not finish (truncated, quota/auth error, no file or line reference anywhere), then parse the rest into the verdict schema.

### R3 — batched adversarial verify + synthesize (ONE agent)

Dispatch a **single** `Task(general-purpose)` agent — **not one per finding**. Give it the diff (or SHA range) and the union of all reviewers' findings, and instruct it to:

- **Refute, don't rubber-stamp.** For each `critical`/`important` finding, read the actual code and try to disprove it. Drop false positives; correct over-stated severity.
- **Leave nits unverified.** `minor`/nit findings pass through as-is — verifying them costs more than ignoring a wrong one.
- **Dedupe** findings raised in common by multiple reviewers.
- **Emit actionable-only, sorted** by final severity (blocker → high → medium → low → nit), each with `file:line` and a one-line recommendation.
- **Flag, don't investigate, the hard ones.** If a high-severity finding can't be confirmed or refuted from the diff alone, mark it `uncertain` — do not spawn a deep dive here.
- **Apply both blind-spot lenses from Hard rule 7** — what the passing checks structurally cannot see, and whether any safety net this diff adds has ever been watched to fail. Findings from these are first-class, not commentary; they are usually the only ones the three reviewers all missed.

One agent reads the diff once. This buys ~90% of a per-finding fan-out's false-positive-killing at a fraction of the cost.

### R4 — escalate only the exceptions

If R3 returned any **high-severity `uncertain`** findings (expect 0–3, often 0), dispatch one solo verifier **per such finding** to investigate against the full repo. Skip this step entirely when there are none. Never fan out across all findings — only the flagged exceptions.

### R5 — return

Return **only** the synthesized actionable list (sorted, deduped, false-positives already removed). No "verified solid"/"looks good" notes, no `fixes_applied`, no cycle accounting. If there are zero actionable findings, say exactly that in one line and stop; do not pad it with what the PR did well.

Then show the findings to the user and stop. **Do not post anything yet** — posting is a separate, explicit step. The user reviews the findings first; only when they confirm and ask you to post do you proceed to R6.

### R6 — post the review (when asked)

When the user confirms the review and asks for it to be posted to the PR, post it as **one GitHub PR review object**, not as scattered top-level comments. Preserve the R5 tone exactly: direct, surgical, actionable-only. No praise, no false positives, no cycle accounting.

**The posted review contains ONLY surviving, actionable findings.** Never post a "Raised but refuted", "Dropped (false positives)", "Considered but not an issue", "no action needed", or "what we verified" section — not in the body, not inline. Refuted/dropped findings and the `dropped_false_positives` count are for the *chat summary to the user at R5 only*; they must not reach the PR. The author should see the work that remains, never a ledger of what was checked and cleared. If a reviewer raised something you refuted, it simply does not appear in the posted review.

**Route each finding by `scope`:**

- **`inline`** — the finding maps to a specific changed line. Attach it as an inline review comment on that line. A line is eligible only if it appears in the diff (an added/changed line on the **RIGHT** side, or a context line inside a hunk). Before posting, confirm the head line numbers against the actual diff (`git diff BASE..HEAD -- <file>`), since reviewer-reported line numbers drift.
- **`summary`** — the finding has no single anchor line: PR-description discrepancies, missing test coverage, cross-cutting/architectural concerns, or a finding whose line falls outside any diff hunk. These go in the review **body**, each as a one-line actionable bullet.

If a finding you intended to inline turns out not to sit on a diff line, demote it to `summary` rather than dropping it or forcing a wrong anchor.

**Mechanism — a single review via the GitHub API** (one `POST`, all comments attached atomically):

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input review.json
```

```json
{
  "event": "COMMENT",
  "body": "<summary-scope ACTIONABLE findings only, as one-line bullets — or a one-line 'no cross-cutting findings' if none. NEVER a refuted/dropped/no-action-needed/what-we-verified section.>",
  "comments": [
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "**Medium —** <finding + fix>" },
    { "path": "src/bar.ts", "start_line": 78, "line": 87, "side": "RIGHT", "body": "**Low —** <finding + fix>" }
  ]
}
```

- Use `event: "COMMENT"` (a review-mode review never `APPROVE`s or `REQUEST_CHANGES` on someone else's PR unless the user explicitly says so).
- Single-line anchor: `{path, line, side: "RIGHT"}`. Multi-line span: `{path, start_line, line, side: "RIGHT"}` with `start_line < line`.
- Prefix each comment with its severity (`**Blocker —**`, `**Medium —**`, …) so the author can triage inline.
- Build the JSON in a file and pass `--input`; don't hand-inline a huge `-f body=` string.

If a prior standalone summary comment was posted for the same findings (e.g. you posted before the user asked for inline), delete it after the review lands so the PR isn't duplicated:

```bash
gh api repos/{owner}/{repo}/issues/comments/{comment_id} --method DELETE
```

Report the review URL back to the user.

---

## Standalone invocation

When invoked directly (not from `flow`), the caller passes `target`, `kind`, and `brief`. Example usage patterns:

**Review a plan file ad-hoc:**
> "Run agents-review on `docs/flow/plans/2026-05-21-x.md`, kind=plan, brief=add rate-limiting middleware."

**Review a colleague's PR (read-only, cheap) — the common daily case:**
> "Run agents-review on PR #159, kind=code, mode=review, brief=adds the Backpex admin."

This runs [Review mode](#review-mode-single-pass-read-only): one parallel pass, batched verification, a prioritized actionable list. No fixes, no loop. The findings are shown first (R5); when you confirm, they're posted as a single PR review with line-anchored findings inline and anchorless ones in the body (R6).

**Review your own work-in-progress before shipping (iterate with fixes):**
> "Run agents-review on the current branch vs `main`, kind=code, brief=adds the X endpoint."

This is `mode=converge` (the default): the skill applies fixes by default (`auto_fix=true`) just like inside `flow`. If you want only one round of verdicts without fixes but still in converge shape, pass `auto_fix=false`.

**Picking a mode:** reviewing code you won't change → `mode=review`. Driving code to a clean state before merge → `mode=converge` (default).

---

## Anti-patterns

- ❌ Dispatching reviewers serially (`codex` then `cursor` then the third). Always parallel — one message, three tool calls.
- ❌ Dispatching the third reviewer with `Skill:` instead of a direct `Agent` call. The Skill tool returns instructions, so the actual dispatch slips to your next message and the "parallel" batch is serial. Read the template file and dispatch the agent yourself (Hard rule 1).
- ❌ Applying fixes from cycle N without running cycle N+1's reviews against the fixed target.
- ❌ Letting `important` issues block convergence or trigger a new review cycle — at any cycle, including cycle 1. They get fixed at convergence where agreed and surfaced at the gate, not iterated on.
- ❌ Silently dropping an important finding you disagree with. Declining to apply it is fine; failing to surface it (with your reason) in `remaining_issues` is not.
- ❌ Quietly raising the cycle cap when reviewers won't converge. Surface it and ask the user.
- ❌ Auto-applying `minor` findings at convergence. They are 6% real; listing them is enough (Step 1c).
- ❌ Accepting a truncated CLI log as a clean review. No rendered severity headings = failed seat, not an approval (Step 1a′).
- ❌ Backgrounding `codex exec` without `< /dev/null`. It will hang forever on stdin and idle the whole loop.
- ❌ Dispatching a `kind=code` cycle without checking the SHA range contains the task's files. A range that doesn't burns a full cycle on "the subject is missing".
- ❌ Running `flow:premortem` on cycles 2+, on `kind=code`, or in `mode=review`. It is a one-shot cycle-1 plan lens only; re-running it wastes a cycle and double-counts findings.
- ❌ Trying to inline the parallel-review primitive inside the caller. If you're tempted to do that, you should invoke this skill instead.
- ❌ Handing `kind=plan` fixes to a fresh subagent that must re-discover the codebase. Apply them with something that already holds the context — normally you, editing the plan inline (Step 1d). Re-discovery is what costs (~50 min for a 3-cycle loop) and what lowers fidelity; delegation to an agent that already has the context does not.
- ❌ Spawning a fresh fix subagent for `kind=code` when the implementer is still reachable. A completed agent resumes from its transcript with context intact — send it the fix list instead (Step 1d). Spawning fresh throws away the worktree and diff context it already holds and pays the re-discovery cost again, every round.
- ❌ Returning prose-only verdicts when the caller expected the JSON schema. Always return both.
- ❌ Running the convergence loop (`mode=converge`) just to review a PR you won't fix. Use `mode=review` — one pass, no fixes.
- ❌ In review mode, spawning one verification agent per finding. Batch verification into a single agent (R3); escalate only high-severity `uncertain` findings (R4). Per-finding fan-out is the expensive mistake review mode exists to avoid.
- ❌ Padding a review with what the PR gets right — "verified solid", "nicely done", a summary of correct behavior. A review is only what needs to change; if it's fine, it goes unsaid.
- ❌ Posting a "Raised but refuted", "Dropped (false positives)", "no action needed", or "what we verified" section to the PR. Refuted/dropped findings belong in the R5 chat summary to the user, never in the posted review (body or inline). The author sees only the work that remains.
- ❌ Posting an asked-for review as one big top-level comment when most findings map to specific lines. Findings that sit on a changed line go **inline**, attached to that line, in a single PR review object (R6); only anchorless findings go in the review body.
- ❌ Posting the review before the user has seen and confirmed the findings. R5 shows; R6 posts, and only when asked.
