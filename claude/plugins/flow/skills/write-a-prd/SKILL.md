---
name: write-a-prd
description: Turn a settled design into a product requirements document saved under flow's FLOW_ROOT/prds/. Use when flow's Heavy depth reaches its PRD step, or when the user asks for a PRD.
---

# Write a PRD

By the time this runs, brainstorming and grilling have settled the design. Write it down so that someone
who missed those conversations can build from it. Do not reopen decisions that are already made.

## Gather

- Read the design spec under `FLOW_ROOT/specs/`, the grilling outcome, and any glossary or ADRs it produced.
  `FLOW_ROOT` is `docs/flow/` unless the repo's `AGENTS.md` or `CLAUDE.md` pins another root.
- Ask the user only about what is still missing or contradictory, with your recommended answer for each.
  If nothing is missing, ask nothing. If there is no design yet, suggest running brainstorming first.

## Write

Save the PRD to `FLOW_ROOT/prds/<YYYY-MM-DD>-<feature>.md` with these sections:

1. **Problem**: who has it and what it costs them today.
2. **Goals**: the outcomes that mean this worked.
3. **Non-goals**: what is deliberately left out, so nobody builds it by accident.
4. **User-visible behaviour**: what people see and do, including empty, error and edge states.
5. **Technical approach**: components, data, interfaces, and the decisions already made with their
   reasons. Name modules and contracts rather than file paths that will drift.
6. **Success criteria**: checks a reviewer can run or observe to call it done.
7. **Open questions**: what is unresolved, each with who or which step settles it.

Use plain sentences and the project's own terms. Keep it as short as the design allows.

## Finish

Give the user the path and a three-line summary, and confirm it captures the design. Inside flow, hand
back so flow continues with `prd-to-issues`.
