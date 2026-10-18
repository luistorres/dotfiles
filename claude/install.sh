#!/usr/bin/env bash
set -euo pipefail

SRC=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REPO=$(dirname "$SRC")
DEST=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
STAMP=$(date +%Y%m%d-%H%M%S)-$$
SKILLS=(pr-create pr-jira pr-message pr-review-watch request-feedback-artifact stacked-prs visual-debrief)
MCP_NAME=github_inline_comment
LINKED=""
BACKUPS=""
WARNINGS=""
FAILED=0

warn() {
  echo "warning: $1" >&2
  WARNINGS="$WARNINGS  $1"$'\n'
}

fail() {
  warn "$1"
  FAILED=1
}

# Kept out of skills/ and commands/, where Claude Code would load a backed-up copy alongside the new link.
backup() {
  local to="$DEST/dotfiles-backups/$STAMP/${1#"$DEST"/}"
  mkdir -p "$(dirname "$to")"
  mv "$1" "$to"
  BACKUPS="$BACKUPS  $to"$'\n'
}

merge_settings() {
  jq -n --slurpfile live "$1" --slurpfile tpl "$2" '
    ($live[0] // {}) as $l | $tpl[0] as $t
    | ($l * $t)
    | if .hooks then
        .hooks |= with_entries(.key as $e | .value = (
          ($t.hooks[$e] // []) as $th
          | $th + [($l.hooks[$e] // [])[] | select(. as $x | any($th[]; . == $x) | not)]
        ))
      else . end'
}

preflight() {
  local tool
  for tool in claude git jq; do
    command -v "$tool" > /dev/null || { echo "install.sh: $tool is required" >&2; exit 1; }
  done
  for tool in python3 gh npx; do
    command -v "$tool" > /dev/null || warn "$tool not found; the hook or skill that uses it will not work"
  done
  if command -v gh > /dev/null && ! grep -q 'github/gh-stack' <<< "$(gh extension list 2> /dev/null)"; then
    warn "gh stack extension missing: gh extension install github/gh-stack"
  fi
}

install_copy() {
  local src="$SRC/$1" dst="$DEST/$1"
  if [ -L "$dst" ] || [ -e "$dst" ]; then
    if [ ! -L "$dst" ] && cmp -s "$src" "$dst"; then return 0; fi
    echo "Replacing $dst, which differs from the repo copy:"
    diff -u "$dst" "$src" || true
    backup "$dst"
  fi
  cp "$src" "$dst"
}

install_link() {
  local src="$SRC/$1" dst="$DEST/$1"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then return 0; fi
  if [ -L "$dst" ] || [ -e "$dst" ]; then backup "$dst"; fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  LINKED="$LINKED $1"
}

install_files() {
  local skill link
  mkdir -p "$DEST"
  install_copy CLAUDE.md
  install_link hooks/comment-lint.py
  install_link commands/code-review.md
  for skill in "${SKILLS[@]}"; do install_link "skills/$skill"; done
  for link in "$DEST"/skills/*; do
    if [ -L "$link" ] && [ ! -e "$link" ]; then
      case $(readlink "$link") in "$SRC"/skills/*) rm "$link" ;; esac
    fi
  done
}

install_settings() {
  local live="$DEST/settings.json" tmp
  if [ ! -e "$live" ]; then
    cp "$SRC/settings.json" "$live"
    return 0
  fi
  tmp=$(mktemp "$live.XXXXXX")
  merge_settings "$live" "$SRC/settings.json" > "$tmp" && jq empty "$tmp" || { rm -f "$tmp"; return 1; }
  if cmp -s "$tmp" "$live"; then
    rm "$tmp"
  else
    backup "$live"
    mv "$tmp" "$live"
  fi
}

install_plugins() {
  local known name source id
  known=$(claude plugin marketplace list --json | jq -r '.[].name')
  while read -r name source; do
    grep -qxF "$name" <<< "$known" || claude plugin marketplace add "$source" < /dev/null ||
      fail "could not add the $name marketplace"
  done << EOF
claude-plugins-official anthropics/claude-plugins-official
impeccable pbakaus/impeccable
claude-code-warp warpdotdev/claude-code-warp
ponytail DietrichGebert/ponytail
vision-local $SRC/plugins/vision
agent-atlas-local $SRC/plugins/agent-atlas
EOF
  for id in $(jq -r '.enabledPlugins | to_entries[] | select(.value) | .key' "$SRC/settings.json"); do
    claude plugin install "$id" --scope user < /dev/null || fail "could not install $id"
  done
}

install_mcp() {
  local token
  if claude mcp get "$MCP_NAME" > /dev/null 2>&1; then return 0; fi
  if token=$(gh auth token 2> /dev/null) && [ -n "$token" ]; then
    claude mcp add --scope user --transport http "$MCP_NAME" https://api.githubcopilot.com/mcp/ \
      --header "Authorization: Bearer $token" || fail "could not add the GitHub MCP server $MCP_NAME"
  else
    warn "GitHub MCP server $MCP_NAME not added: run gh auth login, then re-run install.sh"
  fi
}

main() {
  preflight
  install_files
  # Claude Code's first CLI run in a fresh config migrates settings (it rewrote "opus" to "opus[1m]"),
  # so the template is merged after the plugin commands have run.
  install_plugins
  install_settings
  install_mcp
  if git -C "$REPO" rev-parse --git-dir > /dev/null 2>&1; then
    git -C "$REPO" config core.hooksPath .githooks
  fi
  echo
  echo "Installed into $DEST."
  if [ -n "$LINKED" ]; then echo "Linked:$LINKED"; else echo "Links were already in place."; fi
  if [ -n "$BACKUPS" ]; then printf 'Backed up:\n%s' "$BACKUPS"; fi
  echo "Plugins: $(jq -r '.enabledPlugins | keys | join(" ")' "$SRC/settings.json")"
  if [ -n "$WARNINGS" ]; then printf 'Warnings:\n%s' "$WARNINGS"; fi
  echo "Restart Claude Code (or run /reload-plugins) to load plugins."
  if [ "$FAILED" -ne 0 ]; then
    echo "Some steps failed (see the warnings above); fix them and re-run install.sh." >&2
    return 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
