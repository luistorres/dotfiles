<!-- last-reviewed: 2026-06-27 -->
# Anthropic subset
> When this applies: the project uses Claude, Claude Code, MCP, Agent Skills, or has Anthropic-specific deploy/eval/security constraints. · Kept deliberately **pointer-heavy** (highest-rot content: SDK names, model ids, prices, spec versions, beta headers churn monthly — and getting them wrong in an Anthropic shop is the worst miss). · Agnostic core = the router + four stations (`00`–`04`); **this layer is the Claude-native specialization**, not a restatement of the SDK.
>
> ⚠️ **Verify before quoting any specific.** Every model id / price / version / beta header below is either stamped `[verified YYYY-MM-DD via <primary URL>]` or replaced by "check current at \<url\>". The Anthropic ecosystem revises on a roughly **monthly** cadence — open the live doc, don't trust this page's memory. Re-verify the dated table quarterly.

---

## When to use the Anthropic layer

The agnostic stations (`01`–`04`) already answer *what shape* and *how to choose*. Drop into **this** layer only once the provider is settled on Anthropic — then prefer the Claude-native pick over the agnostic default **where it earns it**. Trigger signals:

- The codebase imports `@anthropic-ai/*` / `anthropic` (Python) / `claude-agent-sdk`, runs **Claude Code**, ships **Agent Skills**, or talks **MCP** to Claude.
- The question is *which Claude model / what does it cost / token limits / caching / refusals* — **never answer these from memory** (they're the highest-rot facts here); open the live doc.
- There are Anthropic-specific constraints: ZDR/HIPAA eligibility, Bedrock/Vertex/Foundry routing, beta-header gating.

If the provider is **not** Anthropic (or unstated and a competitor is in-tree), stay in the agnostic stations — don't impose Claude-native picks.

---

## The Claude-native stack (decision criteria + dated pointers)

**Claude Agent SDK** (TypeScript + Python) — *Claude Code as a library*: the same agent loop, built-in tools (Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch/…), **subagents**, **sessions** (resume/fork), **hooks** (`PreToolUse`/`PostToolUse`/`SessionStart`/…), **permissions**, and **MCP** support — programmable. Packages: `@anthropic-ai/claude-agent-sdk` (TS) · `claude-agent-sdk` (Python ≥3.10) `[verified 2026-06-25 via code.claude.com/docs/en/agent-sdk/overview]`. *Note: the SDK was renamed from "Claude Code SDK" → "Claude Agent SDK" — older names/imports are stale.*
- **Reach for it when** the agnostic `03` decision lands on "Claude-native production loop and I want the Claude Code toolchain for free" — built-in tool execution, filesystem-based `.claude/` config (Skills, CLAUDE.md, slash commands), CI/CD or app embedding. **vs `03`'s agnostic picks** (Vercel AI SDK / Mastra / LangGraph): choose those when you need provider-agnosticism or a graph/durable model the SDK doesn't impose.
- **vs the raw Anthropic Client SDK** (`anthropic`): the Client SDK is direct Messages-API access where *you* write the tool loop; the Agent SDK runs the loop for you. `01`'s "do I even need a framework?" gate still applies — a single-step Claude call wants the Client SDK, not the agent harness.
- Pointer (open before quoting versions/tool lists): `code.claude.com/docs/en/agent-sdk/overview`.

**MCP (Anthropic originated it)** — protocol/transport detail is owned by **`../03-frameworks.md`** (spec, stdio vs Streamable HTTP, JSON-RPC); don't re-teach it here. Claude-native angle = **how Claude *consumes* MCP**:
- **In Claude Code / Agent SDK:** configure `mcpServers` (local stdio or remote) — the agent connects as an MCP client.
- **From the Messages API directly:** the **MCP connector** lets Claude call remote MCP servers (HTTPS; Streamable HTTP or SSE; OAuth bearer tokens; **tool-calls only**) with no client of your own — current beta header `mcp-client-2025-11-20` (the older `mcp-client-2025-04-04` is **deprecated**; tool config moved into the `tools` array as `mcp_toolset`) `[verified 2026-06-25 via platform.claude.com/docs/en/agents-and-tools/mcp-connector]`. Not on Bedrock/Vertex.
- Pointers: connector → `platform.claude.com/docs/en/agents-and-tools/mcp-connector`; protocol → `../03-frameworks.md` → `modelcontextprotocol.io`.

**Agent Skills** — portable, filesystem-based capability packages (a `SKILL.md` with YAML `name`/`description` frontmatter + optional bundled instructions/scripts/resources), loaded by **progressive disclosure** (metadata always; body on trigger; bundled files only when referenced). **agent-atlas itself is authored as a Skill** (`skills/agentic-dev/SKILL.md`). Work across claude.ai, the Claude API (beta headers + Skills API), and Claude Code (filesystem, no upload) — but **don't auto-sync across surfaces** `[verified 2026-06-25 via platform.claude.com/docs/en/agents-and-tools/agent-skills/overview]`.
- **When/why:** package reusable domain expertise/workflows once, let Claude load it on-demand — cheaper and more composable than re-prompting. Reserved words `anthropic`/`claude` are disallowed in `name`. **Security:** treat an untrusted Skill like installing software (it can direct tool use) — audit before use; this is a `../04-production.md` concern.
- Pointer: `platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`.

**Prompt caching** — the **Anthropic-stack cost default**. Durable mechanics (prefix order, `cache_control` breakpoints, read/write multipliers, TTLs) are owned by **`../04-production.md`** — not duplicated here. The Claude-native point: on repeated prompt prefixes (long system prompt, tool defs, RAG context), turn it on as the **first** cost/latency lever before reaching for a smaller model. Default 5-min TTL; `ttl:"1h"` option exists `[verified 2026-06-25 via platform.claude.com/docs/en/build-with-claude/prompt-caching]`. **Per-model token minimums + $ prices are volatile — re-fetch, never cache here.** Pointer: `../04-production.md` → `platform.claude.com/docs/en/build-with-claude/prompt-caching`.

**Strict tool use / structured output** — Claude-native reliability. Enforcement mechanics (the JSON-mode → strict-schema ladder) are owned by **`../03-frameworks.md`**. Claude-native picks: **strict tool use** (`strict: true` on a tool def) + forced `tool_choice` — use the forced tool's `input_schema` as your structured-output contract; and **structured outputs** via `output_config.format` (`type:"json_schema"`). Both are now **GA** — the old `structured-outputs-2025-11-13` beta header is no longer required `[verified 2026-06-25 via platform.claude.com/docs/en/build-with-claude/structured-outputs]`. Pointer: `../03-frameworks.md` → `platform.claude.com/docs/en/build-with-claude/tool-use`.

**Managed agents / hosted execution** — **Claude Managed Agents** *does* exist: a hosted REST API where Anthropic runs the agent harness + sandbox; you create an Agent (model/prompt/tools/MCP/skills) + Environment (cloud or self-hosted sandbox), open a **Session**, and stream **Events** over SSE. Best for **long-running / asynchronous** work where you don't want to operate the loop, sandbox, or session store. **Beta** — header `managed-agents-2026-04-01`; **not** ZDR/HIPAA-eligible (stateful by design) `[verified 2026-06-25 via platform.claude.com/docs/en/managed-agents/overview]`. **vs Agent SDK:** SDK runs in *your* process on *your* files; Managed Agents runs in Anthropic infra on a per-session sandbox. Common path: prototype on the SDK, move to Managed Agents for production. Pointer: `platform.claude.com/docs/en/managed-agents/overview`.

**Model selection** — **do NOT enshrine model names/prices** (the single highest-rot fact in the whole atlas). Apply the *selection principle*, then read the live table:
- **Pick by capability-vs-cost/latency tier**, not by name: most-capable tier (Opus-class) for complex reasoning / long-horizon agentic coding; balanced tier (Sonnet-class) for the best speed↔intelligence trade; fastest/cheapest tier (Haiku-class) for high-volume / latency-sensitive. Start at the most-capable model for hard tasks, then step *down* tiers while quality holds (and lean on **prompt caching** before downgrading).
- Treat every model id as a **pinned snapshot** (4.6-gen and later use a dateless-but-still-pinned id format). Check current ids / context windows / max-output / cutoffs / prices at the live doc; query capabilities programmatically via the **Models API**.
- Pointer (open every time — do not quote from here): `platform.claude.com/docs/en/about-claude/models/overview` · prices: `platform.claude.com/docs/en/about-claude/pricing`.

---

## Anthropic-stack defaults per layer
*(Mirrors `../03-frameworks.md`'s "safe-default stack picks", Claude-native. Each cell is a dated pointer — a starting point to de-risk a blank page, **not** an endorsement. Open the source before adopting; re-verify quarterly.)*

| Layer | Claude-native default | Pointer (verify at source) |
|---|---|---|
| Orchestration | **Claude Agent SDK** (TS + Python) — Claude Code as a library; built-in tools, subagents, sessions, hooks, MCP. | `code.claude.com/docs/en/agent-sdk/overview` `[verified 2026-06-25]` |
| Hosted execution | **Claude Managed Agents** (beta) for long-running / async, infra-free. | `platform.claude.com/docs/en/managed-agents/overview` `[verified 2026-06-25]` |
| Protocol | **MCP** — first-class in the Claude tool surface; **MCP connector** for remote servers from the Messages API. Wire detail → `../03-frameworks.md`. | `platform.claude.com/docs/en/agents-and-tools/mcp-connector` `[verified 2026-06-25]` |
| Capability packaging | **Agent Skills** (`SKILL.md` + progressive disclosure). | `platform.claude.com/docs/en/agents-and-tools/agent-skills/overview` `[verified 2026-06-25]` |
| Structured output | **Strict tool use** + forced `tool_choice`, or **structured outputs** (`output_config.format`) — both GA. Mechanics → `../03-frameworks.md`. | `platform.claude.com/docs/en/build-with-claude/tool-use` · `…/structured-outputs` `[verified 2026-06-25]` |
| Cost optimization | **Prompt caching** as the default lever (before model-downgrade). Mechanics → `../04-production.md`. | `platform.claude.com/docs/en/build-with-claude/prompt-caching` `[verified 2026-06-25]` |
| Model choice | **Selection principle** (capability-vs-cost/latency tier); ids/prices are pinned-but-volatile — never enshrined. | `platform.claude.com/docs/en/about-claude/models/overview` `[verified 2026-06-25]` |

---

## Deep-dive sources

See **`../sources.md § Anthropic`** for the dated ledger (the rows that back this doc concentrate there, so quarterly re-verification is *centred* on one file — though this doc's own inline `[verified …]` stamps must be swept too; see the `grep` helper in `sources.md`). Primary Anthropic surfaces this doc was verified against today:

- **Claude Agent SDK** — `code.claude.com/docs/en/agent-sdk/overview` (capabilities; Agent-SDK-vs-Client-SDK-vs-Managed-Agents).
- **Claude Managed Agents** — `platform.claude.com/docs/en/managed-agents/overview` (hosted harness; beta).
- **MCP connector** — `platform.claude.com/docs/en/agents-and-tools/mcp-connector` (remote MCP from the Messages API).
- **Agent Skills** — `platform.claude.com/docs/en/agents-and-tools/agent-skills/overview` (Skill structure; progressive disclosure; surfaces).
- **Models overview** — `platform.claude.com/docs/en/about-claude/models/overview` (read live; nothing quoted here).
- **Prompt caching** (→ `../04`) · **strict tool use / structured outputs** (→ `../03`) — Claude-native picks; mechanics in their owning stations.

> **Note — this subset is the template for future stack subsets.** `references/python/` and `references/openai/` should follow this same shape: a trigger line → "when to use this layer" → decision-criteria + dated pointers (never inlined volatile specifics) → a per-layer defaults table mirroring `03` → deep-dive pointer into `sources.md §`. The discipline that matters most to copy: **link, don't state** for anything that rots.
