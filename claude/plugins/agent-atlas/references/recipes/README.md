<!-- last-reviewed: 2026-06-27 -->
# Recipes — per-archetype playbooks

A **recipe** does two things for one archetype (from the classifier in `../00-start-here.md`):
1. **Ties the four stations** for that archetype — one-line pointers into `01`–`04`, never restating them.
2. **Owns the archetype-specific content no station covers** (e.g. RAG's retrieval pipeline).

Same discipline as the stations: altitude, single-source-of-truth (link, don't duplicate), dated sources in `../sources.md`.

| Recipe | Archetype | Status |
|---|---|---|
| [`rag.md`](rag.md) | RAG / knowledge — owns the retrieval pipeline | authored |
| [`coding.md`](coding.md) | coding agent — owns the closed edit→run→observe loop (verifier-as-reward); maps `04`'s command blast-radius policy to command classes | authored |
| [`conversational.md`](conversational.md) | chat/support agent — owns the conversation spine (turn-state + felt UX + handoff) | authored |
| deep-research · computer-use · workflow-automation | — | research-route for now (`00`) |

> Most archetypes map cleanly onto the four stations, so their recipes are thin and lower-priority — `coding.md` and `conversational.md` are deliberately thinner than `rag.md`. RAG was authored first because it's the one archetype with a whole dimension (retrieval) that no station owns; the other two own a smaller archetype-specific spine each.

> These three are the full-depth recipes for the archetypes the `../00-start-here.md` classifier names. The remaining archetypes (deep-research · computer-use · workflow-automation) take the research-route (walk the stations generically) until a real project pulls a recipe forward — their missing recipe is an *already-known* deferral, so don't re-log it in `~/.claude/agent-atlas-gaps.md`; log only a genuinely new shortfall (e.g. the generic stations fell short for that archetype).
