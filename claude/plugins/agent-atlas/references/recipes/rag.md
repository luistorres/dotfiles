<!-- last-reviewed: 2026-06-25 -->
# RAG / Knowledge — recipe
> Owns: the **retrieval pipeline** (no station covers it). · Ties stations 01–04 for the RAG archetype. · **Minimum-viable:** chunk → embed → vector top-k → grounded, span-cited answer + one retrieval-quality check. · **Full:** hybrid + rerank → full retrieval-quality eval suite → freshness strategy → citation enforcement → retrieval-poisoning defense.

A recipe *ties the four stations* for one archetype **and** owns the one thing no station does — the retrieval pipeline. We don't re-teach what RAG *is* (a strong model knows "retrieve, stuff into context, generate"). The value is the **stage-by-stage decision procedure**, the *when-does-each-knob-earn-its-cost* calls, and the **dated pointers**. Everything that isn't the pipeline is a one-line pointer to its owning station — follow it, don't expand it here.

**Archetype gate (from `../00-start-here.md`):** RAG = the agent *decides what to retrieve* from a corpus. A single attached doc or one-shot context is **not** RAG — it's the Station-0 off-ramp. If retrieval is one fixed call before generation, you have *static* RAG (a workflow); if the agent decides *whether/what/when* to retrieve mid-reasoning, it's *agentic* RAG (→ `01`).

---

## The retrieval pipeline   (the owned content)

Stages, in order. Each names the knob and the decision; defaults favor the cheapest stage that hits your retrieval-quality bar (measure it — `02`).

**1. Ingestion** — normalize sources to clean text + metadata *before* chunking. Strip boilerplate; preserve structure signals (headings, tables, code fences, page/section IDs) — they drive both chunking and citations. Capture per-chunk metadata at ingest (source URI, section, timestamp/version) — you cannot cite or expire what you didn't record. Garbage in here caps every downstream stage.

**2. Chunking** — split documents into retrievable units. The single highest-leverage, most-underthought stage. Strategies, cheapest→smartest:
- **Fixed-size** (N tokens, fixed overlap) — baseline; ignores meaning, splits mid-thought. Use only for flat, uniform prose.
- **Recursive / separator-aware** — split on a separator hierarchy (¶ → sentence → token) to respect natural boundaries. Good general default.
- **Structure-aware** — split on the document's own structure (Markdown headings, HTML/DOM, code AST, table rows). Default for *structured* docs.
- **Semantic** — split where embedding similarity drops (topic shift). Highest cost; reach for it when topic boundaries don't align with structure.
- Always carry **overlap** (so an answer spanning a boundary survives) and keep **section/source metadata on every chunk** (for grounding + freshness).

**3. Embedding** — map chunks (and queries) to vectors for semantic match. At altitude the tradeoffs, not the model: **dimensionality** (recall vs index size/cost) · **context length** (must exceed your chunk size) · **domain fit** (general vs code/legal/multilingual) · **symmetry** (some models want a query/document *prefix* — using the wrong mode silently tanks recall) · **cost & rotation** (changing models means **re-embedding the whole corpus** — pin the version). Query and corpus **must** use the same model+mode. *Specific models/benchmarks rot fast — pick from a live leaderboard, never a cached ranking (→ `sources.md § RAG`).*

**4. Indexing** — how chunks are stored for lookup. Three modes:
- **Vector (dense)** — ANN over embeddings; wins on paraphrase/concept, blind to exact rare tokens.
- **Keyword (sparse / BM25)** — lexical; wins on exact matches (codes, names, rare terms, acronyms), blind to synonyms.
- **Hybrid** — run both, **fuse** the rankings (Reciprocal Rank Fusion is the standard rank-only fuse: `Σ 1/(k+rank)`, `k≈60`, no score-calibration needed). Hybrid is the production default precisely because dense and sparse fail on opposite query types `[verified 2026-06-25 via docs.pinecone.io/guides/search/hybrid-search]`. *(The retrieval **stack** — which vector DB / index — is owned by `03`.)*

**5. Retrieval** — pull candidates at query time. Knobs: **top-k** (too low → misses; too high → dilutes context + cost — tune empirically against context-recall); **hybrid fusion** (above); **MMR** (maximal marginal relevance — trade pure relevance for diversity to kill near-duplicate chunks); **metadata filtering** (pre-filter by source/recency/permissions *before* the vector search — also the hook for per-user access control). Retrieve a wide candidate set here *if* a reranker will narrow it next.

**6. Reranking** — a **cross-encoder** re-scores each (query, chunk) pair jointly (vs the bi-encoder embedding that scored them independently), then you keep the top few. Far more precise, far more expensive per pair → the pattern is **retrieve wide (cheap) → rerank to a small, high-precision set (expensive)**. *Worth it when* top-k precision is your bottleneck (the right chunk is retrieved but ranked too low to survive context limits) — the classic "in the candidates, not in the top-k" failure. *Skip it when* plain top-k already clears your context-precision bar, or latency/cost budget can't absorb a second model hop.

**7. Grounding / citations** — the answer must be **supported by, and cite, the retrieved spans** — this is what separates RAG from a confident guess. Enforce, don't hope: require the model to attach span/source IDs to each claim; validate that cited IDs were actually in the retrieved set (drop or flag fabricated cites); for high-stakes, gate on a groundedness/faithfulness check (→ `02`) before the answer ships. Carrying chunk IDs end-to-end (from §1 ingest metadata) is what makes citation *mechanically enforceable* rather than a prompt request.

---

## Decision procedures

**Chunking strategy — by document structure:** flat uniform prose → recursive/separator-aware. Structured (Markdown/HTML/code/tables) → structure-aware on the native structure. Heterogeneous or topic-drifting prose where structure ≠ topic → semantic (only if cheaper strategies miss). In all cases: keep overlap; keep section+source metadata. Re-chunking is cheap to try and high-leverage — A/B it against context-recall before tuning anything downstream.

**When to add hybrid + reranking vs plain vector top-k:** start **plain vector top-k** + grounded answer; measure retrieval quality (`02`). Add **hybrid** the moment exact-match queries fail (IDs, names, acronyms, rare terms — dense alone won't find them). Add **reranking** when the right chunk is *retrieved but ranked too low* to make the context window (precision-limited, not recall-limited). Don't add either speculatively — each is latency + cost; let a measured failure mode pull it in.

**Static vs agentic RAG (→ `01`):** **static** (retrieve-once-then-generate) when one query reliably fetches the evidence — simpler, cheaper, predictable; treat it as a workflow. **Agentic** (the agent issues/refines queries, decides *whether* and *what* to retrieve across reasoning steps) when a single query can't capture intent — multi-hop questions, query reformulation, "search → read → search again" loops. Agency buys recall on hard questions at the cost of latency, tokens, and unpredictability — the same trade `01` makes for workflow-vs-agent. Decision lives in `01`; this is just the RAG-shaped instance.

**When advanced patterns earn their cost** (name them, read the source, don't enshrine — all → `sources.md § RAG`):
- **Query rewriting / HyDE** — rewrite or expand the query, or embed a *hypothetical answer* and retrieve near it. Helps when user queries are short/vague or lexically far from the corpus. (HyDE: Gao et al. 2022.)
- **Contextual Retrieval** (Anthropic) — prepend an LLM-generated chunk-specific context blurb *before* embedding + BM25-indexing, so chunks aren't stranded from their document. Reported top-20 retrieval-failure reduction **49%** (contextual embeddings + contextual BM25), **67%** with reranking added `[verified 2026-06-25 via anthropic.com/news/contextual-retrieval]`. Earns its (one-time, cacheable) ingest cost when chunks lose meaning out of context.
- **GraphRAG** (Microsoft) — build a knowledge graph + community summaries over the corpus; answers *global/aggregative* questions ("what are the themes across all docs") that flat top-k can't. Indexing is LLM-heavy and expensive — justify it against the query type.
- **Multi-vector** (e.g. late-interaction / ColBERT-style) — multiple vectors per chunk for finer-grained matching; higher index cost. Reach for it when single-vector recall plateaus.

---

## The four stations, for RAG   (one-line pointers each)

- **01 Architecture** — agentic-RAG vs static retrieve-then-generate (the agent decides whether/what to retrieve); RAG as context-engineering / just-in-time retrieval → `../01-architecture.md`.
- **02 Evals** — retrieval-quality *methodology*: **context precision / context recall** (did you fetch the right chunks) and **groundedness / faithfulness + answer relevance** (is the answer supported by them) → `../02-evals.md`.
- **03 Frameworks** — the retrieval *stack/tooling*: vector DBs, retrievers, rerankers, embedding libs, RAG-in-a-box framework features → `../03-frameworks.md`.
- **04 Production** — RAG-specific risks: **retrieval/RAG poisoning** (= indirect prompt injection via retrieved content — untrusted corpus chunks reaching a privileged tool), **index freshness/staleness**, **retrieval cost/latency** → `../04-production.md`.

---

## Minimum-viable vs full

| Stage | Minimum-viable (low-stakes / internal / reversible) | Full (autonomous / customer-facing / high-stakes) |
|---|---|---|
| Chunk | recursive/structure-aware + overlap + source metadata | per-doc-type strategy, A/B'd against context-recall |
| Embed + index | one embedding model, **vector** top-k | **hybrid** (dense + BM25, fused), version-pinned model |
| Retrieve | top-k, maybe metadata filter | + MMR/dedup, candidate-set tuned for a reranker |
| Rerank | none | cross-encoder: retrieve-wide → rerank to high-precision |
| Grounding | answer cites retrieved spans | citation **enforced** (validated against retrieved set) + groundedness gate (`02`) |
| Eval | one retrieval-quality check (context precision/recall) | full suite: precision/recall + faithfulness + answer relevance (`02`) |
| Freshness | — | re-index/expiry strategy for stale sources (`04`) |
| Security | — | retrieval-poisoning (indirect-injection) defense + source-trust boundary (`04`) |

---

## Must-address checklist

- [ ] **Archetype confirmed** — agent decides what to retrieve (not a single attached doc → that's the Station-0 off-ramp); **static vs agentic** chosen on purpose (→ `01`).
- [ ] **Chunking matches document structure** — strategy picked per doc-type, overlap carried, source+section metadata on every chunk.
- [ ] **Embedding model pinned** — query and corpus use the same model+mode; rotation = full re-embed is acknowledged; model picked from a live source, not memory.
- [ ] **Index mode justified** — vector by default; **hybrid** if exact-match queries matter; **rerank** only if precision (not recall) is the measured bottleneck.
- [ ] **Retrieval tuned** — top-k set against context-recall (not guessed); metadata/permission filtering applied; dedup/MMR if near-duplicates dilute.
- [ ] **Grounding enforced** — answer cites retrieved spans; cited IDs validated against what was actually retrieved (no fabricated cites).
- [ ] **Retrieval quality is measured** (→ `02`) — context precision/recall + groundedness/faithfulness; MV bar is at least *one* such check, not zero.
- [ ] **Freshness handled** (→ `04`) — a re-index/expiry plan for changing sources; stale answers are a known, bounded risk.
- [ ] **Retrieval poisoning treated as indirect injection** (→ `04`) — corpus content is untrusted; source-trust boundary before any retrieved text reaches a privileged tool.
- [ ] **Cost/latency budgeted** (→ `04`) — embedding + retrieval + rerank + generation per query within ceiling; caching where stable.

---

## Deep-dive sources   (point to sources.md § RAG)

See **`../sources.md § RAG / Retrieval`** for the dated ledger. Anchors this recipe was built against:
- **Lewis et al. 2020 — Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks** (the origin of RAG) — `arxiv.org/abs/2005.11401`.
- **Anthropic — Contextual Retrieval** (contextual embeddings + BM25; hybrid + rerank; the failure-rate figures above) — `anthropic.com/news/contextual-retrieval` (verified 2026-06-25).
- **RAGAS** — retrieval-quality eval metrics (context precision/recall, faithfulness, answer/response relevancy); the eval *methodology* is owned by `02` — `docs.ragas.io` (verified 2026-06-25).
- **Microsoft GraphRAG** — graph + community-summary RAG for global/aggregative queries (demo, not a supported product; indexing is expensive) — `github.com/microsoft/graphrag` (verified 2026-06-25).
- **Pinecone — Hybrid search** (dense + sparse/BM25, fusion, alpha-weighting; reputable hybrid/rerank primer) — `docs.pinecone.io/guides/search/hybrid-search` (verified 2026-06-25).
- **HyDE — Gao et al. 2022, Precise Zero-Shot Dense Retrieval without Relevance Labels** (query→hypothetical-doc→embed→retrieve) — `arxiv.org/abs/2212.10496`.

For *volatile* specifics — embedding-model rankings, vector-DB feature matrices, reranker benchmarks, current prices — open the live source; never quote a cached number.
