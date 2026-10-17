#!/usr/bin/env bash
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

letters() { printf "%${1}s" | tr ' ' a; }

guard_repo() {
  local dir
  dir=$(mktemp -d "$TMP_ROOT/guard.XXXXXX") &&
    git -C "$dir" init -q &&
    git -C "$dir" config user.email test@example.com &&
    git -C "$dir" config user.name test &&
    git -C "$dir" config commit.gpgsign false &&
    git -C "$dir" config core.hooksPath "$REPO/.githooks" &&
    mkdir -p "$dir/.git/info" &&
    printf 'zebracorp\n' > "$dir/.git/info/private-terms" &&
    echo "$dir"
}

stage() {
  printf '%s\n' "$3" > "$1/$2" && git -C "$1" add -f -- "$2"
}

blocked() {
  stage "$@" &&
    ! git -C "$1" commit -q -m test 2> "$1.err" &&
    grep -qF "pre-commit: $2:" "$1.err"
}

committed() {
  stage "$@" && git -C "$1" commit -q -m test
}

test_guard_blocks_token() {
  local dir
  dir=$(guard_repo) && blocked "$dir" token.txt "token: gh""o_$(letters 36)"
}

test_guard_blocks_home_path() {
  local dir
  dir=$(guard_repo) && blocked "$dir" paths.txt "see /Us""ers/someone/x"
}

test_guard_blocks_private_term() {
  local dir
  dir=$(guard_repo) && blocked "$dir" notes.txt "Working with ZebraCorp today"
}

test_guard_blocks_ds_store() {
  local dir
  dir=$(guard_repo) && blocked "$dir" .DS_Store "x"
}

test_guard_blocks_term_in_file_name() {
  local dir
  dir=$(guard_repo) && blocked "$dir" zebracorp-notes.txt "Nothing private here"
}

test_guard_blocks_term_in_message() {
  local dir
  dir=$(guard_repo) && stage "$dir" notes.txt "Nothing private here" &&
    ! git -C "$dir" commit -q -m "Fix the ZebraCorp flow" 2> "$dir.err" &&
    grep -qF "commit-msg: commit message:" "$dir.err"
}

test_guard_message_skips_comments_and_verbose_diff() {
  local dir
  dir=$(guard_repo) && stage "$dir" notes.txt "Nothing private here" &&
    printf '%s\n' "Clean subject" "# ZebraCorp in a comment" "# ------------------------ >8 ------------------------" \
      "-/Us""ers/someone/x" > "$dir.msg" &&
    git -C "$dir" commit -q --cleanup=scissors -F "$dir.msg"
}

test_guard_passes_clean() {
  local dir
  dir=$(guard_repo) && committed "$dir" notes.txt "Nothing private here"
}

test_guard_added_lines_only() {
  local dir
  dir=$(guard_repo) &&
    stage "$dir" old.txt "/Us""ers/someone/x" &&
    git -C "$dir" commit -q --no-verify -m seed &&
    printf 'more\n' >> "$dir/old.txt" &&
    git -C "$dir" add old.txt &&
    git -C "$dir" commit -q -m test
}

test_guard_blank_term_lines() {
  local dir
  dir=$(guard_repo) &&
    printf 'zebracorp\n\n\n' > "$dir/.git/info/private-terms" &&
    committed "$dir" notes.txt "Nothing private here"
}

TEMPLATE="$REPO/claude/settings.json"
FOREIGN_HOOKS='{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"foreign-start"}]}],"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"foreign-pre"}]}]}}'

merge_dir() { mktemp -d "$TMP_ROOT/merge.XXXXXX"; }

same_json() { [ "$(jq -S . "$1")" = "$(jq -S . "$2")" ]; }

test_merge_fresh() {
  local d
  d=$(merge_dir) && echo '{}' > "$d/live.json" &&
    source "$REPO/claude/install.sh" &&
    merge_settings "$d/live.json" "$TEMPLATE" > "$d/out.json" &&
    same_json "$d/out.json" "$TEMPLATE"
}

test_merge_empty_live() {
  local d
  d=$(merge_dir) && : > "$d/live.json" &&
    source "$REPO/claude/install.sh" &&
    merge_settings "$d/live.json" "$TEMPLATE" > "$d/out.json" &&
    same_json "$d/out.json" "$TEMPLATE"
}

test_merge_template_wins() {
  local d
  d=$(merge_dir) &&
    echo '{"model":"live-model","theme":"dark","permissions":{"extra":1,"defaultMode":"live-mode"}}' > "$d/live.json" &&
    source "$REPO/claude/install.sh" &&
    merge_settings "$d/live.json" "$TEMPLATE" > "$d/out.json" &&
    jq -e --slurpfile t "$TEMPLATE" '
      .model == $t[0].model and .theme == "dark"
      and .permissions.extra == 1 and .permissions.defaultMode == $t[0].permissions.defaultMode
      and .permissions.allow == $t[0].permissions.allow' "$d/out.json" > /dev/null
}

test_merge_keeps_foreign_hooks() {
  local d
  d=$(merge_dir) && echo "$FOREIGN_HOOKS" > "$d/live.json" &&
    source "$REPO/claude/install.sh" &&
    merge_settings "$d/live.json" "$TEMPLATE" > "$d/out.json" &&
    jq -e --slurpfile t "$TEMPLATE" '
      .hooks.SessionStart == [{"hooks":[{"type":"command","command":"foreign-start"}]}]
      and .hooks.PreToolUse == $t[0].hooks.PreToolUse + [{"matcher":"*","hooks":[{"type":"command","command":"foreign-pre"}]}]
      and .hooks.PostToolUse == $t[0].hooks.PostToolUse' "$d/out.json" > /dev/null
}

test_merge_is_idempotent() {
  local d
  d=$(merge_dir) && echo "$FOREIGN_HOOKS" > "$d/live.json" &&
    source "$REPO/claude/install.sh" &&
    merge_settings "$d/live.json" "$TEMPLATE" > "$d/once.json" &&
    merge_settings "$d/once.json" "$TEMPLATE" > "$d/twice.json" &&
    same_json "$d/once.json" "$d/twice.json"
}

REAL_HOME=$HOME
REAL_CLAUDE=$(command -v claude)
export REAL_CLAUDE
LINKED_PATHS="hooks/comment-lint.py commands/code-review.md skills/codex-review skills/cursor-review skills/lean-flow skills/mistral-review skills/opencode-review skills/pr-create skills/pr-jira skills/pr-message skills/pr-review-watch skills/request-feedback-artifact skills/stacked-prs skills/visual-debrief"
LOCAL_PLUGINS="flow@flow-local flow-view@flow-local agent-atlas@agent-atlas-local"
REMOTE_MARKETPLACES="anthropics/claude-plugins-official pbakaus/impeccable warpdotdev/claude-code-warp DietrichGebert/ponytail"
REMOTE_PLUGINS="superpowers@claude-plugins-official frontend-design@claude-plugins-official mattpocock-skills@claude-plugins-official impeccable@impeccable warp@claude-code-warp ponytail@ponytail"

check() { "$@" || { echo "check failed: $*"; return 1; }; }

fails() { ! "$@" > /dev/null 2>&1; }

real_snapshot() {
  shasum "$REAL_HOME/.claude/settings.json" "$REAL_HOME/.claude/CLAUDE.md"
  ls -lA "$REAL_HOME/.claude/skills"
  jq -c keys "$REAL_HOME/.claude/plugins/known_marketplaces.json"
  jq -c '.plugins | keys' "$REAL_HOME/.claude/plugins/installed_plugins.json"
  jq -c '.mcpServers | keys' "$REAL_HOME/.claude.json"
}

# The stub gh keeps the real one away: under a scratch HOME it still reads the real token from the keychain.
# The stub claude records remote marketplace adds and plugin installs instead of fetching them, so tests stay offline.
scratch_home() {
  local h
  h=$(mktemp -d "$TMP_ROOT/home.XXXXXX") && mkdir "$h/bin" || return 1
  cat > "$h/bin/gh" << 'EOF'
#!/bin/sh
[ "$1 $2" = "auth token" ] && [ -n "${FAKE_GH_TOKEN:-}" ] && echo "$FAKE_GH_TOKEN" && exit 0
exit 1
EOF
  cat > "$h/bin/claude" << 'EOF'
#!/bin/sh
if [ "$1 $2 $3" = "plugin marketplace add" ]; then
  case "$4" in /*) ;; *) [ -z "${FAIL_REMOTE:-}" ] || exit 1; echo "marketplace add $4" >> "$HOME/remote-calls"; exit 0 ;; esac
elif [ "$1 $2" = "plugin install" ]; then
  case "$3" in *@flow-local | *@agent-atlas-local) ;; *) [ -z "${FAIL_REMOTE:-}" ] || exit 1; echo "install $3" >> "$HOME/remote-calls"; exit 0 ;; esac
fi
exec "$REAL_CLAUDE" "$@"
EOF
  chmod +x "$h/bin/gh" "$h/bin/claude" && echo "$h"
}

in_home() {
  local h=$1
  shift
  (cd "$h" && unset CLAUDE_CONFIG_DIR GH_TOKEN GITHUB_TOKEN &&
    HOME=$h PATH="$h/bin:$PATH" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "$@")
}

links_point_at_repo() {
  local p
  for p in $LINKED_PATHS; do
    [ "$(readlink "$1/.claude/$p")" = "$REPO/claude/$p" ] || { echo "not linked: $p"; return 1; }
  done
}

copies_match_repo() {
  local f
  for f in CLAUDE.md RTK.md; do
    [ -f "$1/.claude/$f" ] && [ ! -L "$1/.claude/$f" ] && cmp -s "$1/.claude/$f" "$REPO/claude/$f" ||
      { echo "not a copy of the repo file: $f"; return 1; }
  done
}

settings_match_template() {
  jq -e --slurpfile t "$TEMPLATE" --arg flow "$REPO/claude/plugins/flow" '
    .model == $t[0].model
    and .hooks.PreToolUse == $t[0].hooks.PreToolUse
    and .hooks.PostToolUse == $t[0].hooks.PostToolUse
    and .extraKnownMarketplaces["flow-local"].source.path == $flow' "$1/.claude/settings.json" > /dev/null ||
    { echo "settings do not match the template:"; jq -c '{model, hooks, flow: .extraKnownMarketplaces["flow-local"]}' "$1/.claude/settings.json"; return 1; }
}

plugin_list() { in_home "$1" claude plugin list --json | jq -c '[.[] | {id, version, enabled}] | sort_by(.id)'; }

local_plugins_enabled() {
  local list id
  list=$(plugin_list "$1") || return 1
  for id in $LOCAL_PLUGINS; do
    jq -e --arg id "$id" 'any(.[]; .id == $id and .enabled)' <<< "$list" > /dev/null || { echo "plugin not enabled: $id"; return 1; }
  done
}

remote_calls_recorded() {
  local calls
  calls=$(cat "$1/remote-calls") &&
    [ "$(sed -n '1,4p' <<< "$calls" | LC_ALL=C sort)" = "$(printf 'marketplace add %s\n' $REMOTE_MARKETPLACES | LC_ALL=C sort)" ] &&
    [ "$(sed -n '5,$p' <<< "$calls" | LC_ALL=C sort)" = "$(printf 'install %s\n' $REMOTE_PLUGINS | LC_ALL=C sort)" ] ||
    { echo "unexpected remote calls:"; cat "$1/remote-calls" 2> /dev/null; return 1; }
}

first_run_backups() {
  local b
  b=$(echo "$1"/.claude/dotfiles-backups/*) &&
    grep -qx old "$b/skills/pr-create/SKILL.md" && [ ! -e "$b/skills/pr-create/pr-create" ] &&
    [ -L "$b/commands/code-review.md" ] || { echo "pre-existing paths not backed up as expected"; return 1; }
}

skills_hold_only_links() {
  [ "$(ls -A "$1/.claude/skills" | wc -l | tr -d ' ')" = 12 ] || { echo "extra entries in skills/:"; ls -A "$1/.claude/skills"; return 1; }
}

backed_up() { (cd "$1/.claude/dotfiles-backups" && find . -mindepth 2 -maxdepth 2 | sed 's|^\./[^/]*/||' | LC_ALL=C sort | xargs); }

nothing_cloned() { [ -z "$(ls -A "$1/.claude/plugins/marketplaces" 2> /dev/null)" ] || { echo "a marketplace was cloned"; return 1; }; }

test_install() {
  local h before plugins
  before=$(real_snapshot) && h=$(scratch_home) &&
    mkdir -p "$h/.claude/skills/pr-create" "$h/.claude/commands" &&
    echo old > "$h/.claude/skills/pr-create/SKILL.md" &&
    ln -s "$h/missing/code-review.md" "$h/.claude/commands/code-review.md" || { echo "setup failed"; return 1; }

  {
    in_home "$h" /bin/bash "$REPO/claude/install.sh" > "$h/run1.log" 2>&1 &&
      links_point_at_repo "$h" && skills_hold_only_links "$h" && first_run_backups "$h" &&
      check [ "$(backed_up "$h")" = "commands settings.json skills" ] && copies_match_repo "$h" &&
      settings_match_template "$h" && local_plugins_enabled "$h" && remote_calls_recorded "$h" &&
      nothing_cloned "$h" && check grep -q 'gh auth login' "$h/run1.log"
  } || { tail -n 30 "$h/run1.log"; return 1; }

  echo "local edit" >> "$h/.claude/CLAUDE.md" &&
    jq '.hooks.SessionStart = [{"hooks":[{"type":"command","command":"foreign-start"}]}]' "$h/.claude/settings.json" > "$h/s.json" &&
    mv "$h/s.json" "$h/.claude/settings.json" &&
    plugins=$(plugin_list "$h") || { echo "edits before the second run failed"; return 1; }

  {
    in_home "$h" /bin/bash "$REPO/claude/install.sh" > "$h/run2.log" 2>&1 &&
      check grep -q '^-local edit' "$h/run2.log" && check grep -q '^+++ .*/claude/CLAUDE.md' "$h/run2.log" &&
      check grep -q 'local edit' "$h"/.claude/dotfiles-backups/*/CLAUDE.md && copies_match_repo "$h" &&
      check jq -e '.hooks.SessionStart == [{"hooks":[{"type":"command","command":"foreign-start"}]}]' "$h/.claude/settings.json" &&
      settings_match_template "$h" && links_point_at_repo "$h" &&
      skills_hold_only_links "$h" && check [ "$(backed_up "$h")" = "CLAUDE.md commands settings.json skills" ] &&
      check [ "$(plugin_list "$h")" = "$plugins" ] &&
      nothing_cloned "$h" && check [ "$(real_snapshot)" = "$before" ]
  } || { tail -n 30 "$h/run2.log"; return 1; }
}

test_install_finishes_after_remote_failures() {
  local h before rc=0
  before=$(real_snapshot) && h=$(scratch_home) && export FAIL_REMOTE=1 || { echo "setup failed"; return 1; }
  in_home "$h" /bin/bash "$REPO/claude/install.sh" > "$h/run.log" 2>&1 || rc=$?
  {
    check [ "$rc" -ne 0 ] && settings_match_template "$h" && local_plugins_enabled "$h" && links_point_at_repo "$h" &&
      check grep -q impeccable <<< "$(sed -n '/^Warnings:/,$p' "$h/run.log")" &&
      check grep -q superpowers@claude-plugins-official <<< "$(sed -n '/^Warnings:/,$p' "$h/run.log")" &&
      check grep -q 'gh auth login' "$h/run.log" && check [ "$(real_snapshot)" = "$before" ]
  } || { tail -n 30 "$h/run.log"; return 1; }
}

test_install_mcp_authenticated() {
  local h before
  before=$(real_snapshot) && h=$(scratch_home) && export FAKE_GH_TOKEN=fake-token &&
    in_home "$h" /bin/bash -c 'source "$1" && install_mcp' _ "$REPO/claude/install.sh" > "$h/mcp.log" 2>&1 &&
    check jq -e '.mcpServers.github_inline_comment | .type == "http" and .url == "https://api.githubcopilot.com/mcp/"
      and .headers.Authorization == "Bearer fake-token"' "$h/.claude.json" &&
    check [ "$(real_snapshot)" = "$before" ] || { cat "$h/mcp.log" 2> /dev/null; return 1; }
}

test_install_mcp_unauthenticated() {
  local h before
  before=$(real_snapshot) && h=$(scratch_home) &&
    in_home "$h" /bin/bash -c 'source "$1" && install_mcp' _ "$REPO/claude/install.sh" > "$h/mcp.log" 2>&1 &&
    check grep -q 'gh auth login' "$h/mcp.log" &&
    check fails in_home "$h" claude mcp get github_inline_comment &&
    check [ "$(real_snapshot)" = "$before" ] || { cat "$h/mcp.log" 2> /dev/null; return 1; }
}

run_section() {
  local found=0 t
  for t in $(declare -F | awk '{ print $3 }' | grep -E "^test_$1(_|\$)"); do
    found=1
    if ( "$t" ) > "$TMP_ROOT/$t.log" 2>&1; then
      echo "PASS $t"
      passed=$((passed + 1))
    else
      echo "FAIL $t"
      sed 's/^/    /' "$TMP_ROOT/$t.log"
      failed=$((failed + 1))
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "FAIL no tests in section $1"
    failed=$((failed + 1))
  fi
}

passed=0
failed=0
for section in ${*:-guard merge install}; do
  run_section "$section"
done
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
