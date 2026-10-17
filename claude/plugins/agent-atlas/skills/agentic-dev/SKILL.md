---
name: agentic-dev
description: Use when you build or design an AI agent or assistant, a chatbot or copilot over your data, a RAG or tool-using app, a multi-agent system, or an autonomous or multi-step LLM workflow; automate a task with AI; add tools, memory, or retrieval to an LLM app; or eval, debug, or productionize an agent ("why is my agent looping", add evals/guardrails/observability). Covers building, designing, architecting, evaluating, or productionizing anything agentic. Runs a Station-0 triage gate (is an agent even the right tool, and at what autonomy?) then walks four mandatory stations — architecture, evals, frameworks, production — so nothing critical is skipped, pointing to authoritative deep-dive sources just-in-time. Also use before writing code for any task where an LLM will make decisions, call tools, loop, or hold memory.
---

# agentic-dev — the doorway into agent-atlas

You are at the entrance to **agent-atlas**, the map for building agentic systems. Your job here is to **route**, not to dump everything you know. The map's value is that it stops critical dimensions being skipped and points you at the *current* primary source for each — things the model is bad at on its own.

## Do this

1. **Read the router:** open this plugin's `references/00-start-here.md` and follow it.
2. **Run Station 0 — Frame & Triage first:**
   - If the task is **sub-agentic** (a single LLM call — no loop, no tools, no memory), it's usually the **off-ramp** — but run `00`'s two off-ramp checks first; neither trips → say so and stop; either → read the specific pointer `00` names. Most "summarize/classify/extract this for a human" still exit clean.
   - Otherwise decide: *should* this be an agent, at what **autonomy**, with what **human-handoff (the UX of HITL) / data-&-PII / UX / cost** boundaries — then set the **depth** (minimum-viable vs full).
3. **Walk the applicable stations** (`references/01..04`) — **reading is mandatory; only *remediation* depth scales** (min-viable = address each checklist item lightly, *not* skip the doc). For each station Station-0 marks applicable, **open the doc** and carry **its own must-address checklist** into the plan, every item marked **`addressed → <where: a plan section / file / decision>`** or **`deferred → <why>`**. **Do not** write a self-authored "station mapping" paraphrased from the `00` router — that paraphrase is the theater; the `00` table is *navigation*, not the station's content. (An off-ramp exit reads no stations; a tripwire reads only its named slice.) Surface the canonical terms and the *one* deep-dive source to read now (from `references/sources.md`) alongside the checklist.
4. **Cite** the sources you rely on. If the atlas had a gap (missing archetype, stale advice, no good source), append one line to `~/.claude/agent-atlas-gaps.md`, a local and private log (create it if missing). **Append-only — never *read* it, or the plugin's `_gaps.md` archive, during a walk; they log gaps and their answers, so reading them short-circuits the station routing.**
5. **Before you claim done / testable:** is any critical finding (review / eval / self-check) still open? If so it's **not done** — fix it, or defer it explicitly with the user's consent. Verification is a gate (→ `00`).

## Already know which station you need? (single-concern fast-path)

If the request is about **one** dimension of an *existing* agent, you don't have to walk the whole map — jump straight to that station after a 10-second Station-0 check (is it even agentic? at what depth?):
- pattern / loop / single-vs-multi / context / memory / framework choice → `references/01-architecture.md` (+ `references/03-frameworks.md` for tooling)
- how do I know it works / evals / judges / `pass^k` → `references/02-evals.md`
- guardrails / injection / HITL / observability / reliability / cost / **debugging a looping or misbehaving agent** → `references/04-production.md`
- which framework / orchestration / MCP / durable execution → `references/03-frameworks.md`

If the request spans **two or more** of these (or is a from-scratch build), don't shortcut — walk from `00-start-here.md` so nothing critical is skipped.

## Principles

- **The atlas routes; it does not replace the primary source.** For anything version-, price-, or benchmark-specific, open the dated source from `sources.md` — never assert it from memory.
- **Proportional discipline.** A small agent gets minimum-viable stations; an autonomous, high-blast-radius agent gets the full treatment. Never checkbox-theater.
- **Thin by design.** The knowledge lives in `references/`; this skill is only the doorway.
- **Verification is a gate** (owned by `00`; completion check at step 5 above).
- **A walk means reading.** Surfacing a station's *own* checklist (each item addressed→where / deferred→why) is the proof you walked it — *cite the checklist or you didn't walk it.* Paraphrasing the `00` router is the theater the atlas exists to prevent.

> Path note: file references above are relative to this plugin's root and resolve via `${CLAUDE_PLUGIN_ROOT}` when installed; confirm path resolution on first install.
