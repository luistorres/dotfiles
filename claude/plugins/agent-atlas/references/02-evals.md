<!-- last-reviewed: 2026-06-27 -->
# 02 — Evals & Measurement

> Owns: how you *know* the agent works — error analysis, datasets, judges, scoring, the offline→online loop, consistency, benchmarks, the data flywheel.  ·  **Minimum-viable:** error-analyze 20–50 real failures → taxonomy → a handful of binary code/judge checks → gate one capability + one regression in CI.  ·  **Full:** stratified versioned golden set + validated multi-judge rubrics (human-agreement measured) + trajectory/multi-turn evals + `pass^k` reliability gate + production sampling feeding a flywheel.

The single biggest mistake is writing metrics before looking at failures. **Error analysis is the highest-ROI, most-skipped step** — do it first; everything below is downstream of the taxonomy it produces.

## Canonical terms
- **Error analysis** — read real failures, write open-ended notes (*open coding*), cluster into a labeled failure taxonomy (*axial coding*), then count frequency. Theoretical saturation ≈ when ~20 fresh traces surface no new category.
- **Golden / eval dataset** — curated, versioned input→expected examples. Sourced from real failures, not invented.
- **Stratification** — deliberately sampling across failure modes / user segments / difficulty so the set isn't dominated by easy or frequent cases.
- **Leakage / contamination** — eval examples (or their public origin) leaked into training or the prompt; inflates scores, kills predictive value.
- **LLM-as-judge** — a model grading outputs. Flavors: *reference-based* (vs gold answer), *rubric / direct scoring* (criteria, single output), *pairwise* (A vs B).
- **Eval the eval** — validating the judge against human labels (agreement, TPR/TNR, κ) before trusting it. The judge is itself a model that needs evals.
- **Criteria drift** — you need criteria to grade, but grading is what reveals the criteria; rubrics must co-evolve with labeling (Shankar, EvalGen).
- **Trajectory eval** — grading the *path* (eval-path; cf. the observability trace in `04`): tools called, args, turn/token budget, order. Use sparingly (see decision procedures).
- **`pass@1` / `pass@k` / `pass^k`** — single-run success / ≥1 of k succeed / **all k succeed**. `pass^k` is the reliability gate.
- **Capability vs regression eval** — does it do new things (offline, pre-build) vs did a change break old things (CI gate).
- **Data flywheel** — production traces → error analysis → new golden cases + judge fixes → better agent → richer traces. Critiques double as seeds for synthetic data.

## Decision procedures

**Which grader?** Climb the cost/fidelity ladder; stop at the cheapest that captures the property.
1. **DEFAULT → deterministic code** (exact match, regex, schema/JSON validity, unit/exec tests, set-membership). Cheap, stable, zero drift. Reserve nothing else if this suffices.
2. **Semantic / reference-based** when surface form varies but a gold answer exists (embedding similarity, fuzzy match).
3. **LLM-as-judge** *only* for subjective qualities (tone, faithfulness, helpfulness) on failure modes you'll iterate on repeatedly — it carries real overhead and must be validated. Don't build it for issues a prompt fix removes.
- **Grade OUTCOMES, not paths.** Default to grading *what the agent produced, not the path it took*; rigid tool-call-sequence checks are "overly brittle" because agents find valid approaches you didn't anticipate [verified 2026-06-25 via anthropic.com/engineering/demystifying-evals-for-ai-agents]. Add trajectory assertions only for genuine constraints (budget caps, a required safety/permission call, a forbidden tool). Give partial credit (e.g. "4 of 5 required facts present") rather than one brittle boolean.
- **Which *layer* is riskiest?** Often a **deterministic** ground-truth the model trusts (a computation, parser, retrieval score), not the model — point your first golden case there (→ boundary `01`), and check **validity** (is it the *right* indicator for the question?) not only correctness. A judge can grade non-model logic.

**Reference-based vs rubric vs pairwise judge?**
- Objective / has-a-gold-answer (factuality, policy violation, instruction-following) → **reference-based or direct rubric scoring**.
- Subjective with no single right answer (style, persuasiveness, coherence) → **pairwise comparison** — more reliable than asking for an absolute score.
- Faithfulness / instruction-following do *not* fit the pairwise paradigm — use direct scoring there.

**Judge output scale?** **DEFAULT → binary pass/fail**, decomposed into independent yes/no criteria each scored by its own judge call. Binary forces clearer labeling and yields clean classification metrics; Likert 1–5 is subjective between adjacent points, drives annotators to the middle, and needs larger samples. Reach for numeric/ordinal only when a property is genuinely continuous — then score association with Kendall's τ / Spearman's ρ, not κ.

**Judge biases — mitigate in this priority order:** verbosity (longest answer wins) > self-preference (model favors its own outputs) > position (order in pairwise). Mitigate: hold length roughly constant or instruct to ignore it; use a *different* model family as judge; swap A/B order and average; give the judge an explicit "Unknown" escape hatch.

**Validate the judge before trusting it (eval the eval).** Hand-label a held-out set, measure judge–human agreement, iterate the rubric until TPR/TNR (and Cohen's κ) are high — multiple iterations to clear ~90% agreement is normal (rule of thumb from Hamel's evals FAQ — see `sources.md § Evals`). Start with the most capable judge model to establish alignment; downgrade for cost later. Prefer expert labels: LLM judges correlate better with *non-expert* humans, so non-expert agreement can flatter you.

**When is `pass^k` the right gate (vs `pass@1`)?**
- **USE `pass^k`** for stochastic, multi-step, customer-facing agents where the user expects it to work *every* time — per-run failure compounds fast (illustrative: ≈0.75 per-run → ≈0.42 over 3 runs, i.e. 0.75³). This is the metric that exposes the reliability gap a single run hides.
- **`pass@1` suffices** for near-deterministic single-shot tool use, or early capability exploration where you just need signal.
- Don't blanket-gate everything on `pass^k`; scope it to flows where consistency is the product.

**Custom evals vs public benchmarks?** Benchmarks (SWE-bench, τ-bench/τ²-bench, GAIA, WebArena) → **baselines and model selection only**. They are weak predictors of *your* production reliability and suffer contamination/brittleness. **A small custom set from your own failures beats any generic benchmark** — generic metrics not tied to your failure modes actively mislead. Always: custom set is the gate, benchmark is the sanity check.

**Real vs simulated users?** Simulated users unblock multi-turn/CI testing — but they're *proxies*. Treat green simulated-user runs as necessary, not sufficient; keep sampling real production traces as ground truth.

**Synthetic data?** Seed from *real* examples, then scale synthetically to cover rare/stratified cases; validate a sample by hand. Never let synthetic become the whole set, and watch it doesn't leak into both train and eval.

**Retrieval-quality evals (the RAG archetype's eval side).** When the agent retrieves, grade retrieval too: *context precision/recall* (did you fetch the right chunks) and *groundedness/faithfulness* (is the answer supported by what was fetched). These are the eval half of the RAG archetype; the full RAG retrieval recipe is **`recipes/rag.md`**. Other archetypes carry their eval specifics in their recipes too: coding's executable test/CI suite is the outcome grader (`recipes/coding.md`), and conversational's multi-turn + deflection/CSAT evals live in `recipes/conversational.md` — methodology stays here; the archetype-shaped application is in the recipe.

## Minimum-viable vs full

| | Minimum-viable | Full |
|---|---|---|
| Error analysis | Open+axial code 20–50 real failures → taxonomy *before any metric* | 100+ fresh traces per cycle to saturation; 10–20 weekly on outliers *(trace counts are rules of thumb from Hamel — `sources.md § Evals`)* |
| Dataset | 20–50 real-failure tasks, version-pinned | Stratified by failure mode/segment, regression cases per past bug, real-seeded synthetic |
| Graders | Deterministic asserts + 1–2 binary judges | Validated multi-judge rubrics, partial credit, outcome-focused |
| Judge trust | Eyeball a few vs your own labels | Measured human agreement (TPR/TNR, κ), periodic re-alignment |
| Loop | Capability eval pre-build; one regression gate in CI | Offline capability + lightweight CI regression gate + async prod sampling → flywheel |
| Agent-specific | Final-outcome grading | Trajectory (tools/args/budget) where constrained, multi-turn, simulated users |
| Reliability | `pass@1` | `pass^k` on customer-facing stochastic flows |

## Must-address checklist
- [ ] Did error analysis (open→axial coding of real failures) **before** writing metrics; failure taxonomy exists and frequencies counted.
- [ ] **Riskiest layer identified** — first golden case targets it, including a deterministic ground-truth the model trusts, not only the model's output (→ `01`).
- [ ] Golden set sourced from real failures, **stratified**, and **version-pinned**; checked for train/prompt leakage.
- [ ] Grader chosen by ladder: deterministic → semantic → judge; **outcomes graded, not paths** (trajectory only for real constraints); partial credit where apt.
- [ ] Judge rubric is binary/decomposed; biases (verbosity > self-pref > position) mitigated.
- [ ] Judge **validated against human labels** (agreement / TPR-TNR / κ) — "eval the eval" done, not assumed.
- [ ] `pass^k` applied where consistency is the product; `pass@1` where deterministic — decision made consciously.
- [ ] Eval loop wired: capability evals offline, regression gate in CI, production traces sampled back into the dataset (flywheel).
- [ ] Public benchmarks used only as baselines; custom set is the actual gate.
- [ ] Simulated-user/synthetic results treated as proxies, backed by real-trace sampling.

## Deep-dive sources
- **Read FIRST → Anthropic — Demystifying Evals for AI Agents** [verified 2026-06-25] — outcome-vs-path grading, `pass^k`, 20–50 real-failure start, eval-driven development → https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Then by need (Hamel — Field Guide + Evals FAQ · Eugene Yan — LLM-Evaluators · Shankar et al. — EvalGen · Sierra — τ-bench/τ²-bench · Chip Huyen — AI Engineering): full URLs + status in **`sources.md § Evals`**.

**Pointers (owned elsewhere):** observability / tracing platforms & live monitoring → `04`. Eval *frameworks/platforms* & harness tooling (Braintrust, Langfuse, OpenAI Evals, promptfoo, Inspect, DeepEval, etc.) → `03`. Live benchmark standings (SWE-bench, GAIA, WebArena, τ-bench) change constantly — read the project leaderboards, not a cached number.
