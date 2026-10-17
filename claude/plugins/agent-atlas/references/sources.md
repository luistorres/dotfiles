<!-- last-reviewed: 2026-06-27 -->
# sources.md — the source ledger

The place canonical URLs and volatile specifics concentrate, so a quarterly re-verification pass is *centred* here. (Station/recipe/anthropic docs also carry inline verified-stamps per the authoring rule below; `grep -rnE '\(verified|\[verified' references/` lists every stamp across files — catching both the `[verified …]` and the parenthetical `(verified …)` forms — so a re-verify pass misses none.) Every volatile claim in a station doc cites an entry here.

**Status legend:**
- `canon` — foundational, slow-moving; high confidence it's real and stable.
- `live` — expect revision; re-check before quoting specifics (versions, numbers, "state of X").
- `VERIFY` — URL/currency **not yet tool-confirmed this cycle**; confirm via `WebFetch` + stamp `verified:YYYY-MM-DD` during station authoring.

> Authoring rule: a source graduates from `VERIFY` only after a real `WebFetch` confirms the URL is live and current; then add `verified:<date>`. Volatile *numbers* (benchmark %, prices, versions) live here as dated entries — never inline in a station doc without `[verified … via …]`.

---

## § Architecture (01)
| Source | URL | Status |
|---|---|---|
| Anthropic — Building Effective Agents | anthropic.com/engineering/building-effective-agents | `canon` · verified:2026-06-25 |
| Anthropic — How we built our multi-agent research system | anthropic.com/engineering/built-multi-agent-research-system | `live` · verified:2026-06-25 |
| Cognition — Don't Build Multi-Agents (Walden Yan) | cognition.com/blog/dont-build-multi-agents (was cognition.ai → 301) | `canon` · verified:2026-06-25 |
| Anthropic — Effective context engineering for AI agents | anthropic.com/engineering/effective-context-engineering-for-ai-agents | `live` · verified:2026-06-25 |
| 12-Factor Agents (Dexter Horthy / HumanLayer) | github.com/humanlayer/12-factor-agents | `canon` · verified:2026-06-25 |
| Lilian Weng — LLM-Powered Autonomous Agents | lilianweng.github.io/posts/2023-06-23-agent/ | `canon` · verified:2026-06-25 |
| Andrew Ng / DeepLearning.AI — Agentic Design Patterns (4 patterns) | x.com/AndrewYNg/status/1773393357022298617 · course: deeplearning.ai/courses/agentic-ai | `canon` · verified:2026-06-25 |

## § Evals (02)
| Source | URL | Status |
|---|---|---|
| Anthropic — Demystifying Evals for AI Agents | anthropic.com/engineering/demystifying-evals-for-ai-agents | `canon` · verified:2026-06-25 |
| Hamel Husain — Field Guide to Rapidly Improving AI Products | hamel.dev/blog/posts/field-guide/ | `canon` · verified:2026-06-25 |
| Hamel Husain — Evals FAQ | hamel.dev/blog/posts/evals-faq/ | `canon` · verified:2026-06-25 |
| Eugene Yan — LLM-Evaluators (LLM-as-Judge) | eugeneyan.com/writing/llm-evaluators/ | `canon` · verified:2026-06-25 |
| Shreya Shankar et al. — Who Validates the Validators? (EvalGen, UIST'24) | arxiv.org/abs/2404.12272 | `canon` · verified:2026-06-25 |
| Sierra — τ-bench / τ²-bench (origin of `pass^k`; multi-turn policy-following; **live leaderboard for numbers**) | github.com/sierra-research/tau2-bench · sierra.ai/blog/tau-bench-shaping-development-evaluation-agents | `live` · verified:2026-06-25 |
| Agent benchmarks (SWE-bench, GAIA, WebArena, τ-bench) — baselines only; read each project's live leaderboard for numbers (no scores enshrined here). τ-bench detail: row above. | swebench.com · huggingface.co/gaia-benchmark · webarena.dev · github.com/sierra-research/tau2-bench | `live` |
| Chip Huyen — AI Engineering (book; broad reference, no dated specifics) | oreilly.com/library/view/ai-engineering/9781098166298/ | `canon` |

## § Frameworks (03)
> Highest-rot section — every row is a live doc; **open the source before quoting a version/number.** No star-counts/funding/version numbers enshrined here by design (they were verified-then-dropped during authoring).
| Source | URL | Status |
|---|---|---|
| Model Context Protocol (MCP) — spec `2025-11-25`; stdio + Streamable HTTP (replaces deprecated 2024-11-05 SSE) | modelcontextprotocol.io/specification | `live` · verified:2026-06-25 |
| A2A (Agent2Agent) — v1.0, donated to Linux Foundation (Apache-2.0); agent↔agent, complements MCP | a2a-protocol.org/latest | `live` · verified:2026-06-25 |
| LangGraph / LangGraph.js — graph + checkpointer persistence (resume / HITL / time-travel) | docs.langchain.com/oss/python/langgraph/persistence · github.com/langchain-ai/langgraphjs | `live` · verified:2026-06-25 |
| OpenAI Agents SDK (Python + JS) — agents/handoffs/guardrails/sessions/tracing; sandbox agents (JS) | openai.github.io/openai-agents-python · github.com/openai/openai-agents-js | `live` · verified:2026-06-25 |
| Mastra (TS) — batteries-included agent framework (agents/workflows/memory/RAG/evals/MCP) | mastra.ai | `live` · verified:2026-06-25 |
| Vercel AI SDK (TS) — provider-agnostic toolkit; `generateObject` structured output | ai-sdk.dev | `live` · verified:2026-06-25 |
| DSPy — compiled-prompt paradigm (signatures / modules / optimizers) | dspy.ai | `live` · verified:2026-06-25 |
| Temporal — durable-execution engine (multi-lang SDKs; agent use-cases) | temporal.io | `live` · verified:2026-06-25 |
| Inngest — durable functions (step retry/memoize; TS + Python) | inngest.com | `live` · verified:2026-06-25 |
| E2B — Firecracker-microVM sandboxes for untrusted AI-generated code | e2b.dev | `live` · verified:2026-06-25 |
| OpenAI Structured Outputs (`strict:true` — schema adherence) | developers.openai.com/api/docs/guides/structured-outputs | `live` · verified:2026-06-25 |
| Anthropic strict tool use (`strict:true` + `tool_choice`) | platform.claude.com/docs/en/build-with-claude/tool-use | `live` · verified:2026-06-25 |
| Claude Agent SDK — Claude-native production agent loops | platform.claude.com (agent-sdk) · code.claude.com (agent-sdk) | `live` |
| CrewAI — role/crew multi-agent framework (verify at source) | crewai.com | `live` |
| Pydantic AI — typed Python agent framework (verify at source) | ai.pydantic.dev | `live` |
| Google ADK — Agent Development Kit (verify at source) | google.github.io/adk-docs | `live` |
| smolagents — minimal agent framework (verify at source) | huggingface.co/docs/smolagents | `live` |
| Eval platforms (03 owns tooling; methodology → § Evals) — verify each at source | Braintrust · Langfuse · OpenAI Evals · promptfoo · Inspect (AISI) · DeepEval | `live` |
| Live framework comparisons (treat as **dated snapshots**, not standing fact) | langchain.com ("best AI agent frameworks" round-up) · speakeasy.com (framework comparison) | `live` |

## § Production (04)
| Source | URL | Status |
|---|---|---|
| OWASP Top 10 for LLM Applications — **2025** list (LLM01 Prompt Injection … LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector/Embedding Weaknesses, LLM09 Misinformation, LLM10 Unbounded Consumption) | genai.owasp.org/llm-top-10 | `live` · verified:2026-06-25 |
| MITRE ATLAS — Adversarial Threat Landscape for AI Systems; ATT&CK-style tactic/technique matrix; prompt-injection family `AML.T0051` (Spring-2025 release added RAG-poisoning & related agentic GenAI techniques) | atlas.mitre.org | `live` · verified:2026-06-25 |
| OpenTelemetry GenAI semantic conventions — `gen_ai.*` namespace; covers client inference, **agents**, **tool execution**, evaluation, MCP; still evolving (pin attribute names before relying on them) | github.com/open-telemetry/semantic-conventions-genai | `live` · verified:2026-06-25 |
| Anthropic — prompt caching (docs moved to platform.claude.com; redirect from docs.anthropic.com). Durable mechanics: prefix match `tools→system→messages`, ≤4 `cache_control` breakpoints, read ≈0.1× / 5-min-write ≈1.25× / 1-h-write ≈2× base input, default 5-min TTL + `ttl:"1h"`. **Per-model token minimums + $ prices are volatile — re-fetch, do not cache here.** | platform.claude.com/docs (prompt-caching) | `live` · verified:2026-06-25 |

## § RAG / Retrieval (recipe)
| Source | URL | Status |
|---|---|---|
| Lewis et al. 2020 — Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks (origin of RAG; NeurIPS 2020) | arxiv.org/abs/2005.11401 | `canon` · verified:2026-06-25 |
| Anthropic — Contextual Retrieval (contextual embeddings + contextual BM25; hybrid + rerank; top-20 retrieval-failure reduction 49% → 67% with reranking) | anthropic.com/news/contextual-retrieval | `canon` · verified:2026-06-25 |
| RAGAS — retrieval-quality metrics (context precision/recall, faithfulness, answer relevancy); eval *methodology* → § Evals | docs.ragas.io/en/stable/concepts/metrics/available_metrics | `live` · verified:2026-06-25 |
| Microsoft GraphRAG — graph + community-summary RAG for global/aggregative queries (demo, not an officially supported product; expensive indexing) | github.com/microsoft/graphrag | `live` · verified:2026-06-25 |
| Pinecone — Hybrid search primer (dense + sparse/BM25, fusion, alpha-weighting); the retrieval *stack* itself → § Frameworks | docs.pinecone.io/guides/search/hybrid-search | `live` · verified:2026-06-25 |
| HyDE — Gao et al. 2022, Precise Zero-Shot Dense Retrieval without Relevance Labels | arxiv.org/abs/2212.10496 | `canon` · verified:2026-06-25 |
| Reciprocal Rank Fusion — Cormack, Clarke & Buettcher 2009, SIGIR (origin of RRF; `Σ 1/(k+rank)`) — DOI paywalled, URL not tool-confirmed | dl.acm.org/doi/10.1145/1571941.1572114 | `VERIFY` |

## § Coding / Automation (recipe)
| Source | URL | Status |
|---|---|---|
| DeepMind — Specification gaming: the flip side of AI ingenuity (Krakovna et al.; canonical framing of reward-hacking — "behaviour that satisfies the literal specification of an objective without achieving the intended outcome"; why a gameable executable verifier must be guarded) | deepmind.google/discover/blog/specification-gaming-the-flip-side-of-ai-ingenuity | `canon` · verified:2026-06-25 |
| _Coding-task benchmarks (SWE-bench et al.) are single-sourced in **§ Evals** (agent-benchmarks row) — baselines only; the coding recipe routes there._ | — | — |

## § Anthropic (references/anthropic)
| Source | URL | Status |
|---|---|---|
| Claude Agent SDK — Claude Code as a library (TS `@anthropic-ai/claude-agent-sdk` + Python `claude-agent-sdk`); built-in tools, subagents, sessions, hooks, MCP, permissions. **Renamed from "Claude Code SDK".** | code.claude.com/docs/en/agent-sdk/overview | `live` · verified:2026-06-25 |
| Claude Managed Agents — hosted agent harness + sandbox (Agent/Environment/Session/Events over SSE); long-running/async. **Beta** (`managed-agents-2026-04-01`); not ZDR/HIPAA-eligible. | platform.claude.com/docs/en/managed-agents/overview | `live` · verified:2026-06-25 |
| Claude MCP connector — call remote MCP servers from the Messages API (HTTPS, OAuth, tool-calls only). Header `mcp-client-2025-11-20` (`2025-04-04` deprecated). Protocol detail → § Frameworks. | platform.claude.com/docs/en/agents-and-tools/mcp-connector | `live` · verified:2026-06-25 |
| Agent Skills — `SKILL.md` + YAML frontmatter; progressive disclosure; claude.ai / API / Claude Code (no cross-surface sync). `anthropic`/`claude` reserved in `name`. | platform.claude.com/docs/en/agents-and-tools/agent-skills/overview | `live` · verified:2026-06-25 |
| Claude models — **read live; nothing enshrined.** Selection principle = capability-vs-cost/latency tier; ids are pinned snapshots (Models API). | platform.claude.com/docs/en/about-claude/models/overview | `live` · verified:2026-06-25 |
| Anthropic structured outputs / strict tool use — `output_config.format` (json_schema) + `strict:true`, now **GA**. Mechanics → § Frameworks. | platform.claude.com/docs/en/build-with-claude/structured-outputs · platform.claude.com/docs/en/build-with-claude/tool-use | `live` · verified:2026-06-25 |

---

## Provenance
The atlas's taxonomy was seeded by three mid-2026 landscape surveys (evals · architecture/orchestration · frameworks/production), which were **non-normative** — unverified, possibly post-cutoff specifics. The raw surveys were not retained as citable material; every volatile fact in `references/` was re-confirmed against a primary source (the dated entries above) before it was admitted.
