# Claude Code setup

`install.sh` rebuilds my Claude Code user setup in `~/.claude` from this folder:

- `CLAUDE.md`: the user-level directives, installed as a copy.
- `hooks/comment-lint.py`, `commands/code-review.md` and the seven skills in `skills/`, installed as links into this clone.
- `settings.json`: a template merged into `~/.claude/settings.json`.
- Plugins: `vision`, `vision-view` and `agent-atlas` from `plugins/` (local marketplaces), plus `frontend-design` and `mattpocock-skills` from the official marketplace, and `impeccable`, `warp` and `ponytail` from their GitHub marketplaces. The template sets `superpowers` to disabled: its session hook pushes skill chains that cost more than they return under a fixed budget.
- The GitHub MCP server `github_inline_comment`, using the token from `gh auth token`.

## Prerequisites

- Claude Code (native install), `git` and `jq`. The installer stops without them.
- `gh`, logged in with `gh auth login`, plus the stack extension: `gh extension install github/gh-stack`.
- `python3`, for the comment hook.
- `npx`, for the projects whose lint and format commands use it.
- Optionally, in `~/.zshrc.local` (each model a name `claude --model` can reach):
  - `VISION_SECOND_OPINION_MODEL`, another vendor's model that vision uses for every plan review and as the second reviewer on standard- and high-risk changes. When it is unset, vision runs a Claude pass instead.
  - `VISION_EXTRA_REVIEW_MODEL`, an inexpensive model that vision runs as one extra review pass on high-risk changes and plans. When it is unset, vision runs a Claude pass instead.
  - `VISION_CLONE_ROOTS`, the colon-separated directories under which `pr-watch` looks for local clones of the repositories whose pull requests request your review. It defaults to `~/projects`.

The installer warns about each missing optional tool and carries on.

## Install

```sh
git clone https://github.com/luistorres/dotfiles.git ~/dotfiles
~/dotfiles/claude/install.sh
```

Then restart Claude Code, or run `/reload-plugins`. The installer needs network access to register the GitHub marketplaces and install their plugins. If a step fails, it carries on with the rest, lists what failed and exits non-zero; fix the cause and run it again. It is safe to re-run: anything it replaces is first moved into `~/.claude/dotfiles-backups/<timestamp>-<pid>/`, and it prints a diff when the installed `CLAUDE.md` differs from this folder. If `gh` isn't logged in yet, it skips the MCP server with a warning; log in and run it again.

## Editing

- Skills, the hook and the command are links, so edits land in this clone. Claude Code's edit tools refuse to write through a link and write to the real path here instead.
- `CLAUDE.md` is a copy, because Cowork in the desktop app skips a linked `~/.claude/CLAUDE.md`. Edit the copy here and re-run the installer; edits made to the installed copy are replaced by the next run (with a backup).
- `settings.json` is merged on every run. Keys this template sets win, so a change made inside Claude Code to one of them (the model or permissions, say) is reset by the next install, with a backup kept. Keys the template doesn't set, and hooks other tools add, are kept. The template sets no `advisorModel`: each advisor call re-reads the whole conversation, uncached, on the advisor's model, so set it in the live settings only on a machine where that is worth paying for.
- The local plugins load in place from `plugins/`: edits take effect at the next session start or after `/reload-plugins`. If you bump a plugin's version, change it in both its `plugin.json` and the `marketplace.json` entry.

## vision

`plugins/vision` is the harness that ships coding work. Each part is the kind of component it is for a reason:

- **Skills** are procedures, loaded only when used: `vision` runs a task from framing to PR, `review` sizes and runs adversarial review, and `pr-watch`, driven by `/loop`, reviews the pull requests that request your review and comments only when it has something new. The stack and issue-set procedures are reference files the `vision` skill opens only when a task needs them.
- **Agents** are for work that must not share the author's context: `code-reviewer` and `plan-reviewer` can only read and search, `implementer` builds one task of a stack in its own context, and `pr-reviewer` reviews one pull request for `pr-watch`, so its reading never reaches the watching session. Their prompts live in the agent files, so the orchestrator passes only each run's inputs.
- **`bin/second-opinion`** runs a reviewer's brief in a separate `claude -p` session on the model in `VISION_SECOND_OPINION_MODEL` (or `--model`), with read-only tools and no hooks or MCP servers.
- **`bin/pr-watch`** finds the pull requests awaiting your review and applies the watcher's rules (new heads only, at most two automatic reviews, no drafts) against a state file, so those rules are code with tests rather than sentences in a prompt.
- **`hooks/pr-gate`** blocks `gh pr create` while the run's state file shows its review, fix or verify step unticked. A rule that must always hold is a hook, not a sentence in a prompt.

Run state lives in `docs/vision/` of the repository being worked on. `/vision-view` shows the active run in a pane, or `/vision-view min` in one status line. Progress comes only from the state file. The running work comes only from Claude Code's own records: its subagent list, and the task id a background command reports at launch. A command counts as finished from its completion notice, or from the end-of-turn list of work still in flight, so the pane never guesses from command text or process lists. On a machine that ran the older `flow` plugins, the template disables them, and the installer removes skill links that point at skills no longer in this folder.

## Leak guard

This repo is public. The installer points `core.hooksPath` at `.githooks`, whose hooks block a commit when its added lines, file names or message contain a secret-shaped string, an absolute home path or a term listed in `.git/info/private-terms` (one per line, case-insensitive, never committed; a fresh clone starts without it, so add your own), and when it stages a `.DS_Store` file. Binary files aren't scanned.

`claude/test.sh` tests the guard, the settings merge, vision's second-opinion script, PR gate and pr-watch scan rules, and the installer. Everything runs offline: a stand-in `claude` answers the second-opinion tests, a stand-in `gh` answers the pr-watch tests, and the installer tests run in a scratch home folder where the remote marketplaces and plugins are recorded rather than fetched. `claude plugin test claude/plugins/vision/vision-view` runs the pane's tests.

## Not included

Memories, project settings, credentials and tokens, hooks and status lines that other tools add themselves, shell aliases, and the configs of other coding agents.
