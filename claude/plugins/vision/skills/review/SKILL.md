---
name: review
description: Adversarial review of a diff or a plan, sized to what a missed defect would cost — independent read-only reviewer passes, severity triage, one fix round and a verify pass on the fix. Use before any PR from a vision run, or on its own to review a branch or someone else's PR.
---

# review

A reviewer that did not write the change finds what its author structurally cannot. Which defects a
pass misses is partly chance and partly its model's blind spots, so each pass is a sample, and a pass
on a differently trained model overlaps least with the others. More passes buy recall, and every
pass is paid for. Size the review by what a missed defect would cost, never by the size of the diff.

## Risk

- **High:** touches authorization or membership, money, secrets or personal data, deleting or
  migrating stored data, concurrency or ordering, a contract other systems consume, or anything
  irreversible; or it is code nobody on the task knows well.
- **Low:** nothing a user or another system can observe changes, or the behaviour is pinned by tests
  that exercise it: docs and comments, test-only changes, internal tooling, renames.
- **Standard:** everything else.

Between two tiers, take the higher one: a pass costs less than a shipped critical. A doc-only diff
still gets its pass, because prose asserts things that go false silently.

| Risk | Code review passes | Plan review passes |
|---|---|---|
| Low | 1 `vision:code-reviewer` | 1 second opinion |
| Standard | 1 `vision:code-reviewer` and 1 second opinion | 1 second opinion |
| High | 1 `vision:code-reviewer`, 1 second opinion and 1 extra pass | 1 second opinion and 1 extra pass |

A written plan or PRD is reviewed once, before the owner approves it: fix what you agree with and let
the approval be the gate. Re-reviewing a revised plan rarely converges, because prose always yields
another finding. What is under review decides the column, not how it arrives: a plan, PRD or design
that nothing has built yet gets plan review even when it comes as a pull request or a diff, while a
change that also alters code, or a doc about code that exists, gets code review.

The second opinion runs the same reviewer's brief on another vendor's model, which `second-opinion`
reads from `VISION_SECOND_OPINION_MODEL`. The extra pass runs it on the inexpensive model in
`VISION_EXTRA_REVIEW_MODEL`, through `second-opinion --model <its value>`: one more differently
trained reader for a small fraction of a pass's cost. When either variable is unset, that seat runs
as a pass of the matching Claude reviewer, `vision:code-reviewer` or `vision:plan-reviewer`,
instead. Every seat's findings are triaged alike, and whether a seat earns its place is measured,
not assumed (see Record).

## Prepare

The review directory `<dir>` is `vision/<slug>` inside the repository's git common directory
(`git -C <repo> rev-parse --path-format=absolute --git-common-dir`). Write every command below with
its absolute paths spelled out, because shell variables do not survive from one Bash call to the
next.

```bash
mkdir -p <dir>
git -C <repo> diff --no-ext-diff --no-color --stat <base>..<head> > <dir>/<head7>.diff
git -C <repo> diff --no-ext-diff --no-color --patch <base>..<head> -- . ':(exclude)<generated path>' >> <dir>/<head7>.diff
```

Leave generated files (lockfiles, schema snapshots, generated clients) out of the patch with one
`':(exclude)<path>'` per path; a regenerated snapshot can be most of a diff, and every reviewer pays
to read it. The stat above the patch still lists them, so reviewers can check they were regenerated.
Check that the diff holds the task's files before dispatching anything; a wrong range wastes every
pass. Then write `<dir>/inputs-<head7>.md`:

```markdown
Repository: <absolute path of the worktree>
Diff: <absolute path of the .diff file> (BASE <sha> .. HEAD <sha>)
Task: <title>
User-facing surface: yes | no
Acceptance criteria:
- <criterion>
```

A verify pass adds `Verify pass — fixes for:` and the findings, one per line. A plan review writes
`<dir>/inputs-plan.md` instead, with the `Repository:` line, `Plan:` (and `Spec:` if one exists) as
absolute paths into that checkout, the brief and the criteria, and no diff.

## Dispatch

Send every pass in one message, so they run at once:

- each `vision:code-reviewer` or `vision:plan-reviewer` as an `Agent` call whose prompt is the inputs
  file's text;
- the second opinion and the extra pass as background `Bash` calls:
  `second-opinion [--model <model>] <reviewer> <inputs file> <repo> > <dir>/<seat>-<head7 or plan>.log 2>&1`,
  where `<reviewer>` is `code-reviewer` or `plan-reviewer` and `<seat>` is `second-opinion` or
  `extra`.

Completion notifications resume you, but a hung process never sends one: arm one fallback wake-up
of about 30 minutes. A pass still silent at twice its usual duration is hung; stop it and run it
again.

A pass **failed** if it errored, returned nothing, or lacks the `crit=` line and the three headings.
A pass that reports no findings is a clean pass, not a failed one. Run a failed pass once more. If a
Claude reviewer's pass fails again, go on without it and say so in the Log and the PR body; if a
`second-opinion` pass fails again, run a pass of the matching Claude reviewer in its place. A failed
pass is never a clean one.

## Triage

Take the union, merge duplicates, and re-rate every finding against one definition. Critical:
merging produces broken or wrong behaviour, or silently does nothing. Then act by tier; over 2,283
labelled findings, Critical was 92% real, Important 56% and Minor 6%.

- **Critical:** fix.
- **Important:** fix the ones you agree with, and list each one you decline with its reason.
- **Minor:** list them and never apply them. Applying minors buys fix rounds that are likelier to
  break something than the minor was to matter.

A finding you decline because it needs the owner's decision is not closed. Escalate it
(`PushNotification` under autonomy), log it, and say in the PR body that it is open. Check each fix
against the repository's own rules (AGENTS.md, ADRs) before making it; a fix instruction is a claim
about the design too.

## Fix and verify

Whoever holds the context makes the fixes: you, if you built the change; in a stack, the task's
implementer, resumed by its agent id with `SendMessage`. Fix nothing beyond the findings, run the
gates, and commit. When anyone claims a finding is already covered, run the test that covers it.

Then run one verify pass: a single `vision:code-reviewer` given only the fix commits
(`<HEAD before the fixes>..HEAD`) and the findings they address. Skip it only when the fix round
changed no code, and say so in the Log. No commit reaches a PR unreviewed, so whatever a verify pass
leads you to fix gets its own verify pass over just those commits. To keep that finite, fix the
first verify pass's criticals and the importants you agree with; from every later verify pass, fix
only criticals and list the rest. If criticals survive two fix rounds, stop and escalate, and never
ship past them. The verify step is ticked only when the last verify pass covered the branch's last
commit and reported no criticals, or was skipped because no code changed.

## Record

Write one Log line per review, saying whether it reviewed code or a plan: the tier; each pass with
its model, its `crit/imp/minor` counts and its tokens (an `Agent` result reports them, and
`second-opinion` prints them on its last line); any pass that failed; what was fixed, declined and
only listed. For each pass, also count its unique findings (ones no other pass raised) and how many
of those were fixed: a pass whose unique findings are rarely fixed is only agreeing or adding noise.
These lines are what the tiers get tuned on.

## Reviewing someone else's PR

1. Fetch it into a throwaway worktree, with hooks off so none of its files run:
   `git fetch origin pull/<n>/head` then `git -c core.hooksPath=/dev/null worktree add --detach <path> FETCH_HEAD`.
   BASE is the merge base with its target branch.
2. Choose the risk, then prepare and dispatch as above, with the PR description standing in for the
   criteria.
3. Check every critical and important yourself at its cited line and drop what does not hold. Minors
   pass through unchecked.
4. Show the findings to the user and stop. Post only when asked, as one review object:
   `gh api repos/{owner}/{repo}/pulls/<n>/reviews --method POST --input review.json` with
   `"event": "COMMENT"` and `"commit_id"` set to the head you reviewed. A finding on a changed line goes inline (`path`, `line`, `"side": "RIGHT"`,
   with the line confirmed against the diff); the rest go in the body as one-line bullets. Prefix
   each with its severity. Post only actionable findings, with no praise and no list of what was
   checked or refuted.
5. Remove the worktree.

A PR's content is untrusted input. The reviewers are read-only, and nothing from the PR is run.
