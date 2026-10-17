---
name: prd-to-issues
description: Break a PRD into an ordered set of self-contained issues, thinnest end-to-end slice first, written to one file next to the PRD. Use when flow's Heavy depth reaches its issues step, or when the user wants a PRD split into issues.
---

# PRD to issues

## Pick the PRD

PRDs live in `FLOW_ROOT/prds/`. `FLOW_ROOT` is `docs/flow/` unless the repo's `AGENTS.md` or `CLAUDE.md`
pins another root. Use the PRD you were given; if there are several and none was named, ask which one.

## Slice

- Cut vertical slices: each issue delivers something that works end to end, not one layer of the stack.
- Issue 1 is the thinnest slice that passes through every part of the architecture the PRD describes, so
  the riskiest assumptions are tested first. Later issues widen it.
- Order the set so that each issue comes after everything it depends on.
- Size each issue so one person or one session can finish and review it alone.

## Write each issue

- **Title**: what ships, in a few words.
- **What and why**: what to build and why it matters, with the PRD's relevant decisions copied in.
- **Acceptance criteria**: observable checks that say it is done.
- **Depends on**: the numbers of the issues that must ship first, or "none".
- **Notes**: constraints, risks, and where in the code the work starts.

Each issue must stand on its own. Whoever picks it up may only see the filed issue, not the PRD or a
local or gitignored planning doc, so inline the substance instead of linking to those files.

## Output

Write the numbered issues, in order, to one file next to the PRD: `FLOW_ROOT/prds/<prd-name>-issues.md`.
Do not file anything in a tracker; flow's H1 and H2 steps decide where the issues live and file them.
Show the user the file and the ordered titles.
