# agent-atlas

A **navigable map + routing layer** for agentic development — *not* an encyclopedia. When a request smells "agentic," the atlas surfaces the **exact canonical terms to research**, the **mandatory stations** to clear, and the **authoritative deep-dive source** to read — just-in-time.

Its durable edge over "just ask the model" is the three things models are *bad* at:
1. **Routing discipline** — a behavior that forces *nothing-skipped*.
2. **Dated pointers** to live sources *past the model's training cutoff*.
3. **Our own accumulated, project-specific decisions.**

> **Anything a good model already knows is cut** (the *differentiation litmus*). The atlas exists to route, to point at current sources, and to remember our decisions.

## How it works

```
agentic-smelling request
  → agentic-dev SKILL (description = trigger)  →  loads references/00-start-here.md
      → STATION 0 — FRAME & TRIAGE
          1. Is it even an agent?  (no → off-ramp: you don't need the stations)
          2. Should it be?         (autonomy · human-handoff · data/PII · UX · cost)
          3. Set depth             (minimum-viable vs full, by risk)
      → walk the four stations at the chosen depth:
          01 Architecture · 02 Evals · 03 Frameworks · 04 Production
      → cite from references/sources.md (the source ledger)
```

## Layout

| Path | What |
|---|---|
| `skills/agentic-dev/` | The thin trigger skill — the *doorway*. Knowledge lives in `references/`. |
| `references/00-start-here.md` | The **router**: trigger test, Station-0 gate, archetype classifier, canonical-home table. |
| `references/01..04-*.md` | The four **station** docs (terms · decision procedures · checklist · dated sources). |
| `references/sources.md` | The **source ledger** — the one place volatile specifics concentrate. |
| `_gaps.md` | Archive of gaps already folded into the atlas. New gaps are logged locally in `~/.claude/agent-atlas-gaps.md`. |

## Status

**Phase 1 (complete):** the `agentic-dev` skill + `00-start-here` + the four station docs + `sources.md`.
**Phase 1.5 (complete):** the three archetype recipes (`recipes/rag.md` · `coding.md` · `conversational.md`) + an Anthropic subset (`references/anthropic/`).
**Phase 2 (closed):** shipped the Layer-1 single-concern fast-paths (in `agentic-dev`'s body + `00`) + the `flow` agentic-build seam. The richer single-concern *sub-skills* were built, live-gated (17/19), and **declined** — they added precision but over-fired on non-agent surfaces (generic keywords like "evals"/"prompt-injection") and cost a 4-description maintenance tax for no extra reach over the broad doorway.

> **Installing this plugin does not make a working harness yet.** Phase 1 ships the knowledge + a thin router skill; it is read/route, not automation.

Design + plan: see the project plan referenced in the maintainer's notes. Built via the `flow` dev cycle (small, reviewed PRs).
