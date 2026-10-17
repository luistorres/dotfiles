---
name: request-feedback-artifact
description: Use when building or fixing a Claude Artifact that needs to collect answers, decisions, or feedback from people you share the link with, and have those replies come back to you — e.g. "let people answer these questions in the artifact", "add a way for reviewers to reply", "how do I get people's answers back", or when a shared artifact's share link mysteriously stops working. Covers why `mailto:` and most runtime capabilities can't do this from inside the artifact sandbox, and the working alternative (in-page fields + clipboard-copy with a guaranteed fallback).
---

# Request-feedback artifact

## Overview

An Artifact page is a good way to lay out a set of questions or a decision doc for other
people to read — the design guidance in `artifact-design` covers that half well. Getting
their ANSWERS back to you is the other half, and the platform's own security sandbox rules
out the obvious approaches. This skill is what actually works, and how to diagnose the
detours that don't.

## Why the obvious approaches fail

The published page runs inside a sandboxed iframe. Its own frame-runtime script only
forwards http/https anchor clicks to the parent tab (to open a new tab) — it has no path
for anything else:

- **`mailto:` links do not work**, whether set via `window.location.href` in a script or
  via a real `<a href="mailto:…">` the user clicks. Chrome blocks a sandboxed iframe from
  handing off to a non-http protocol handler regardless of user gesture; this is a
  deliberate security boundary (an artifact you share can't be trusted to launch arbitrary
  apps on the viewer's machine), not a bug you can code around with a different technique.
- **The `mcp` capability** lets the page call the *viewer's own* connected tools (Slack,
  GitHub, …) — but only if that viewer already has the connector set up in their own
  claude.ai account, and critically, a page that declares `mcp` **cannot be shared
  publicly**. If the point is a link handed to people who may not have claude.ai accounts,
  `mcp` is off the table before you start. Load `artifact-capabilities` for the exact
  contract before touching this.
- **The `downloads` capability** only lets the viewer save a generated file locally — it
  doesn't send it anywhere. Someone still has to email or Slack you the file themselves.
- There's no generic form-backend or shared-state capability in the runtime. If automatic
  aggregation across many respondents matters (one spreadsheet, one inbox), that has to be
  an external service — a Google Form is the standard, no-account-needed choice for
  respondents — that the artifact links out to. Claude can't provision that account or
  service on the user's behalf, but can draft the question list and wire the artifact's
  button to open it once it exists.

## What works: in-page fields + copy-to-clipboard, with a guaranteed fallback

1. Add a `<textarea>` under each question or card the page already has — one field per
   unit a respondent would actually answer as a group (a numbered decision card, a brief's
   whole set of questions), not one per individual bullet point.
2. One button, labeled "Copy my answers" — not "Send", since nothing sends itself. On
   click:
   - Walk the DOM, collect only the non-blank fields, pairing each with its question's own
     heading text so the compiled output is self-describing on its own.
   - Join into plain text.
   - Reveal a `readonly` `<textarea>` holding that compiled text and call `.select()` on
     it immediately. This is the fallback that must always work: a native text selection
     needs no permission, so even if the next step fails, the respondent can still press
     Cmd/Ctrl+C themselves.
   - Attempt `navigator.clipboard.writeText(text)`; fall back to
     `document.execCommand("copy")` if it's unavailable; update the button's own label to
     confirm success or explain the manual fallback either way. Don't silently no-op on
     failure — the visible textarea plus an honest label is what makes this robust.
3. Tell the respondent where to send it (an email address, a Slack channel) directly in
   the page copy near the button — the mechanism can't address the message for them, so
   the instruction has to.

This is what actually shipped after `mailto` was tried and failed twice in the same
conversation (once as a script navigation, once as a real anchor) — both blocked at the
sandbox level, not fixable by trying a different JS technique for the same forbidden
navigation. Don't re-attempt `mailto` before reaching for this.

## If the share link itself doesn't work

Feedback pages tend to accumulate exactly the two things that break Artifact sharing.
Check both before assuming the reply mechanism is the problem:

- **Page size.** `WebFetch` the `claude.ai/code/artifact/{uuid}` URL directly (it works
  using the viewer's own login) and check the byte size of what comes back. A page can
  balloon from tens of KB to multiple MB because of an embedded diagram runtime — Mermaid
  fences get a full mermaid+iconify+dayjs+color-library bundle inlined into the served
  page. If a page needs a small flowchart or state diagram, hand-author it as inline SVG
  instead (nodes as `<rect>`/`<polygon>`, edges as `<path>` with a `<marker>` arrowhead,
  colors via CSS custom properties so it follows the page's own light/dark tokens) — a few
  KB versus several MB, and it reads exactly as clean.
- **A stale capability declaration.** The Artifact tool's publish response names any
  stored capability "carried forward" from an earlier version of the same artifact. `mcp`
  in particular makes a page unshareable (see above), so a page that once had it declared
  — even by accident, even in an earlier session — will silently stop working for external
  viewers. Pass `capabilities: {}` explicitly on every publish where none is wanted;
  omitting the field carries the old declaration forward unchanged, it does not reset it.

## Before touching any of this

Load `artifact-design` before writing or restyling the page, and `artifact-capabilities`
before declaring, reading about, or clearing any capability — this skill assumes both and
doesn't repeat their content.
