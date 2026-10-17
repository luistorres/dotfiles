---
name: visual-debrief
description: Use when the user asks for a debrief, summary, report, or state-of-the-system overview of anything substantial (a big PR or review, an audit, a migration, an incident, a research result) — especially when they say "visual debrief", ask for diagrams, or say long text blocks are tiring to read.
---

# Visual debrief

## Overview

Present a large body of findings as one verdict-first web page the reader absorbs in
minutes, published with the Artifact tool (its design guidance loads then). The medium
exists because walls of chat text exhaust the reader; the page must therefore be
*scannable first, readable second* — never a prose dump restyled in HTML.

## Process

1. **Gather with structure.** Whatever produced the material (your own work, parallel
   subagents, tool output), collect it as discrete claims with evidence
   (`file:line`, command output, URL), severity/weight, and — just as important —
   what was checked and found *fine*.
2. **Verify before you publish.** Re-check the evidence for every claim that will
   headline the page. Label claims you confirmed yourself vs secondhand ones
   (`VERIFIED` / `REPORTED`); drop or demote what you tried and failed to confirm.
   A confident wrong citation costs the reader more than no citation.
3. **Build the page** from the contract below.
4. **End with a standalone chat message**: first sentence = the verdict; then direct
   answers to each question the user literally asked; then the artifact link. The page
   carries the detail; the message must work without it.

## Page contract

Ordered skeleton; every debrief has 1–3 and the closing next-steps, the middle sections
appear when the content calls for them:

1. **Meta line + title** — what this covers, scope/ref/date, how it was produced.
2. **Verdict strip** — 4–7 status chips encoding the state at a glance (green/warn/red).
3. **Verdict card** — 3–5 sentences: overall judgment first, sharpest caveats after.
4. **The shape of the thing** — short prose plus diagrams *only where structure earns
   them*: an entity/system map when relationships matter, a state diagram for a
   lifecycle, a sequence diagram for any race, ordering, or multi-party flow (these are
   exactly the things prose hides). Mermaid fences render natively in artifacts. Label
   arrows with what actually travels; a mislabeled arrow is worse than no diagram.
5. **Tables for anything enumerable or comparative** — divergences with a per-row
   ruling, feature-vs-implementation coverage, option comparisons. One row per item,
   explanations in surrounding prose, never paragraphs squeezed into cells.
6. **What held / what needs attention** — the good news is information too (it shows
   what was examined); then issues ordered by severity, each with its evidence and its
   verified/reported label, and whether it blocks.
7. **See it yourself** — copy-pasteable commands or links so the reader can reproduce
   or explore without asking you.
8. **Next steps** — numbered, each with the reason for its position. Judgment calls
   that belong to the reader appear as explicit questions (`DECIDE`), never silently
   resolved for them.

## Language

- Technical human language: complete sentences, terms spelled out, no fragment chains
  (`A → B → fails`), no jargon the reader must reverse-engineer.
- Selectivity over compression: cut what doesn't change the reader's next action;
  write what remains in full sentences.
- Every label you invent (chip text, table verdicts, tags) must be self-explanatory on
  first sight — the reader has no legend and no memory of your process.
- No decoration that carries no information (mascots, poems, emoji as section markers).
- Options and recommendations must come from the material; don't invent remedies the
  work never established.

## Common mistakes

- Restyled prose: long paragraphs inside cards ≠ a visual debrief. If a section reads
  top-to-bottom only, restructure it (table, list, diagram) or shorten it.
- Diagrams as ornament — a diagram of something with no structure is filler; and a
  diagram whose arrows/labels conflate two facts (e.g. an HTTP response labeled with a
  later side-effect) actively misleads.
- Burying the answer to the user's literal question in the page but not in the chat
  message.
- Publishing secondhand claims as fact because the source "seemed thorough" — the
  verification pass is the load-bearing step.
- A verdict strip that needs the whole page to decode — chips state facts, not teasers.
