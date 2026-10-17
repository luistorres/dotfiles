<!-- last-reviewed: 2026-06-25 -->
# Coding / Automation — recipe
> Owns: the **closed edit→run→observe loop against an executable verifier** — where the loop's feedback signal *is* the eval's reward signal (no single station owns that collapse). · Also gives the coding-shaped **codebase-navigation** call and the **command blast-radius** mapping (applying `04`'s HITL/security *policy* to command classes). · Ties stations 01–04 for the coding archetype. · **Minimum-viable:** short loop in a workspace sandbox, compiler/test/linter as the check, passive-read tools by default, one `pass@1` task check. · **Full:** closed loop against the full test/CI suite as the reward → `pass^k` on a task suite → sandboxed exec with command allow/deny + least-privilege → HITL on irreversible actions → verifier guarded against reward-hacking.

This recipe is **thin on purpose**: a coding agent maps onto the stations almost completely (loop → `01`, tests-as-eval → `02`, sandbox/exec tooling → `03`, security → `04`). We don't re-teach what a coding agent *is* (a strong model knows "read code, write a diff, run it"). The value is the one thing no station isolates — that for code the **environment is an executable verifier** (of *specified* behavior), which collapses the loop's feedback and the eval's reward into a single artifact — and the coding-shaped decision calls that fall out of it. Everything else is a one-line pointer to its owning station; follow it, don't expand it here.

**Archetype gate (from `../00-start-here.md`):** coding = the agent *writes/edits code or runs commands*. A single-shot completion (autocomplete, "write me this function", one-prompt codegen) is **not** the archetype — it's the Station-0 off-ramp (call the model well, stop). If the agent runs once and emits a diff with no feedback, you have *static* codegen (a workflow). If it **iterates against execution feedback** — edit, run, read the failure, fix — it's an *agentic* coding agent (→ `01`).

---

## The closed loop against an executable verifier   (the owned content)

What makes coding distinctive is that the environment answers *executably* and cheaply — the compiler/tests/linter render a verdict on *specified* behavior, not a model's opinion. Four facts fall out of that; the rest is stations.

**1. The loop — edit → run → observe → repeat.** A ReAct loop (`01`) where the *observation* is compiler/test/linter/runtime output: an **executable verdict on specified behavior, not a model's opinion** (deterministic for what it checks — not a proof of correctness). Open-loop generation (write code, hope) is strictly weaker than closing this loop, because the agent gets corrected by reality each turn instead of compounding its own errors. The single highest-leverage design choice is making that feedback *fast, structured, and actionable* — a failing test with a stack trace beats a wall of build noise (compact noisy output before it re-enters context → `01` ACI).

**2. The verifier IS the reward signal.** In most archetypes you must *build* a judge (LLM-as-judge, then validate it → `02`). In coding the judge largely already exists as an **executable oracle for the behavior you specified**: the test suite, the type-checker, the linter, the build (cheap to run — but only as complete as the checks you wrote; partial, flaky, or slow checks lie). So the thing the loop optimizes against and the thing you eval on are *the same executable artifact* — your acceptance test is your reward signal. Corollary risk this creates: a reward that only checks *what you specified* is **gameable**. An agent told "make the tests pass" can delete the failing test, weaken an assertion, hardcode the expected output, or `# type: ignore` the error — **reward hacking / specification gaming**. Guard the verifier (see decision procedures); a green check the agent could have faked is not signal.

**3. Codebase context is *navigation*, not embeddings.** Unlike RAG over prose, code is structured, greppable, and typed — so retrieval is mostly **tools, not vector search**: `grep`/ripgrep (exact symbols, rare tokens), file/dir reads, LSP / symbol-search / go-to-definition, AST/structure queries, the build & import graph, `git blame`/history. The agent *navigates* just-in-time (hold paths/refs, load on demand → `01` context-engineering) rather than pre-embedding the repo. Embedding-based "search the codebase" is a *fallback* for fuzzy "where is the thing that does X" intent, not the primary mechanism — and it's the one place the RAG recipe applies (→ `rag.md`).

**4. The execution blast-radius — an irreversibility ladder.** A coding agent doesn't just write, it *runs code and commands*, so the risk surface is the command, not the diff. Rank actions by reversibility and guard each rung accordingly (gating *policy* → `04`; the pause/resume *mechanism* that implements a gate → `01`):
- **Passive reads** (read, grep, list, symbol-search) — no code execution; autonomous, the default tool tier.
- **Sandboxed execution & workspace writes** (type-check, build, run tests, dry-runs, edit files) — autonomous *only inside an isolated checkout* with no ambient network/creds (→ `04`). These **run project code** (build scripts, test fixtures, plugins, package hooks) — a "dry run" or type-check can still execute arbitrary code — so they belong here, not in the passive-read tier.
- **Version-controlled writes** (commit, local branch) — reversible via VCS; low gate.
- **External / irreversible** (`git push`, deploy, prod DB, package publish, `rm -rf`, `curl … | sh`, installing dependencies, network calls) — **gate behind HITL or a hard allow-list** (→ `04`). These are where excessive-agency harm lives, not in the editing.

---

## Decision procedures

**Static codegen vs agentic loop (→ `01`):** **static** (generate-once, no execution feedback) when the task is small, well-specified, and a human reviews the diff — simpler, cheaper, predictable; treat it as a workflow or the Station-0 off-ramp. **Agentic** (iterate against compiler/tests) when the task needs discovery — multi-file changes, unknown failure modes, "make it pass" work where one shot won't land it. Agency buys correctness on hard tasks at the cost of latency, tokens, and the execution risk surface (item 4). Same workflow-vs-agent trade `01` owns; this is the coding-shaped instance.

**Codebase retrieval — navigation tools vs embeddings:** default to **exact/structural tools** (grep, LSP, symbol-search, import graph) — they're precise, cheap, and exploit code's structure and type system. Reach for **embedding retrieval over code only** when intent is fuzzy and lexical search misses (semantic "where do we handle retries?"), and even then index symbols/signatures, not raw lines. If you do embed code, you've re-entered the retrieval pipeline → `rag.md`; everything there (chunking on AST boundaries, hybrid + BM25 for exact symbols) applies.

**How much of the loop runs unattended (→ `04`):** decide *per command class* (item 4's ladder), not per agent. Passive reads + sandboxed execution → autonomous. Anything externally-visible or irreversible → HITL gate or hard policy check. The MV bar is **passive-read by default + execution/writes confined to a sandbox**; let a measured need (and a reviewed diff) pull the agent up the ladder, never speculation.

**Guarding the verifier against reward-hacking:** keep the **test/spec set outside the agent's write scope** (it can run them, not edit them); **review the diff**, not just the green check (did it weaken assertions, add `skip`/`ignore`, or hardcode outputs?); hold out a **hidden check** the agent never sees; and prefer **outcome grading on tests the agent didn't author** (→ `02`). A passing suite the agent *could* have modified is not evidence.

---

## The four stations, for coding   (one-line pointers each)

- **01 Architecture** — the edit→run→observe loop *is* a ReAct loop; the dev tools (read/edit/grep/run) are an **ACI — design as a UI with actionable error feedback**; single-agent-with-good-tools is the default (multi-agent only via the 4-part rule); just-in-time codebase navigation is context engineering; the **state-machine/resume mechanism** behind an HITL gate on irreversible commands → `../01-architecture.md`.
- **02 Evals** — tests/CI are **executable outcome graders** (02's "grade outcomes, not paths" — the test passing *is* the outcome, the files touched are not); `pass@1` for capability, **`pass^k`** for reliability on a task suite; SWE-bench (coding-task eval) is a **baseline only** — your own repo's task suite is the gate → `../02-evals.md`.
- **03 Frameworks** — the **sandbox / code-execution runtime** (microVM-class isolation for running model-generated code) + the orchestration/tool-loop tooling; structured-output enforcement for tool calls → `../03-frameworks.md`.
- **04 Production** — the security *policy*: **sandboxing is non-negotiable** for code/shell exec (no ambient network/creds), command allow/deny + least-privilege, **HITL gate on irreversible actions** (push/deploy/prod write), and **indirect injection** from untrusted repo/web/tool content reaching a privileged command → `../04-production.md`.

---

## Minimum-viable vs full

| Dimension | Minimum-viable (low-stakes / internal / reversible) | Full (autonomous / customer-facing / irreversible) |
|---|---|---|
| Loop | edit→run→observe against compiler+one test | closed loop against full test/CI suite; failures fed back structured |
| Context | grep + file reads (exact/structural navigation) | + LSP/symbol-search, import-graph nav; embeddings only for fuzzy intent (`rag.md`) |
| Execution | run in a workspace sandbox; passive-read tools by default | sandboxed exec, command allow/deny, least-privilege net/fs (`03` tooling, `04` policy) |
| Permissions | writes confined to sandbox; nothing external | per-command-class gating; HITL on push/deploy/prod/irreversible (`04`) |
| Eval | one `pass@1` task check on a held task | versioned task suite, `pass^k` reliability gate, outcomes graded (`02`) |
| Verifier integrity | — | test/spec set out of write scope; diff reviewed; hidden hold-out check |
| Security | — | indirect-injection defense for untrusted repo/web/tool content (`04`) |

---

## Must-address checklist

- [ ] **Archetype confirmed** — agent writes/edits code or runs commands (not single-shot codegen → that's the Station-0 off-ramp); **static vs agentic** chosen on purpose (→ `01`).
- [ ] **Loop closed against the executable verifier** — compiler/test/linter/runtime output is fed back each turn, fast and structured; not open-loop generation.
- [ ] **Codebase context via the right tool** — grep/LSP/symbol-search/import-graph by default; embeddings only for fuzzy intent (then → `rag.md`).
- [ ] **Execution is sandboxed** (→ `04`/`03`) — code/shell runs with no ambient network/creds; workspace writes isolated from host/prod.
- [ ] **Blast-radius gated per command class** (→ `04`) — passive reads + sandboxed execution autonomous (in an isolated checkout); irreversible/external (push, deploy, prod, publish, `rm`, `curl|sh`, installs) behind HITL or allow-list.
- [ ] **Verifier guarded against reward-hacking** — test/spec set out of the agent's write scope; diff reviewed for weakened/skipped/hardcoded checks; a hidden hold-out check.
- [ ] **Eval is the executable check** (→ `02`) — outcomes (tests pass) graded, not trajectory; `pass^k` where reliability is the product; benchmark only as a sanity baseline.
- [ ] **Untrusted content treated as injection** (→ `04`) — repo files, web fetches, and tool/MCP results are untrusted; trust boundary before they reach a privileged command.
- [ ] **Cost/latency budgeted** (→ `04`) — loop iterations + tool calls per task within ceiling; cache stable prefixes (system, repo map).

---

## Deep-dive sources   (point to sources.md)

This recipe leans on existing station anchors rather than new ones — coding maps onto the stations:
- **Anthropic — Building Effective Agents** — the agent loop + "start simple, close the loop" spine (the edit→run→observe loop is its ReAct instance) — `../sources.md § Architecture`.
- **SWE-bench** — real-world coding-task eval; **baseline only**, read the live leaderboard, your own task suite is the gate — `../sources.md § Evals` (agent-benchmarks row).
- **E2B (microVM sandboxes)** — the code-execution runtime for running model-generated code in isolation — `../sources.md § Frameworks`.
- **OWASP LLM Top-10 (LLM01 injection · LLM06 excessive agency) + MITRE ATLAS** — the security frame for command blast-radius and untrusted repo/tool content — `../sources.md § Production`.
- **DeepMind — Specification gaming** — the canonical framing of reward-hacking (a green check the agent could have faked is not signal), behind item 2 + "guarding the verifier" — `../sources.md § Coding`.

For *volatile* specifics — coding-benchmark standings, sandbox-runtime feature matrices, current model coding scores — open the live source; never quote a cached number.
