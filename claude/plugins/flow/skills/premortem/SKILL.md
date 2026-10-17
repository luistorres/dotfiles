---
name: premortem
description: Run a structured premortem on a written implementation plan — assume the plan shipped and failed, enumerate the causes, and turn each into a concrete plan fix. Dispatches an Opus subagent. Use as the 4th reviewer in agents-review's first plan-review cycle, or standalone to stress-test any plan before code is written.
---

# Premortem

Dispatch an Opus subagent to run a **premortem** on an implementation plan: assume the plan was fully executed and the result was a clear failure, then work backward to the causes — before any code is written.

**Core principle:** Prospective hindsight. "Imagine it already failed — why?" surfaces specific, suppressible risks that a forward-looking "what could go wrong?" misses.

This is the inverse of a postmortem. Where `requesting-plan-review` audits the plan for clarity / completeness / scope, the premortem assumes the plan is *clear and complete* and asks what still sinks it in practice.

## When to invoke

**From `agents-review`:** as the 4th parallel reviewer, **first cycle only**, when `kind=plan` and the `premortem` flag is set. `flow` sets that flag at its plan-review phase ([1c]).

**Standalone:** "run a premortem on this plan" — stress-test any plan file on its own.

**Not for code review.** A premortem operates on a plan/decision, not a diff. The code-review loop's reviewers already cover risk, and a premortem on a diff mostly duplicates them.

## Inputs

- `{PLAN_PATH}` — absolute path to the plan file.
- `{BRIEF}` — 1-3 sentence summary of the original request and constraints.
- `{DESIGN_PATH}` (optional) — the brainstorming/design spec, if one exists. Failure modes often live in the gap between what the design intended and what the plan committed to. Pass an empty string if none.

## How to invoke

Dispatch the `Agent` tool with `subagent_type: flow:premortem-reviewer`, passing only `{PLAN_PATH}`, `{BRIEF}` and `{DESIGN_PATH}` in the prompt. Its instructions, `model: opus`, `effort: xhigh` and read-only tool set live in the agent definition at `agents/premortem-reviewer.md`.

## Output contract

The subagent returns markdown using the **same severity headers** the other reviewers use, so `agents-review` parses it with zero special-casing:

- `### Premortem scenarios` — a short narrative: the 2-4 most plausible failure stories (for the user-facing summary; not parsed into the verdict arrays).
- `#### Critical` — failure causes that are both plausible AND would make the executed plan produce broken/wrong results.
- `#### Important` — significant failure modes worth mitigating before execution.
- `#### Minor` — lower-likelihood or lower-impact risks.
- `### Assessment` — the single most-likely failure and a verdict.

Each finding names the failure, its cause in the plan, and the concrete plan change that prevents it — phrased as an addressable fix, so it folds into `agents-review`'s fix synthesis like any other finding.

## Integration with `agents-review`

`agents-review` calls `flow:premortem` only in **cycle 1** of a `kind=plan` loop when `premortem=true`. Its findings union with the three standard reviewers' for that cycle's fix synthesis. It does **not** re-run on later cycles — the premortem is a one-shot divergent lens; once its scenarios are folded into the plan, repeating it adds little. By design it almost always produces findings, but they are triaged like any other reviewer's: only criticals force another review cycle; importants are fixed at convergence without reopening the loop, and minors are listed for the caller rather than applied.

See the agent definition at: `agents/premortem-reviewer.md`
