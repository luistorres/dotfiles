<!-- last-reviewed: 2026-06-27 -->
# 03 — Frameworks & Tooling

> Owns: mapping `01`'s decisions → concrete tooling + tradeoffs (*what you build it with*). · Minimum-viable: raw provider SDK + tool loop + an MCP client; structured output via strict schema. · Full: orchestration framework chosen by your `01` axes + durable-execution backend + sandboxed code exec + protocol surface (MCP/A2A) + enforced structured I/O.
>
> ⚠️ **Highest-rot doc.** Maturity, language support, funding, adoption, and "who leads" churn monthly. This doc is a **map**: it teaches *how to choose* and *where to check current status*, not a leaderboard. Every specific below is either dated-and-verified or replaced by a pointer to the live source. **Open the source before quoting any version/number.** Re-verify the dated block in `## Safe-default stack picks` quarterly.

---

## Canonical terms

- **Orchestration framework** — the library that runs the agent loop: state, tool dispatch, control flow, handoffs. (vs `01`, which decides *what shape* that loop is.)
- **Durable execution** — runtime that persists workflow state at each step so a crashed/restarted/long-paused run resumes from the last completed step instead of re-running from zero. For multi-step agents this is an **architectural requirement**, not a nice-to-have (see below).
- **Checkpointer / persistence layer** — the durable-execution mechanism *inside* a framework (e.g. a graph snapshot per super-step) vs. an *external* durable-execution engine the framework calls out to.
- **MCP (Model Context Protocol)** — open standard for agent↔**tool/context** wiring. `01` owns the *agent-computer-interface design* question; **03 owns the protocol/transport detail.**
- **A2A (Agent2Agent)** — open standard for agent↔**agent** interop (discovery, delegation across frameworks). Complements MCP; does not replace it.
- **Sandbox / code-execution runtime** — isolated environment where agent-generated code runs without touching your host/prod.
- **Structured-output enforcement** — making model output *conform* to a schema. Spectrum: free-text JSON → **JSON mode** (valid JSON, no schema guarantee) → **strict schema / constrained decoding** (output *must* match the supplied JSON Schema). 03 owns the *enforcement* technique; `01` links here for the reliability lever.
- **Compiled-prompt paradigm (DSPy)** — a *different axis* entirely: you declare typed signatures + modules and an **optimizer** tunes the prompts/demos against a metric. Not an orchestrator — can sit *underneath* one.

---

## Decision procedure (01's decisions → tooling)

`01` hands you a set of answers (single-vs-multi? heavy state/checkpointing? language? long-running?). Map each to a tooling axis. **There is no single default framework** — derive the pick from the axes, then verify each candidate's *current* state at the live comparison source.

| `01` decision (input) | Tooling consequence (output) |
|---|---|
| **Single-agent + tools** (the `01` default) | You may not need a framework at all. Raw provider SDK + a tool loop is often *a few lines* — and avoids the abstraction tax (Anthropic's *Building Effective Agents* explicitly warns frameworks "create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug"). Add a framework only when state/durability/multi-agent earns it. |
| **Multi-agent / explicit hand-offs** | Reach for handoff-native orchestration (e.g. OpenAI Agents SDK's handoff primitive; CrewAI's role/crew model; graph edges in LangGraph). Revisit `01`'s single-vs-multi default first — most "multi-agent" needs are one agent + tools. |
| **Heavy shared state / checkpointing / time-travel / human-in-the-loop mid-run** | Pick a framework with **first-class persistence** (graph-checkpointer model) *or* wire an external durable engine (next section). This is the strongest pull toward a heavyweight framework. |
| **Language: TypeScript** | TS-native options exist and are no longer second-class: Mastra, Vercel AI SDK, LangGraph.js (`@langchain/langgraph`), OpenAI Agents JS (`@openai/agents`). Don't bolt a Python framework onto a TS product. |
| **Language: Python** | Widest field: LangGraph, OpenAI Agents SDK (Python), CrewAI, Pydantic AI, Google ADK, smolagents. |
| **Long-running / resumable / survives deploys** | Durability is non-negotiable → in-framework checkpointer for simpler cases, dedicated durable-execution engine for hard ones (next section). |
| **Type-safety / "looks like real software" matters** | Pydantic AI (Python) or Vercel AI SDK / Mastra with Zod (TS) lean hardest into typed deps + validated structured output. |
| **Prompt quality is the bottleneck, you have a metric + examples** | This is a *different* tool, not a competing orchestrator: **DSPy** compiles/optimizes prompts (signatures + modules + optimizers like MIPROv2/GEPA). Use it to *produce* prompts that then run inside whatever orchestrator you chose. |

**Major options to know exist** (verify each one's *current* maturity + language support at the live comparison source before committing — do **not** trust this list's ordering as a ranking): **LangGraph / LangGraph.js**, **OpenAI Agents SDK** (Python + JS), **CrewAI**, **Mastra** (TS), **Pydantic AI** (Python), **Google ADK**, **smolagents**, and **DSPy** (the compiled-prompt outlier). Live, regularly-refreshed comparisons: the **LangChain** framework round-up and the **Speakeasy** comparison (both in *Deep-dive sources*) — treat write-ups as *dated snapshots*, never standing fact.

> **Selection heuristic:** start from your *single dominant constraint* (control & state → graph framework; team velocity → role/crew framework; type-safety/DX → typed framework; "as little framework as possible" → raw SDK + MCP). Don't shop features; eliminate by constraint.

### Durable / long-running execution (03 owns)

**Why it's a requirement, not a feature:** a multi-step agent is a long-lived stateful process. Without durability, any crash, timeout, rate-limit, deploy, or human-approval pause **loses the whole run** and re-runs side-effecting steps from scratch. So the real question isn't *"do I need durability?"* — it's *"in-framework persistence (on a _persistent_ backend) or a dedicated engine?"*

- **In-framework persistence** — e.g. LangGraph checkpointers snapshot graph state per super-step to a backend (in-memory / SQLite / Postgres) for human-in-the-loop and time-travel `[verified 2026-06-25 via docs.langchain.com/oss/python/langgraph/persistence]`. **Resume-after-crash/deploy needs a *persistent* backend (SQLite/Postgres-class); the in-memory backend dies with the process — it buys in-process pause/replay, not crash durability.** Cheapest when your orchestrator already provides it; sufficient for most agents.
- **Dedicated durable-execution engine** — when steps span minutes-to-days, fan out, need exactly-once side effects, or must outlive any single process. Category options to evaluate (verify current AI/agent support — it's moving fast): **Temporal** (durable workflows, multi-language SDKs, now marketing agent use-cases + framework integrations) `[verified 2026-06-25 via temporal.io]`; **Inngest** (durable functions, step-level retry/memoize, TS + Python, AI-positioned) `[verified 2026-06-25 via inngest.com]`; **Restate** (verify current state at restate.dev). Check each one's current state at its own site before committing.

> Pointer, not duplication: `01` links here for *checkpointing as an architecture concern*; `04` links here for *reliability* (retries/approval-gates) — the **tooling** lives in 03.

### Protocols (03 owns the wire detail)

- **MCP** — the standard for connecting agents to tools/context/data. **Latest spec: `2025-11-25`** `[verified 2026-06-25 via modelcontextprotocol.io/specification]`. Two standard transports: **stdio** (local subprocess) and **Streamable HTTP** (single endpoint, POST + optional SSE) — the latter **replaces** the deprecated 2024-11-05 HTTP+SSE transport `[verified 2026-06-25 via modelcontextprotocol.io/specification/2025-11-25/basic/transports]`. JSON-RPC 2.0; capability negotiation; security model puts tool descriptions in the *untrusted* bucket (consent before invocation). Spec version is pinned per-request via the `MCP-Protocol-Version` header. Re-check the version each cycle — it revises on a date-stamped cadence.
- **A2A** — agent↔agent interop. **v1.0**, donated by Google to the **Linux Foundation**, Apache-2.0, governed by a multi-vendor TSC `[verified 2026-06-25 via a2a-protocol.org/latest]`. Adoption is still early-and-moving — verify current uptake before betting on it. Mental model: **MCP = agent→tools; A2A = agent→agents.** They compose.

### Sandboxes / code-execution runtimes

For any agent that *runs code it generated* (coding agents, data-analysis, deep-research) you need isolation between model output and your host/prod. Evaluate runtimes on: isolation tech (microVM > container > process), cold-start latency, max session length, network/filesystem policy, and language coverage. Representative option to know: **E2B** — Firecracker-microVM sandboxes for untrusted AI code `[verified 2026-06-25 via e2b.dev]`; others in the category include Modal and Daytona (verify current capabilities at source). Some orchestrators now bundle sandbox-backed agents directly (e.g. OpenAI Agents JS "Sandbox agents"). Security framing (least-privilege, what the sandbox is *allowed* to reach) is owned by `04`.

### Structured-output enforcement (03 owns)

Reliability ladder — climb only as high as the task needs:

1. **Prompt-and-parse** — ask for JSON, parse, retry on failure. Brittle; fine for low-stakes.
2. **JSON mode** — guarantees *syntactically valid* JSON but **not** that it matches your schema (can omit required keys, invent enum values).
3. **Strict schema / constrained decoding** — output is *forced* to conform to the supplied JSON Schema. This is the meaningful reliability jump.
   - **OpenAI Structured Outputs** (`strict: true`): "the model will always generate responses that adhere to your supplied JSON Schema" — the schema-adherence step up from JSON mode (edge cases: refusals, token-limit truncation) `[verified 2026-06-25 via developers.openai.com/api/docs/guides/structured-outputs]`.
   - **Anthropic strict tool use** (`strict: true` on a tool definition): forces Claude's tool calls to match the schema exactly; combine with `tool_choice` to *force* a specific tool and use that tool's `input_schema` as your structured-output contract `[verified 2026-06-25 via platform.claude.com/docs/en/build-with-claude/tool-use]`.

> `01` links here whenever it needs "make the output reliable" — the *enforcement mechanism* is owned in 03; the *behavioral reason to want it* lives in `01`.

> **Shape ≠ truth.** Strict schema enforces *shape*; the claim-to-source grounding **check** lives in the boundary (`01`), the RAG pipeline in `recipes/rag.md`.

### Eval platforms / tooling (03 owns)

03 owns eval *platforms/tooling*; eval *methodology* lives in `02`. Options to know exist (verify each at source — `sources.md § Frameworks`): **Braintrust**, **Langfuse**, **OpenAI Evals**, **promptfoo**, **Inspect** (AISI), **DeepEval**. `02` links here whenever it needs "what do I run the evals *on*"; the *how-to-measure* stays in `02`.

---

## Minimum-viable vs full

| | **Minimum-viable** (low-stakes / internal / reversible) | **Full** (autonomous / customer-facing / irreversible) |
|---|---|---|
| Orchestration | Raw provider SDK + hand-rolled tool loop. No framework until justified. | Framework chosen by `01`'s axes (state/multi-agent/language/long-running). |
| Durability | "None" **only** for a single-step / stateless agent; any *multi-step* agent's floor is an in-framework checkpointer (in-memory acceptable at this tier — it gives in-process resume only, **not** crash/deploy durability). | Persistent checkpointer (Postgres-class) **or** dedicated durable engine; resume-after-crash/deploy tested. |
| Protocols | Direct tool calls; MCP client only if reusing existing servers. | MCP for tool/context reuse; A2A only if genuinely crossing agent/vendor boundaries. |
| Code exec | None, or trusted local exec you control. | Sandboxed runtime (microVM-class) with least-privilege network/fs. |
| Structured output | Prompt-and-parse, or JSON mode. | Strict schema / constrained decoding on every structured boundary. |

---

## Must-address checklist

- [ ] **Did you earn the framework?** Justify it from an `01` axis (state, multi-agent, long-running, language). If raw-SDK suffices, *use raw SDK* — abstraction is a debugging cost (per *Building Effective Agents*).
- [ ] **Language match.** Framework language == product language (don't graft Python onto a TS product or vice-versa).
- [ ] **Durability decided explicitly.** In-framework checkpointer or external engine — and you've tested a mid-run crash/resume (a *real* crash/deploy resume needs a persistent backend; an in-memory checkpointer survives only an in-process pause). ("None" is fine only for a single-step/stateless agent; for any *multi-step* agent it's a defect, not a default — the MV floor is an in-framework checkpointer.)
- [ ] **Side-effect safety under retry.** Retried/resumed steps are idempotent or guarded (no double-charges, double-emails).
- [ ] **Structured boundaries enforced.** Every machine-consumed output uses strict schema / constrained decoding, not prompt-and-pray.
- [ ] **Code execution is sandboxed** (if the agent runs generated code) with least-privilege reach.
- [ ] **Protocol fit.** MCP for tools/context; A2A *only* for real agent-to-agent crossing — not as default plumbing.
- [ ] **Every volatile claim opened at source.** Versions/maturity/adoption verified today, not recalled — this doc rots monthly.

---

## Safe-default stack picks

> ⚠️ **As of 2026-06-25, expect change.** These are *starting points to de-risk a blank page*, single-sourced and dated — **not** endorsements and **not** durable. Re-verify before adopting. The deeper Claude-specific picks live in `references/anthropic/`; this atlas is otherwise **provider-agnostic / TS-leaning** by default.

| Layer | Agnostic-TS pick (default lean) | Anthropic pick |
|---|---|---|
| Orchestration | **Vercel AI SDK** — provider-agnostic TS toolkit (`generateText`/`streamText`, tools, `generateObject`, agent loops) `[verified 2026-06-25 via ai-sdk.dev]`; or **Mastra** for a batteries-included TS framework (agents/workflows/memory/RAG/evals/MCP) `[verified 2026-06-25 via mastra.ai]`. | **Claude Agent SDK** for Claude-native production loops (verify at source — `sources.md § Frameworks`; deeper picks → `references/anthropic/`). |
| Durable exec | Framework checkpointer first; **Inngest** (TS-native durable functions) when you outgrow it `[verified 2026-06-25 via inngest.com]`. | Same category choice; durability is provider-agnostic. |
| Protocol | **MCP** client/server, spec `2025-11-25` `[verified 2026-06-25 via modelcontextprotocol.io]`. | MCP — first-class in the Claude tool/`tools` surface and MCP connector. |
| Structured output | `generateObject` (Zod schema) in Vercel AI SDK `[verified 2026-06-25 via ai-sdk.dev]`. | **Strict tool use** + forced `tool_choice` `[verified 2026-06-25 via platform.claude.com/docs/en/build-with-claude/tool-use]`. |
| Code sandbox | **E2B** (Firecracker microVMs) `[verified 2026-06-25 via e2b.dev]`. | Same — sandbox choice is provider-agnostic. |

---

## Deep-dive sources

See `sources.md § Frameworks` for the dated ledger. Primary/live sources this doc was verified against:

- **Anthropic — Building Effective Agents** (pattern→tool framing; the "start simple, frameworks add abstraction" stance) — `anthropic.com/engineering/building-effective-agents`.
- **Model Context Protocol** — `modelcontextprotocol.io` (spec `2025-11-25`; transports).
- **A2A Protocol** — `a2a-protocol.org/latest` (v1.0, Linux Foundation).
- **LangGraph / LangGraph.js** — `docs.langchain.com` + `github.com/langchain-ai/langgraphjs` (persistence/checkpointing; TS).
- **DSPy** — `dspy.ai` (compiled-prompt paradigm).
- **Live framework comparisons** (treat as dated snapshots): LangChain "best AI agent frameworks" round-up; Speakeasy framework comparison.
- Per-tool primaries: `temporal.io`, `inngest.com`, `e2b.dev`, `mastra.ai`, `ai-sdk.dev`, `developers.openai.com` (Structured Outputs), `platform.claude.com` (strict tool use), `openai.github.io/openai-agents-{python,js}`.
