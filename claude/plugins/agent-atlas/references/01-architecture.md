<!-- last-reviewed: 2026-06-27 -->
# 01 — Architecture & Orchestration

> **Owns:** the behavioral pattern + system *shape* — *what the agent does* (loop, single/multi, context, memory, tools, the harness). · **Minimum-viable:** one named pattern, ReAct loop, hand-curated context, flat tool set, no memory. · **Full:** justified pattern (incl. multi-agent only if the rule clears), engineered context (offload/isolate/compact), typed memory, ergonomic ACI with error feedback, state-machine harness with checkpoints + human gates.

This is a routing page. It owns the *decisions*; it points at the *sources*. We don't re-teach what these patterns *are* (a strong model already knows ReAct, prompt-writing) — we say *when* to use each; only the decision procedures, default rules, and dated pointers live here. Prompt-engineering basics are assumed-known; **context engineering** (owned here) is the agent-relevant evolution.

---

## Canonical terms

- **Augmented LLM** — the base primitive: an LLM + retrieval + tools + memory. Everything below composes this.
- **Workflow vs agent** — *workflow* = LLM(s) + tools on **predefined code paths** (predictable); *agent* = LLM **dynamically directs its own process/tool use** (flexible). A spectrum, not a binary — and the spine of decision procedure #1.
- **Anthropic pattern taxonomy** — *prompt chaining* (decompose into fixed sequential steps), *routing* (classify → specialized handler), *parallelization* (**sectioning** = split independent subtasks; **voting** = same task N times for consensus), *orchestrator-workers* (lead decomposes dynamically + delegates), *evaluator-optimizer* (generate → critique → revise loop).
- **Agent-loop patterns** — *ReAct* (the default), *plan-and-execute*, *reflexion*, *tree-of-thoughts*, and *agentic RAG* (the agent decides *when/what* to retrieve, vs. retrieve-then-generate — the load-bearing distinction). The atlas's stance is **ReAct unless a specific need**; for which-loop-when see decision procedure #2.
- **Context engineering** — curating the *optimal set of tokens* held during inference (the evolving state), vs. **prompt engineering** (writing one good instruction). An evolution of the same craft, not a replacement.
- **Context rot** — recall/quality degrades as the window fills; more tokens ≠ better.
- **Compaction** — summarize a near-full window and reinitialize a fresh one from the summary.
- **Just-in-time retrieval** — hold lightweight refs (paths/URLs/queries), load payloads at runtime, vs. pre-loading everything.
- **Memory types** — *episodic* (past events/traces), *semantic* (facts/knowledge), *procedural* (skills/how-to, often the prompt+tools themselves); orthogonally *short-term* (in-context) vs *long-term* (external store).
- **ACI (agent-computer interface)** — the tool surface the agent acts through; design it with the same care as a human UI/API.
- **Harness** — the code you own *around* the model: prompt assembly, context curation, control flow, tool dispatch, checkpoints, human gates. The model is one component; the harness is the system.
- **Deterministic/LLM boundary** — where a computed value feeds the model as ground truth (input crossing) or the model must emit a faithful fixed shape (output crossing). Golden-case the computation; invariant-check the output.

---

## Decision procedures

### 1. Workflow or agent? (and which pattern)
**Default:** start with the *simplest* thing that works; add agency only when a fixed path can't express the task. Climb this ladder, stopping at the first that fits:
1. **Single augmented LLM call** → if no loop/tools/memory needed (this is the Station-0 off-ramp).
2. **Workflow** (chaining / routing / parallelization) → steps are *known in advance*. Use **routing** when inputs fall into distinct classes; **sectioning** when subtasks are independent (latency win); **voting** when you want consensus/higher precision on one task; **evaluator-optimizer** when you have a clear critique signal and iteration improves output.
3. **Agent** (orchestrator-workers or open ReAct) → the steps/structure are *discovered at runtime*. Pay the unpredictability + cost for genuine open-endedness.
> Criteria to climb a rung: the task's structure is unknowable ahead of time, OR flexibility/model-driven decisions are needed at scale. Otherwise stay lower — predictability and cost favor it.

### Boundary check — *only if a computed/derived value feeds the model, or it emits a machine-consumed shape; else skip*
- **Input** — ground truth only if it's the *right* indicator **for this specific situation**, computed right. **(a) Right indicator?** Justify it against *this* problem — the decisions the output will drive, the domain/context, what the data actually supports. A default — generic *or* a domain-standard panel (DORA, SRE, stock KPIs) — is a **hypothesis about fit**, not the answer: name what it misses and **investigate** (the real question, the stakeholder's decisions, the data) before trusting it; if fit isn't established, *establishing it is the task*, not a simple narrate-call. **(b) Computed right?** Golden-case the computation — a perfectly-computed *wrong* indicator misleads as much as a buggy one.
- **Output** — tie each claim to its source with a code-checkable invariant decided *before* generating; enforce the shape (`03`).
- **Riskiest layer** → eval it first in `02`.

### 2. Which agent loop?
- **ReAct = default.** Reach for others only on a specific need.
- **Plan-and-execute** when steps are largely independent and an upfront plan aids parallelism/budgeting.
- **Reflexion / evaluator-optimizer** when an *external* signal (tests, a rubric, a separate model) can judge. **Caveat (enforce):** don't let the model that *generated* be the *sole* grader of its own work — self-grading inflates confidence without catching real errors. Use tests, a different model, or a human as the judge.
- **Tree-of-thoughts** *only* when you must enumerate user-facing **alternatives** (e.g. several distinct designs). Native reasoning models already explore internally, so ToT's branch/evaluate overhead rarely pays off otherwise. Default: skip it.
- **Agentic RAG** when *whether/what* to retrieve depends on intermediate reasoning (vs. always retrieve once).

### 3. Single-agent or multi-agent? — **DEFAULT RULE**
> **Start single-agent with good tools.** Go multi-agent ONLY when **all four** hold:
> 1. the task **decomposes** into semi-independent subtasks,
> 2. **parallelism cuts wall-clock time materially**,
> 3. **context isolation** (separate windows) is genuinely justified (subtasks would pollute each other's context),
> 4. **synthesis value > coordination cost** (and the per-task value covers ~an order-of-magnitude more token spend).

**Hard heuristic — single-threaded writes / parallel reads:** parallelize *read/explore* breadth-first work (independent lookups don't conflict); keep anything that *makes coupled decisions or writes shared state* on **one** thread, sharing full context. Multi-agent failures cluster where parallel actors make conflicting implicit decisions with partial context.

**Dual-pointer (don't say "it's debated" — read both):**
- **Pro / when it works:** *Anthropic — multi-agent research system* — orchestrator + parallel subagents win on **breadth-first** search, work exceeding one window, many complex tools; at large token cost (`sources.md § Architecture`).
- **Con / when it bites:** *Cognition — Don't Build Multi-Agents* (Walden Yan) — "**share context, share full traces, not just messages**" and "**actions carry implicit decisions; conflicting decisions → bad results**"; prefer single-threaded linear agents until cross-agent comms mature (`sources.md § Architecture`).
- **Reconciliation:** they agree more than they look. Both endorse *parallel reads in isolated windows; coupled writes single-threaded with shared full context*. Disagreement is about how much coupled work to fan out — resolve it with the four-part rule, not vibes.

### 4. Context engineering (the curation loop)
**Goal:** the *smallest set of high-signal tokens* that gets the outcome — fight context rot. Apply in order:
1. **Reduce** — drop/trim low-signal tokens; tighten system prompt + tool defs.
2. **Offload** — push state out of the window (files, scratchpads, structured notes) and reference it.
3. **Isolate** — give focused sub-agents clean windows; return condensed summaries up.
4. **Retrieve just-in-time** — load payloads on demand via tools, not eagerly.
5. **Compact** — when nearing the limit, summarize → reinitialize.
> Frame this as the *evolution* of prompt engineering (managing the whole evolving state), not a settled doctrine. Specific tactics are still moving — check the source.

### 5. Do you even need memory?
**Default: no persistent memory** until a concrete need appears. Add it when the agent must **carry state across sessions/turns** beyond one window. Then pick by type:
- **Episodic** (recall past runs/decisions) · **Semantic** (durable facts/user prefs) · **Procedural** (reusable skills/playbooks — often just better prompts+tools).
- Implementation is usually *offloaded* context (notes/files/store) + retrieval, not a magic component. Don't enshrine a specific product; check current systems via the source.

### 6. Tool / ACI design
- **Treat tools as a UI for the model.** Give few, well-named, non-overlapping tools; clear descriptions; examples in the schema. Poka-yoke the arguments (make wrong calls hard).
- **Return actionable error feedback** — errors are part of the loop; tell the model *how to fix it*, not just that it failed. Compact noisy errors before they re-enter context.
- **Structured outputs** make tool calls reliable ("tools are just structured outputs") — *enforcement* (schema-constrained decoding, retries) is owned by **`03 Frameworks`**.
- **MCP** standardizes tool/data connections — protocol detail owned by **`03`**.

---

## Minimum-viable vs full (depth bars)

| Dimension | Minimum-viable (low-stakes/internal/reversible) | Full (autonomous/customer-facing/irreversible) |
|---|---|---|
| Pattern | one named pattern; prefer a workflow if steps are known | pattern justified against the ladder; multi-agent only if the 4-part rule clears |
| Loop | ReAct, single thread | loop fits the task; external grader for any self-correction |
| Context | hand-curated prompt + tools | engineered: offload/isolate, just-in-time retrieval, compaction strategy |
| Memory | none (stateless) | typed memory (episodic/semantic/procedural) with a retrieval path |
| Tools/ACI | flat tool set, basic errors | ergonomic tools, structured outputs, actionable error feedback |
| Harness | a loop + prompt you control | state machine, checkpoints, human-in-the-loop gates, verification step |

---

## Must-address checklist

- [ ] **Lowest rung that works?** Justified *why* it's an agent vs. a workflow vs. a single call (don't over-build).
- [ ] **Boundary checked** (if a computed value feeds the model or it emits a machine-consumed shape) — both crossings; golden-case the computation; claim-to-source invariant + enforcement on the output.
- [ ] **Loop chosen on purpose** (ReAct unless a specific need) — and no model grades *only its own* output.
- [ ] **Single-vs-multi run through the 4-part rule** — multi-agent only if all four hold; coupled writes stay single-threaded.
- [ ] **Context strategy named** — reduce/offload/isolate + retrieval + compaction; a plan for context rot.
- [ ] **Memory decision explicit** — none, or a named type with a retrieval mechanism.
- [ ] **ACI reviewed as a UI** — minimal, well-described tools; actionable error feedback; structured outputs (→ `03`).
- [ ] **Harness owns its prompts/context/control-flow** — state machine over a free loop; checkpoints; human gates; a verification step (12-Factor).
- [ ] Cross-station: structured-output *enforcement* → `03` · durable execution/checkpointing → `03` · observability/tracing → `04` · evals/judges → `02`.

---

## Deep-dive sources
See `sources.md § Architecture` — all entries tool-verified `2026-06-25`.

**Read FIRST:** *Anthropic — Building Effective Agents* (the pattern taxonomy + "start simple" spine of this whole page).
Then, by need: *12-Factor Agents* (harness/control-flow) · the **multi-agent dual-pointer** (Anthropic pro ↔ Cognition con) before any fan-out · *Anthropic — context engineering* for the curation loop · *Lilian Weng — LLM-Powered Autonomous Agents* for the planning/memory taxonomy · *Andrew Ng — Agentic Design Patterns* for the four-pattern mental model (reflection/tool-use/planning/multi-agent).
