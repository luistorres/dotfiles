# Issue sets

An issue set is for work that other people or sessions will pick up, so the decomposition itself is
the deliverable. Use it when the work is multi-owner or the design is open enough that it has to be
split before anyone can build. A large change with one owner is a stack instead.

## Write it

1. A PRD at `docs/vision/plans/<YYYY-MM-DD>-<slug>-prd.md`: the problem, who it is for, goals and
   non-goals, the decisions taken with their reasons, and the open questions.
2. The issues, each a vertical slice someone can take on its own. Each body stands alone: context,
   acceptance criteria, dependencies and risk. It never points at a local planning document, which
   the person who picks it up will not have.
3. One `vision:plan-reviewer` pass over the PRD and the issue set together, before anything is filed.
4. Ask the owner, as part of the approval, where the issues live: in the state file, or in a
   tracker such as GitHub (`gh issue create`), which then owns their status.

## State file

`docs/vision/<YYYY-MM-DD>-<slug>.md` in the main checkout:

```markdown
---
Status: in_progress
Shape: issues
Tracker: local | github:<owner>/<repo>
---
# <title>

PRD: docs/vision/plans/<YYYY-MM-DD>-<slug>-prd.md

## Issues
- [ ] 1. <title> · <#n when filed> · depends on: none
- [ ] 2. <title> · <#n> · depends on: 1

## Log
- <YYYY-MM-DD> filed <N> issues
```

## Working an issue

An issue the owner asks you to take becomes its own vision run, single or stack, with
`Parent: <path of this file>` in its front matter. When it ships, tick its row, or close it in the
tracker. Under autonomy, take every open issue in dependency order without stopping to ask between
them; an issue that depends on another starts from that issue's branch once its PR is open.

On resume with a tracker, read the issues' state from the tracker first. If anything diverged since
the last session (an issue was closed, or assigned to someone else), say so and confirm before
continuing. Never take an issue that is closed or that someone else owns.

When every issue is shipped or closed, set `Status: done`.
