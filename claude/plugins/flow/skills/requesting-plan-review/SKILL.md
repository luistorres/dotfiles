---
name: requesting-plan-review
description: Dispatch a plan reviewer subagent to critique a written implementation plan before any code is written. Use when a plan file exists and needs adversarial review for clarity, completeness, scope, risk, and alternatives. Counterpart to requesting-code-review, but reviews .md plans instead of diffs.
---

# Requesting Plan Review

Dispatch a plan reviewer subagent to catch issues in a plan **before** they cascade into wrong code. The reviewer gets only the plan file and the original brief — never your session's history. This keeps the reviewer focused on the work product and preserves your context.

**Core principle:** A bad plan compounds. Review the plan, not just the code.

## When to Request Review

**Mandatory:**
- After writing a new plan with `superpowers:writing-plans`
- Before approving a plan for execution
- Whenever the `flow` orchestrator enters its plan-review convergence loop

**Optional but valuable:**
- When stuck on plan-vs-design tradeoffs
- Before splitting a PRD into issues

## How to Request

**1. Identify the plan file and the original brief:**
- `{PLAN_PATH}` — absolute path to the plan, e.g. `docs/flow/plans/2026-05-21-feature.md`
- `{BRIEF}` — the user's original request and any constraints (1-3 sentences)
- `{DESIGN_PATH}` (optional) — the brainstorming spec at `docs/flow/specs/...-design.md`, if one exists

**2. Dispatch the plan reviewer subagent:**

Dispatch the `Agent` tool with `subagent_type: flow:plan-reviewer`.

The prompt carries only the per-run inputs — `{PLAN_PATH}`, `{BRIEF}`, and `{DESIGN_PATH}` if a design spec exists. Everything else (the reviewer's instructions and output contract, `model: opus`, `effort: xhigh`, and its read-only `Read, Grep, Glob` tool set) lives in the agent definition at `agents/plan-reviewer.md`. Don't restate the instructions in the prompt — one home, no drift.

The model is pinned so the reviewer behaves the same whichever model the session runs, and so its instructions can be tuned for that model. Read-only is structural, not a request: the definition grants no write tools, so the reviewer cannot edit the plan while its peers are reading it.

**Placeholders:**
- `{PLAN_PATH}` — path to the plan file
- `{BRIEF}` — original user brief
- `{DESIGN_PATH}` — optional design/spec file path

**3. Act on feedback:**
- Fix Critical issues immediately (the plan would produce wrong code).
- Fix Important issues before moving to execution.
- Note Minor issues; mention them in the plan if they're worth tracking.
- Push back if the reviewer is wrong (with reasoning). Plan reviewers are more opinionated than code reviewers and sometimes over-scope critique.

## Integration with `flow`

The `flow` orchestrator runs three reviewers in parallel against the plan: `/codex-review`, `/cursor-review`, and `requesting-plan-review`. After all three return, `flow` synthesizes fixes and re-runs the loop (up to 5 cycles for a plan).

When invoked from `flow`, the reviewer's markdown output is parsed by the orchestrator into:

```json
{
  "reviewer": "requesting-plan-review",
  "verdict": "approve" | "issues",
  "critical":  ["<short, addressable item>"],
  "important": ["..."],
  "minor":     ["..."],
  "notes":     "<1-2 sentence summary>"
}
```

The markdown structure the agent emits is designed to be deterministically parseable into that shape — headers `#### Critical`, `#### Important`, `#### Minor` map directly to the arrays.

## Red Flags

**Never:**
- Skip plan review because "the brief was clear."
- Ignore Critical plan issues — they become Critical code issues 10× more expensively.
- Proceed to execution with unresolved Important issues unless explicitly accepted.

**If reviewer is wrong:**
- Push back with reasoning grounded in the codebase or the brief.
- Show evidence (file references, prior decisions) that the chosen approach is justified.

See the agent definition at: `agents/plan-reviewer.md`
