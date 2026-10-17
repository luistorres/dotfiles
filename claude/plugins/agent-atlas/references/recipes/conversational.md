<!-- last-reviewed: 2026-06-25 -->
# Conversational / Support — recipe
> Owns: the **conversation spine** — how a multi-turn dialogue carries state turn-to-turn and how a turn *feels* (latency, repair, handoff UX) — the experience layer no station isolates. · Ties stations 01–04 for the conversational/support archetype. · **Minimum-viable:** carry the transcript in-context → pinned persona + scope boundary → stream + one clarifying-question repair → a working escalate-to-human path → one multi-turn task-success check. · **Full:** session + durable memory with compaction → grounded retrieval (→ RAG) → deflect/escalate threshold tuned against cost → warm transfer with a handoff packet → multi-turn / `pass^k` eval suite.

This recipe is **thin on purpose**: a support agent maps onto the stations almost completely (memory → `01`, evals → `02`, session/tool tooling → `03`, guardrails + handoff *policy* → `04`). We don't re-teach what a chatbot *is* (a strong model knows "read the message, reply in context"). The value is the one thing no station isolates — the **conversation spine**: what state survives turn-to-turn and how the dialogue *feels* to the user — and the support-shaped decision calls that fall out of it. Everything else is a one-line pointer to its owning station; follow it, don't expand it here.

**Archetype gate (from `../00-start-here.md`):** conversational = the agent *holds multi-turn dialogue with a user*. A scripted dialogue tree or a single intent-classifier with no back-and-forth is **not** this archetype — that's the Station-0 off-ramp / a workflow (ticket *triage/classification* with no dialogue → **workflow-automation**; genuinely both → multi-archetype). If the agent reasons across turns, holds state, calls tools, and *decides on its own* to escalate, it's a *conversational-agentic* support agent (→ `01`).

---

## The conversation spine   (the owned content)

Four concerns no station owns. Each names the call and when the knob earns its cost; defaults favor the simplest dialogue that resolves the user's intent.

**1. Session & turn state — what to carry turn-to-turn.** `01` owns the memory *types* and the short-term-in-context vs long-term-external split — don't restate it. The layer it doesn't cover is the conversation-specific one: the **running transcript** carried in-context across turns of one session — a chat agent's default memory, and the first thing to overflow. The owned calls are *what to carry* (resolved facts + the open/unresolved intent, not every token of the transcript verbatim) and *when to compact* (summarize closed sub-threads but **preserve open commitments + the current goal** — a dropped commitment mid-conversation is a visible failure). Mechanism — compaction, just-in-time retrieval, context rot, and *whether you need durable memory at all* — → `01`.

**2. Grounding the dialogue — persona, scope, retrieve-vs-answer.** A support agent speaks *as* a brand and *within* bounds:
- **Persona & tone** — pin the voice in the system prompt; it must hold across turns and **survive compaction** (don't let it drift formal→casual, or leak the system prompt).
- **Scope boundary & graceful refusal** — define in-conversation what the agent will/won't do; refuse out-of-scope asks by *redirecting to the escalation path*, not a dead-end "I can't." (Enforcing a guardrail/refusal in code → `04`.)
- **Retrieve vs answer-from-policy** — small, stable policy → answer from the system prompt; large or changing knowledge → *retrieve* it, which makes the agent conversational **over RAG** (→ `rag.md` owns that pipeline; ground + cite per its grounding stage). Many support agents are conversation *on top of* retrieval.

**3. Turn-level UX — latency, repair, interruption.** How each turn *feels*:
- **Streaming & acknowledgement** — stream so *first-token* latency is what's felt, not total; for a slow tool call, emit a "looking that up" ack so the turn never hangs silent.
- **Repair** — when intent is ambiguous or the agent misread it, recover *in dialogue*: ask **one** clarifying question rather than guess, confirm before any irreversible action, and let the user correct course (backtrack) without restarting the session.
- **Interruption / barge-in** — the user can cut in mid-response (esp. voice); the agent must stop and re-listen, not finish a now-stale turn.
- The latency *engineering* underneath (prompt caching, model routing) is owned by `04`; this is the felt UX of it.

**4. Handoff UX — deflect, escalate, the handoff packet.** The most consequential conversation-specific move:
- **Deflect vs escalate** — *deflect* (resolve in-agent) what's in-scope and high-confidence; *escalate* to a human on out-of-scope, low confidence, high stakes, N failed repairs, or an explicit user request.
- **The handoff packet** — escalate with a *summary*, not a raw transcript dump: the user's intent, what's been tried, the relevant account facts, and the open question. This is what makes the human pickup warm.
- **Warm vs cold transfer** — *warm* (context + summary travel with the user, session continues) vs *cold* (drop into a queue, user repeats themselves). Prefer warm for anything mid-task.
- Ownership split: *whether/when* to escalate and the approval gate are **policy** → `04`; the pause/resume that survives the handoff is a **state-machine** → `01`; the conversational *experience* is owned here.

---

## Decision procedures

**Static vs agentic (the off-ramp call → `01`):** a deterministic dialogue tree / scripted flow / single intent-classifier is a **workflow**, not this archetype — predictable, cheap; keep it if the conversation is finite and known ahead of time (Station-0 off-ramp). You're **conversational-agentic** when turns are open-ended, the agent reasons over accumulated state, picks tools at runtime, and decides *on its own* to escalate. Agency buys natural multi-turn handling at the cost of latency, tokens, and unpredictability — the same workflow-vs-agent trade `01` owns; this is the support-shaped instance.

**Deflect vs escalate — set the threshold on measured cost.** (The threshold itself is escalation/HITL **policy** → `04`; its **measurement** — deflection rate, post-handoff CSAT — → `02`.) Start conservative (escalate readily), then tighten only as evals show the agent resolves a class of intents reliably. Gate on confidence, scope, stakes, and turn/repair count (N failed clarifications → hand off). Measure **deflection rate *and* post-handoff satisfaction** (→ `02`): a high deflection rate that strands users is worse than a lower one that escalates cleanly. Over-escalation destroys the agent's value; under-escalation strands the user — tune against the number, not a vibe.

**When each knob earns its cost** (name it, reach for it on a measured need):
- **Durable (cross-session) memory** — when users return and expect continuity ("as I mentioned last time"); skip it for one-shot stateless support (→ `01`).
- **Confirmation / repair loops** — when a misread leads to a costly or irreversible action; a confirm-before-acting turn is cheap insurance, but over-confirming makes the agent feel timid.
- **Voice / barge-in handling** — only for voice/real-time channels; pure text doesn't need it.
- **Warm transfer + handoff packet** — when escalations are frequent or mid-task; a cold queue is fine for rare, simple hand-offs.

---

## The four stations, for conversational   (one-line pointers each)

- **01 Architecture** — conversation history vs durable memory (episodic/semantic), **compaction** of a long dialogue, just-in-time/context engineering, and the **state-machine/resume mechanism** behind a handoff pause; single-agent-with-good-tools is the default → `../01-architecture.md`.
- **02 Evals** — **multi-turn evals** that grade the *conversation outcome, not each turn's path*, **simulated users** to exercise dialogue in CI, and **`pass^k`** where the user expects it to work *every* time; deflection rate + post-handoff satisfaction as measured outcomes → `../02-evals.md`.
- **03 Frameworks** — session/thread **persistence + checkpointers** (resume a paused conversation), the agent loop + tool wiring, and **structured-output enforcement** for tool calls → `../03-frameworks.md`.
- **04 Production** — handoff/HITL **policy** (when to gate/escalate, the approval UX), guardrails (moderation, jailbreak/refusal, **no raw PII in transcripts/traces**), prompt-injection from the **user (direct)** *and* retrieved content (indirect), and latency/cost (caching, routing) → `../04-production.md`.

---

## Minimum-viable vs full

| Concern | Minimum-viable (low-stakes / internal / reversible) | Full (autonomous / customer-facing / high-stakes) |
|---|---|---|
| Session state | transcript carried in-context | session + durable memory; compaction preserving open commitments (`01`) |
| Grounding | pinned persona + scope boundary; answer from policy | persona holds across compaction; retrieve + cite via RAG (`rag.md`) |
| Turn UX | stream tokens; one clarifying question on ambiguity | ack on long calls, confirm-before-irreversible, repair/backtrack, barge-in if voice |
| Handoff | a working escalate-to-human path | deflect/escalate threshold (`04` policy) tuned on measurement (`02`); warm transfer + handoff packet |
| Eval | one multi-turn task-success check | multi-turn + simulated users + `pass^k`; deflection & post-handoff CSAT (`02`) |
| Guardrails / cost | don't log raw PII; basic moderation (`04`) | injection defense (direct + indirect), refusal checks, caching/routing for latency (`04`) |

---

## Must-address checklist

- [ ] **Archetype confirmed** — multi-turn dialogue (not a scripted tree / single classifier → that's the off-ramp/workflow); **static vs agentic** chosen on purpose (→ `01`).
- [ ] **Session state decided** — what's carried turn-to-turn vs compacted vs stored durably; **open commitments survive compaction** (→ `01`).
- [ ] **Persona & scope pinned** — voice holds across turns and compaction; out-of-scope asks redirect to escalation, not a dead-end.
- [ ] **Retrieve-vs-answer drawn** — stable policy in-prompt; large/changing knowledge via RAG with grounding/citations (→ `rag.md`).
- [ ] **Turn UX handled** — streaming + long-call ack; a repair path (clarify/confirm/backtrack); barge-in if voice.
- [ ] **Handoff designed** — a real escalate path; deflect/escalate threshold set against measured cost; warm transfer with a handoff packet for mid-task escalations.
- [ ] **Multi-turn eval exists** (→ `02`) — conversation-outcome grading + simulated users; `pass^k` where "works every time" is the product; deflection + post-handoff satisfaction tracked.
- [ ] **Guardrails on the dialogue** (→ `04`) — moderation/refusal, no raw PII in transcripts/traces, **indirect injection** from retrieved content *and* direct jailbreaks from the user treated as hostile.
- [ ] **Latency/cost budgeted** (→ `04`) — felt latency (first-token/streaming) acceptable; caching/routing where turns repeat.

---

## Deep-dive sources   (point to sources.md)

This recipe leans on existing station anchors rather than new ones — conversational maps onto the stations:
- **Anthropic — Building Effective Agents** — the *customer-support* example (chat interface + tool integration + a clear *resolved-vs-escalated* success criterion) and the "start simple" spine → `../sources.md § Architecture`.
- **Sierra — τ-bench / τ²-bench** — multi-turn, **policy-following customer-service** agent eval, and the origin of **`pass^k`** (the "works every time" reliability gate a support agent needs); baselines only — your own conversation set is the gate → `../sources.md § Evals`.
- **RAG recipe** — the retrieve-and-ground pipeline a support agent sits on top of when it answers from a knowledge base → `rag.md` (+ `../sources.md § RAG`).

No conversation-specific external source is enshrined here on purpose — the spine is durable craft. Everything volatile (multi-turn benchmark numbers, framework session APIs, voice/barge-in platform specifics) lives behind the station pointers; treat felt-latency and voice behaviour as channel-dependent and verify against your platform.
