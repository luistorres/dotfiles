# Claude Code setup

`install.sh` rebuilds my Claude Code user setup in `~/.claude` from this folder:

- `CLAUDE.md` and `RTK.md`: the user-level directives, installed as copies.
- `hooks/comment-lint.py`, `commands/code-review.md` and the twelve skills in `skills/`, installed as links into this clone.
- `settings.json`: a template merged into `~/.claude/settings.json`.
- Plugins: `flow`, `flow-view` and `agent-atlas` from `plugins/` (local marketplaces), plus `superpowers`, `frontend-design` and `mattpocock-skills` from the official marketplace, and `impeccable`, `warp` and `ponytail` from their GitHub marketplaces.
- The GitHub MCP server `github_inline_comment`, using the token from `gh auth token`.

## Prerequisites

- Claude Code (native install), `git` and `jq`. The installer stops without them.
- `gh`, logged in with `gh auth login`, plus the stack extension: `gh extension install github/gh-stack`.
- `rtk` (a hook rewrites shell commands through it) and `python3` (for the comment hook).
- The review CLIs some skills call: `codex`, Cursor's `agent`, `opencode` and `vibe`, plus `npx`.

The installer warns about each missing optional tool and carries on.

## Install

```sh
git clone https://github.com/luistorres/dotfiles.git ~/dotfiles
~/dotfiles/claude/install.sh
```

Then restart Claude Code, or run `/reload-plugins`. The installer needs network access to register the GitHub marketplaces and install their plugins. If a step fails, it carries on with the rest, lists what failed and exits non-zero; fix the cause and run it again. It is safe to re-run: anything it replaces is first moved into `~/.claude/dotfiles-backups/<timestamp>-<pid>/`, and it prints a diff when an installed `CLAUDE.md` or `RTK.md` differs from this folder. If `gh` isn't logged in yet, it skips the MCP server with a warning; log in and run it again.

## Editing

- Skills, the hook and the command are links, so edits land in this clone. Claude Code's edit tools refuse to write through a link and write to the real path here instead.
- `CLAUDE.md` and `RTK.md` are copies, because Cowork in the desktop app skips a linked `~/.claude/CLAUDE.md`. Edit the copy here and re-run the installer; edits made to the installed copy are replaced by the next run (with a backup). Cowork also skips the `@RTK.md` import.
- `settings.json` is merged on every run. Keys this template sets win, so a change made inside Claude Code to one of them (the model or permissions, say) is reset by the next install, with a backup kept. Keys the template doesn't set, and hooks other tools add, are kept.
- The local plugins load in place from `plugins/`: edits take effect at the next session start or after `/reload-plugins`. If you bump a plugin's version, change it in both its `plugin.json` and the `marketplace.json` entry.

## Leak guard

This repo is public. The installer points `core.hooksPath` at `.githooks`, whose hooks block a commit when its added lines, file names or message contain a secret-shaped string, an absolute home path or a term listed in `.git/info/private-terms` (one per line, case-insensitive, never committed; a fresh clone starts without it, so add your own), and when it stages a `.DS_Store` file. Binary files aren't scanned.

`claude/test.sh` tests the guard, the settings merge and the installer. The installer tests run offline in a scratch home folder: the remote marketplaces and plugins are recorded rather than fetched.

## Not included

Memories, project settings, credentials and tokens, hooks and status lines that other tools add themselves, shell aliases, and the configs of other coding agents.
