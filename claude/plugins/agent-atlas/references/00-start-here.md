<!-- last-reviewed: 2026-06-27 -->
# 00 — Start Here (the router)

If you're reading this, a request smelled **agentic**. This page routes you — triage → archetype → the right stations → the right source. **Don't read the whole atlas; follow the path.**

---

## Are you even in agentic territory? (trigger test)

You're agentic if the system will do any of: **make decisions with an LLM · call tools/APIs · loop or iterate · retrieve (RAG) · hold memory · coordinate multiple models/agents.**
A single fixed LLM call with none of those is **sub-agentic** → Station 0's off-ramp (run its two checks before exiting).
A single attached doc or one-shot context is **not** the RAG archetype — that's sub-agentic (off-ramp). RAG = the agent *decides what to retrieve* from a corpus.

---

## Station 0 — Frame & Triage (ALWAYS first)

**1. Is it even an agent?**
- **Sub-agentic** (single call; no loop, tools, or memory) → usually the **OFF-RAMP**, but *not an agent* ≠ *rigor-free*. Two independent checks first:
  - **Input** — does a **computed/derived value feed the model as ground truth**? → boundary `01`: is it the *right* indicator **for this specific situation** (derived / fit-checked, not a generic or domain-standard default) **and** computed right (golden-case it)? — *regardless of who reads the output*.
  - **Output** — is the result **consumed by a system or acted on unreviewed** (not read by a human who'd catch errors)? → enforce the shape (`03`'s strict-schema rung); ground any factual claim to its source (`01`).
  - **Neither** → take the off-ramp: clear prompt + a basic eval, stop. Most "summarize / classify / extract this for a human to read" exit here.
- **Agentic** → continue.

**2. Should it be an agent — and bounded how?** Decide explicitly now (cheap now, expensive later):
- **Autonomy** — how much runs without a human? Where are the approval / human-handoff gates (the UX of HITL)?
- **Data & PII** — what data does it touch; what lands in traces; what goes into eval sets?
- **UX fit** — how does the user experience latency, errors, partial results, handoff?
- **Cost ceiling** — per-task token/$ budget; behavior at the ceiling?
- If an agent is the *wrong* tool (deterministic code would do, or risk > value) — **say so and stop.**

**3. Set the depth** (per station, by blast radius):
- Low-stakes / internal / reversible → **minimum-viable**.
- Autonomous / customer-facing / irreversible side-effects → **full**.
- Depth scales **remediation**, not **reading** — even at minimum-viable you *open* each applicable station and surface its checklist; you just address each item more lightly.

---

## Which kind of agent? (archetype classifier)

Pick by the discriminative question. If none fit → **research route** (walk the stations generically **and log a NEW gap** in `~/.claude/agent-atlas-gaps.md` — a known limitation, never a silent miss). *(The named recipe-less archetypes below already take the research-route by design — that deferral is known; don't re-log it, only a genuinely new shortfall.)*

| If the agent mostly… | → archetype |
|---|---|
| answers from a corpus/docs | **RAG / knowledge** |
| writes/edits code or runs commands | **coding / automation** |
| holds multi-turn dialogue with a user | **conversational / support** |
| investigates open-endedly across sources | deep-research |
| drives a GUI / browser / OS | computer-use |
| chains steps/tools on a trigger, little dialogue | workflow-automation |
| spans several of the above / unclear | **multi-archetype** → walk stations for each dominant mode, or take the research route |

The three classifier archetypes above (RAG · coding · conversational) have full-depth *recipes* in `recipes/`; every archetype still gets the Station-0 gate + the four stations, and the rest take the research route.

*Support triage:* ticket *triage/classification* with no back-and-forth → workflow-automation; a *chat* support agent → conversational; genuinely both → multi-archetype.

---

## The four stations (walk each at the chosen depth)

| Station | The question it answers | Doc |
|---|---|---|
| **01 Architecture** | What pattern + system shape? (single/multi-agent, loop, context, memory, tools) | `01-architecture.md` |
| **02 Evals** | How will I know it works? (error analysis, golden sets, judges, consistency) | `02-evals.md` |
| **03 Frameworks** | What do I build it with? (orchestration, durable exec, protocols) | `03-frameworks.md` |
| **04 Production** | How does it run safely + affordably? (observability, guardrails, security, cost, data/PII) | `04-production.md` |

Each station gives: canonical terms → a decision procedure → minimum-viable vs full bars → a must-address checklist → the one source to deep-dive now.

> **Verification is a gate, not a footnote.** A *critical* finding from any review / eval / self-check blocks a "done / testable" claim until it's fixed — or explicitly deferred with the user's consent. **Default: critical = correctness · safety/security · data-loss · a failed required-capability eval; cosmetic / style / perf-nit = minor (defer with consent).** (Runtime parallel → `04`; cf. `01`'s harness "verification step".)

---

## Canonical-home table (decide once, link everywhere)

Each cross-cutting concept lives in exactly **ONE** doc; every other mention links to it (this is what keeps the atlas from drifting/duplicating).

| Concept | Canonical home |
|---|---|
| Behavioral pattern · single-vs-multi · loops · context engineering · memory | **01** |
| Structured outputs (reliability technique) | **03** (enforcement) ← 01 links |
| Error analysis · judges · scoring · `pass^k` | **02** |
| Eval frameworks / platforms (Braintrust, Langfuse, OpenAI Evals, promptfoo, Inspect, DeepEval) | **03** (tooling); eval *methodology* stays **02** |
| Durable execution · checkpointing | **03** (tooling) ← 01, 04 link |
| Human-in-the-loop / approval gates / human handoff | **04** owns *policy*; **01** owns *mechanism* (state-machine / resume) |
| Reliability (retries, fallbacks, circuit breakers, checkpoint/resume *policy*; checkpointing **tooling** → `03`) | **04** |
| Deployment patterns | **04** |
| Observability / tracing | **04** ← 02 links for eval data |
| Guardrails · security · prompt-injection | **04** |
| Cost / latency | **04** |
| Data / privacy / compliance | **04** (raised in Station 0) |
| Data flywheel (traces → eval sets) | **02** ← 04 links |
| RAG retrieval pipeline (ingestion/chunking, indexing, retrieval, grounding/citations) + the retrieval-quality eval *pipeline stage* | **`recipes/rag.md`** (pipeline) · eval **methodology** → **`02`** |
| Coding agent's executable-verifier-as-reward collapse + command blast-radius mapping (applies `04` policy / `01` mechanism) | **`recipes/coding.md`** |
| Conversation spine — turn-state carry/compaction, felt-turn UX, handoff experience (policy → `04`, mechanism → `01`) | **`recipes/conversational.md`** |
| Deterministic/LLM boundary (input crossing · output-side grounding **check**, general form) | **01** |
| Verification gate (a critical finding blocks a done-claim) | **00** (policy) ← **04** (runtime mechanism) |
| Canonical sources (URLs, dated) | **`sources.md`** |

---

## How to use

Follow the path top-to-bottom: **trigger test → Station 0 → archetype → the relevant stations at depth → cite from `sources.md`.** Do **not** read the whole atlas. For any volatile specific (a benchmark number, a framework's current status, a price), **open the dated source** — don't trust cached memory. If the atlas fell short, log it in `~/.claude/agent-atlas-gaps.md` (**append-only — do not *read* it, or the plugin's `_gaps.md` archive, during a walk; it short-circuits the routing**).

**Walking a station means opening it.** The one-line summaries above and the canonical-home table are *navigation*, not content — a "station mapping" paraphrased from them is **not** a walk. For each applicable station, open the doc and carry its own must-address checklist into the plan (each item addressed → where / deferred → why).

**Single-concern shortcut:** if the request is about just **one** dimension of an *existing* agent (only its architecture/pattern, only evals, only production-hardening/debugging, only framework choice), do the 10-second Station-0 check then jump straight to that station (`01`/`02`/`04`, tooling in `03`) — don't walk the whole map. Two or more concerns, or a from-scratch build → walk from the top.
