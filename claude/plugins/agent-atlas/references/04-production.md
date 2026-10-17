<!-- last-reviewed: 2026-06-25 -->
# 04 — Production Ops

> **Owns:** running an agent safely + affordably — plus the cross-cutting concerns (security, data/PII, cost) that hide here and get skipped.  ·  **Minimum-viable** (low-stakes/internal/reversible): structured trace per run · I/O validation · timeouts + capped retries · token budget · least-privilege tools · don't log raw PII.  ·  **Full** (autonomous/customer-facing/irreversible): + threat-model to OWASP/ATLAS · injection defense-in-depth · HITL gate on irreversible actions · fallbacks/circuit-breakers · checkpoint-resume · trace retention + PII policy · model routing/caching.

Cross-cutting concerns are *raised* in Station 0 and *owned* here. This doc OWNS: observability/tracing · guardrails · security · reliability · cost/latency · data/privacy/compliance · deployment patterns. Pointers only: durable-exec *tooling* → `03` · eval methodology + data-flywheel *ownership* → `02` · structured-output *enforcement* → `03`.

## Canonical terms

- **Trajectory / trace** — here, the observability trace: the full ordered record of one run — prompts, tool calls + args + results, intermediate model outputs, tokens, latency, cost (cf. *trajectory eval* = grading the eval-path in `02`). The unit of debugging *and* the raw material for eval sets (→ `02`). A **span** is one step; a **trace** is the tree.
- **OTel GenAI semantic conventions** — OpenTelemetry's `gen_ai.*` attribute namespace for LLM/agent telemetry (spans for inference, **agents**, **tool execution**, evaluation, MCP). Vendor-neutral schema; still evolving — pin the dated entry before relying on exact attribute names. [verified 2026-06-25 — covers client inference, agents, tool execution, eval, MCP, via github.com/open-telemetry/semantic-conventions-genai]
- **Guardrail** — a deterministic or model-based check *around* the LLM (input filter, output validator, moderation, schema check). Distinct from prompts: enforced in code, fails closed. A **critical** verdict gates the action or "done" signal (runtime parallel of the doorway gate → `00`).
- **Prompt injection** — adversarial instructions that hijack the model. **Direct** (user types them) vs **indirect / cross-domain** (instructions ride in *retrieved/tool-returned content* — a web page, doc, email, MCP result). Indirect is the dangerous one for agents: the attacker isn't the user. OWASP **LLM01**; ATLAS technique family `AML.T0051`.
- **Excessive agency** — harm from too much autonomy/permission/tool-scope (OWASP **LLM06**): the agent *can* do the damaging thing. Mitigation is least-privilege + HITL, not better prompting.
- **Defense-in-depth (injection)** — layered, since no single filter is sufficient: **spotlighting** (delimit/encode untrusted content so the model can tell data from instructions) · **dual-LLM / CaMeL** (a privileged planner that never sees raw untrusted text; a quarantined LLM processes it with no tool access) · **least-privilege tool scoping** · **HITL for irreversible actions** · **sandboxing** (network/filesystem isolation for code-exec).
- **Prompt caching** — reuse a cached prompt *prefix* across calls. Anthropic matches `tools → system → messages` in order up to a `cache_control` breakpoint (≤4 breakpoints); cache-read is far cheaper than reprocessing, cache-write a small premium; short default TTL with a longer opt-in. [verified 2026-06-25 — read ≈0.1× base input, 5-min-write ≈1.25× / 1-h-write ≈2× base, default 5-min TTL + `ttl:"1h"` option, via platform.claude.com/docs (prompt-caching)]. Model-specific token minimums/prices: `sources.md § Production`.
- **Model routing / cascade** — send easy turns to a cheap/fast model, escalate hard ones (or on low confidence / failed self-check) to a stronger one. Primary cost-latency lever once caching is in.
- **Semantic caching** — return a stored response for an *embedding-similar* request (not byte-identical). Powerful but risks stale/wrong hits — gate by similarity threshold + freshness.
- **Data flywheel** — production traces *originate here* (you own the traces); methodology & ownership live in `02`.

## Decision procedures

**Trace everything? — DEFAULT YES.** Emit one structured trace per run from day one (OTel GenAI conventions if you can — portable). It is the *only* way to debug non-determinism and the source of eval data (→ `02`). The question is retention + redaction, not whether.

**Injection defense — scope by untrusted-input × blast-radius:**
- Agent reads *only* trusted input, no side-effects → input validation + output schema is enough.
- Agent ingests untrusted content (RAG, web, email, tool/MCP results) → assume indirect injection. Add **spotlighting** + **least-privilege tools**; for high blast-radius, **dual-LLM/CaMeL** + **HITL on irreversible actions**.
- Agent runs code/shell → **sandbox** (no ambient network/creds) is non-negotiable.
- *Rule:* never let untrusted text reach a high-privilege tool without a trust boundary. Prompts *reduce* injection risk; they don't *eliminate* it — pair with code-enforced guardrails.

**HITL approval gate — DEFAULT: gate any irreversible or externally-visible action** (payment, email/message send, delete, prod write, spend over $X). Reversible/internal/idempotent → autonomous. Decide per *tool*, not per agent. (`04` owns the *policy* — when to gate, the approval UX; `01` owns the *mechanism* — the state-machine/resume that implements the pause.)

**Reliability ladder (cheap → strong), apply by blast radius:** timeouts → bounded retries w/ backoff (idempotent ops only) → fallback (cheaper/alt model or degraded answer) → circuit breaker (stop hammering a failing dep) → checkpoint + resume for long/multi-step runs (durable-exec *tooling* → `03`) → approval gate.

**Cost/latency ladder (do in order, measure each):** (1) **prompt caching** for stable prefixes (system, tools, few-shot, big context) — biggest, lowest-risk win; (2) **token budgeting** — cap context + output, prune history, summarize; (3) **model routing/cascade**; (4) **semantic caching** for repetitive read-heavy traffic. Profile with traces before optimizing — don't guess the bottleneck.

**Deployment shape — pick by run duration + state:**
- Short, stateless turns → **serverless** (cheap, scales to zero; watch cold starts + execution-time caps).
- Long/multi-step/stateful/HITL-paused runs → **long-running service or a durable-execution runtime** (survives restarts, resumes from checkpoint → `03`).
- Want managed orchestration/memory/observability bundled → **managed agent platform** (faster start, less control, lock-in; vendor specifics → `sources.md`, dated).

## Minimum-viable vs full

| Concern | Minimum-viable | Full (production / high-stakes) |
|---|---|---|
| **Observability** | Structured trace per run (prompts, tool I/O, tokens, cost, latency) | OTel GenAI spans, sampling, alerting, dashboards; traces feed eval sets (→`02`) |
| **Guardrails** | Input validation + output schema check (→`03`) | + moderation/PII filters, output gating, jailbreak/refusal checks, fail-closed |
| **Security** | Least-privilege tools; no secrets in prompts; sandbox code-exec | Threat-model to OWASP LLM Top-10 + ATLAS; injection defense-in-depth; red-team; secrets mgmt; audit log |
| **Reliability** | Timeouts + bounded retries | Fallbacks, circuit breakers, checkpoint/resume, idempotency keys, approval gates |
| **Cost/latency** | Token budget + prompt caching | + model routing/cascade, semantic caching, per-tenant budgets + ceiling behavior |
| **Data/privacy** | Don't log raw PII/secrets in traces | Retention + redaction policy, regional/consent constraints, consent before reusing customer data in eval sets |

## Must-address checklist

- [ ] **One structured trace per run** — prompts, tool calls + args + results, tokens, latency, cost. (OTel GenAI conventions if portable.)
- [ ] **Tools are least-privilege** and **irreversible actions sit behind an HITL gate** or hard policy check.
- [ ] **Untrusted input is treated as hostile** — indirect injection considered for every RAG/web/email/tool/MCP source; spotlighting + trust boundary where it can reach a privileged tool.
- [ ] **Code/shell execution is sandboxed** — no ambient network, creds, or host access.
- [ ] **Failure is handled** — timeouts, bounded retries, a fallback/degraded path; circuit breaker on flaky deps; long runs checkpoint + resume.
- [ ] **Critical self-check/eval findings gate completion** — a failing critical guardrail/evaluator blocks the action or "done" (fail-closed), not logged-and-shipped (runtime parallel of the doorway gate → `00`).
- [ ] **Cost is bounded** — per-task/tenant token+$ budget with defined behavior at the ceiling; caching on stable prefixes.
- [ ] **PII/secrets are not in traces/logs**; trace **retention + redaction** policy set; **regional/consent** constraints checked.
- [ ] **Customer data in eval sets has consent/legal basis** (→ data-flywheel ownership in `02`).
- [ ] **Threat-modeled** against the current OWASP LLM Top-10 + relevant ATLAS techniques before exposing autonomous/external actions.

## Deep-dive sources

See `sources.md § Production`. Anchors: **OWASP Top 10 for LLM Applications** (genai.owasp.org) · **MITRE ATLAS** (atlas.mitre.org) · **OpenTelemetry GenAI semantic conventions** (github.com/open-telemetry/semantic-conventions-genai) · **Anthropic prompt-caching** (platform.claude.com/docs). Use traces as eval data → `02` · durable-exec tooling + structured-output enforcement → `03`.
