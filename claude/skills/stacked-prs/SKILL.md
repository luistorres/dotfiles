---
name: stacked-prs
description: Create and manage a chain of dependent pull requests (stacked PRs) with GitHub's native `gh stack` extension — one PR per logical layer, each targeting the one below. Use whenever the user says "stack these PRs", "stacked PR", "split this into a stack", asks to rebase/sync/merge a whole stack at once, or when a branch of work is big enough that it should ship as an ordered chain of small dependent PRs instead of one large PR. Handles the rebase-the-whole-stack case the manual reset+merge+cherry-pick dance used to.
---

# Stacked PRs (`gh stack`)

GitHub's native stacked-PR tool. A stack is a chain of dependent PRs: the bottom
targets `main`, each one above targets the branch below it. GitHub cascades the
rebases on merge, so a merged parent no longer forces manually rebuilding its
children — the pain in the old manual mechanics is gone.

## Preconditions (check once, fail loud)

```bash
gh --version                 # need >= 2.90
git --version                # need >= 2.20
gh extension list | grep stack || gh extension install github/gh-stack
```

- Repo must have **stacked PRs enabled** on GitHub. If a command exits **9**, the
  feature is off for the repo — stop and tell the user; do not fall back to a
  hand-rolled stack silently.
- Exit codes worth knowing: `2` not in a stack, `3` rebase conflict, `4` API
  failure, `9` feature not enabled.

## Mental model — get the layering right BEFORE building

Foundational changes go **low**, dependents go **high**. Schema / shared types /
migrations at the bottom; API routes on top of them; UI on top of that. Each PR
shows only its own layer's diff, so a wrong layering means a reviewer sees an
unreviewable diff. Decide the order first, with the user if it's non-obvious.

One PR = one shippable, independently-reviewable unit — same bar as any single
PR. Don't stack for the sake of it; stack when the next unit genuinely depends on
one that hasn't merged yet.

## Build a stack

```bash
gh stack init <bottom-branch>          # trunk = default branch; -b <branch> to override
# ...work..., then either:
git add -A && git commit -m "..."      # commit on the current top branch
gh stack add <next-branch>             # new branch on top of current top
# or in one shot:
gh stack add -Am "message" <next-branch>   # stage-all + commit + branch
```

Turn **existing** branches into a stack (bottom → top):
`gh stack init feat/schema feat/api feat/ui`

## Push + open the PRs

```bash
gh stack push                # force-with-lease per branch (NON-atomic; re-run if one is rejected)
gh stack submit              # push all + create/link PRs, chained bases
gh stack submit --auto       # skip the editor, auto titles (non-interactive)
gh stack submit --open       # mark ready for review (else new PRs are drafts under --auto)
```

`submit` opens an interactive editor to pick which branches get PRs and draft
titles/descriptions (Ctrl+S to send). Deselect-all + Ctrl+B links already-open
PRs into a stack without creating new ones.

## Rebase the whole stack — the point of this tool

Prefer this over any manual rebase of a stacked chain.

```bash
gh stack sync                # fetch, ff trunk, cascade-rebase every branch onto its parent,
                             # push atomically (--force-with-lease --atomic), sync PR state.
                             # --prune deletes local branches for merged PRs.
gh stack rebase              # cascading rebase only (no push, no PR-state sync)
gh stack rebase --downstack  # only trunk..current
gh stack rebase --upstack    # only current..top
gh stack rebase --no-trunk   # rebase branches onto each other, skip pulling/rebasing trunk
gh stack rebase --continue   # after resolving conflicts
gh stack rebase --abort      # restore every branch to pre-rebase state
```

Rules of thumb:
- **`sync` is the default** for "bring my stack up to date with `main` and push."
  It's the one-command replacement for rebase-each-branch-then-force-push. It's
  all-or-nothing on conflict: on a rebase conflict it restores every branch to
  its original state and tells you to run `gh stack rebase` to resolve
  interactively.
- Use **`rebase`** when you want to resolve conflicts locally without touching the
  remote yet, then `gh stack push` (or `sync`) when clean.
- A **merged** parent is handled automatically — the cascade drops its now-in-`main`
  commits (`--onto` mode) instead of replaying them as conflicts.
- `git rerere` is auto-enabled, so a conflict resolved once in the cascade isn't
  re-asked on the next branch.
- Conflict loop: run `sync`/`rebase` → resolve in the working tree → `git add` →
  `gh stack rebase --continue`. Bail with `--abort` — it restores ALL branches,
  not just the current one.

## When `gh stack` CAN'T drive the rebase — go per-branch by hand

Two situations break the one-command `sync`; fall back to rebuilding each branch
in its own worktree, bottom-up:

1. **One-worktree-per-branch layout.** `gh stack sync` rebases every branch from a
   single checkout, but git refuses to rewrite a branch that's checked out in
   another worktree — sync can't even complete `gh stack checkout`. Symptom:
   `checkout` reports "already used by worktree". (A throwaway `git clone` sidesteps
   the lock but re-introduces problem 2.)
2. **A generated file both sides append to — e.g. a Drizzle `_journal.json`.** A git
   3-way merge of a JSON array does NOT conflict when both sides *append* an entry
   with the same index; it silently keeps both → **duplicate migration idx**. This
   is a git behavior, not a gh-stack bug: `sync`/`rebase` sail past it without
   stopping. After any cascade touching migrations, ALWAYS
   `node -e "…check j.entries for dup idx…"`; don't trust "no conflict."

**Per-branch rebuild recipe** (each branch in the worktree that owns it, bottom-up;
handles merge commits and migration renumbering cleanly):

```bash
# in <this-branch>'s worktree, parent already rebuilt+pushed:
git checkout -B <this-branch> origin/<parent-branch>     # NOT a bare push later — upstream is now parent
git cherry-pick <own-commit>…                            # only THIS branch's commits (drops merges)
# migration commit conflicts (or silently dups the journal) → reset migrations to the parent, regenerate:
git checkout origin/<parent-branch> -- packages/db/drizzle   # wholesale, avoids per-file pathspec misses
git clean -fd packages/db/drizzle
pnpm --filter @acme/db db:generate                       # emits a fresh, correctly-numbered migration
git add -A && git commit --amend --no-edit               # fold regen into the migration commit
# verify EVERY migration branch:
pnpm --filter @acme/db db:generate   # must say "No schema changes" (CI drift gate)
#   + journal has no dup idx
git push --force-with-lease origin <this-branch>:<this-branch>   # explicit refspec
```

Extra hazards seen in practice:
- **Hand-written data/seed migrations** (`drizzle generate` emits nothing) must be
  renumbered by hand: rename the `.sql`, copy the previous `meta/NNNN_snapshot.json`
  to the new number with a fresh `id` and `prevId` = the previous snapshot's `id`,
  and append a journal entry with `when` > the previous entry's.
- **Stale `dist/` in a reused worktree** makes a correct source tree fail typecheck
  against a *different* branch's built `.d.ts`. Run `pnpm -r --filter './packages/**' build`
  before trusting any `tsc --noEmit`.
- **Count assertions drift.** If the base grew an action/row the branch also added,
  hardcoded totals (`toHaveLength(N)`, "N actions / M cells") are now off by the
  base's addition — grep and bump them.
- A **squash-merged parent** (a common default) means the parent's commits aren't in
  `main` by SHA, so a plain `git rebase` replays and conflicts — cherry-pick the
  branch's OWN commits instead.

## Inspect + navigate

```bash
gh stack view                # ✓ merged  ◎ queued  ○ open  ⚠ needs rebase
gh stack view --short        # one line per branch
gh stack checkout <n|pr|url|branch>   # switch to / fetch a stack
gh stack up / down / top / bottom / trunk / switch
```

`⚠ needs rebase` in `view` is the signal to run `gh stack sync`.

## Restructure

`gh stack modify` — interactive TUI to drop / fold / insert / reorder / rename
branches. Stage changes, Ctrl+S to apply, then `gh stack submit` to push the new
shape to GitHub. `--continue` / `--abort` for conflicts.

## Merge

```bash
gh stack merge               # interactive: pick how far up to merge, method, confirm
gh stack merge <pr-number>   # merge everything up to and including that PR
gh stack merge --yes --squash
```

- Atomic and all-or-nothing: everything up to your selection merges, or nothing does.
- Branch protection / repo rules are enforced by GitHub at merge time — bypassing
  merge requirements is **not** supported for stacks (a security floor, not a bug).
- If the base uses a merge queue, the stack is queued and the queue's method wins.
- **Do not `--admin`-bypass or force a merge to route around a failing rule.** If a
  stack won't merge, surface why; leave the merge decision to the user.

## Cleanup

`gh stack sync --prune` after merges to drop local branches for merged PRs. If the
current checkout would be pruned, it moves you to the first active branch (or trunk).

## Guardrails

- Never open PRs (`submit`) or merge (`merge`) without the user asking — same rule as
  any PR: create and leave for review, don't self-merge or bypass protection.
- If the repo doesn't have stacked PRs enabled (exit 9), say so — don't silently
  hand-build a fake stack of PRs with wrong bases.
- Get the layering right up front; reordering after PRs exist means a `modify` +
  `submit` round-trip and re-review.
