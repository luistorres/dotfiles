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
LINKED_PATHS="hooks/comment-lint.py commands/code-review.md skills/pr-create skills/pr-jira skills/pr-message skills/pr-review-watch skills/request-feedback-artifact skills/stacked-prs skills/visual-debrief"
LOCAL_PLUGINS="vision@vision-local vision-view@vision-local agent-atlas@agent-atlas-local"
REMOTE_MARKETPLACES="anthropics/claude-plugins-official pbakaus/impeccable warpdotdev/claude-code-warp DietrichGebert/ponytail"
REMOTE_PLUGINS="frontend-design@claude-plugins-official mattpocock-skills@claude-plugins-official impeccable@impeccable warp@claude-code-warp ponytail@ponytail"

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
  case "$3" in *@vision-local | *@agent-atlas-local) ;; *) [ -z "${FAIL_REMOTE:-}" ] || exit 1; echo "install $3" >> "$HOME/remote-calls"; exit 0 ;; esac
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
  jq -e --slurpfile t "$TEMPLATE" --arg vision "$REPO/claude/plugins/vision" '
    .model == $t[0].model
    and .hooks.PreToolUse == $t[0].hooks.PreToolUse
    and .hooks.PostToolUse == $t[0].hooks.PostToolUse
    and .extraKnownMarketplaces["vision-local"].source.path == $vision' "$1/.claude/settings.json" > /dev/null ||
    { echo "settings do not match the template:"; jq -c '{model, hooks, vision: .extraKnownMarketplaces["vision-local"]}' "$1/.claude/settings.json"; return 1; }
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
  [ "$(ls -A "$1/.claude/skills" | wc -l | tr -d ' ')" = 7 ] || { echo "extra entries in skills/:"; ls -A "$1/.claude/skills"; return 1; }
}

backed_up() { (cd "$1/.claude/dotfiles-backups" && find . -mindepth 2 -maxdepth 2 | sed 's|^\./[^/]*/||' | LC_ALL=C sort | xargs); }

nothing_cloned() { [ -z "$(ls -A "$1/.claude/plugins/marketplaces" 2> /dev/null)" ] || { echo "a marketplace was cloned"; return 1; }; }

test_install() {
  local h before plugins
  before=$(real_snapshot) && h=$(scratch_home) &&
    mkdir -p "$h/.claude/skills/pr-create" "$h/.claude/commands" &&
    echo old > "$h/.claude/skills/pr-create/SKILL.md" &&
    ln -s "$REPO/claude/skills/retired-skill" "$h/.claude/skills/retired-skill" &&
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
      check grep -q frontend-design@claude-plugins-official <<< "$(sed -n '/^Warnings:/,$p' "$h/run.log")" &&
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

VISION="$REPO/claude/plugins/vision"
REVIEW=$'crit=0 imp=1 minor=0\n#### Critical\n#### Important\n- a.ts:3 drops the cap\n#### Minor'

# The stub claude keeps second-opinion offline: it records its arguments, stdin, working directory
# and system prompt file, then prints the canned answer.json.
opinion_dir() {
  local d
  d=$(mktemp -d "$TMP_ROOT/opinion.XXXXXX") && mkdir "$d/bin" "$d/run" "$d/repo" || return 1
  cat > "$d/bin/claude" << 'EOF'
#!/bin/bash
printf '%s\n' "$@" > "$STUB_DIR/args"
prev=""
for arg in "$@"; do
  [ "$prev" = --append-system-prompt-file ] && cp "$arg" "$STUB_DIR/brief"
  prev=$arg
done
cat > "$STUB_DIR/stdin"
pwd > "$STUB_DIR/cwd"
cat "$STUB_DIR/answer.json" 2> /dev/null
exit "${STUB_EXIT:-0}"
EOF
  chmod +x "$d/bin/claude" && printf 'Repository: x\nDiff: y\n' > "$d/run/inputs.md" && echo "$d"
}

answer() {
  jq -n --arg result "$2" --argjson error "${3:-false}" '{type: "result", subtype: "success", is_error: $error,
    num_turns: 7, result: $result,
    usage: {input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40}}' > "$1/answer.json"
}

second_opinion() {
  local d=$1
  shift
  STUB_DIR=$d PATH="$d/bin:$PATH" VISION_SECOND_OPINION_MODEL=other-model "$VISION/bin/second-opinion" "$@"
}

fails_with() {
  local out
  out=$("${@:2}" 2>&1) && { echo "succeeded: ${*:2}"; return 1; }
  grep -qF -- "$1" <<< "$out" || { echo "expected \"$1\" in:"; echo "$out"; return 1; }
}

flag_value() { awk -v flag="$2" 'prev == flag { print; exit } { prev = $0 }' "$1/args"; }

test_vision_second_opinion_runs_read_only_with_the_brief() {
  local d
  d=$(opinion_dir) && answer "$d" "$REVIEW" &&
    second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo" > "$d/out" 2> "$d/err" &&
    check grep -qF -- '- a.ts:3 drops the cap' "$d/out" &&
    check [ "$(flag_value "$d" --model)" = other-model ] &&
    check [ "$(flag_value "$d" --tools)" = Read,Grep,Glob ] &&
    check [ "$(flag_value "$d" --permission-mode)" = dontAsk ] &&
    check jq -e '.disableAllHooks and (.permissions.deny | index("Read(**/.env)") and index("Read(**/*.pem)"))' <<< "$(flag_value "$d" --settings)" > /dev/null &&
    check [ "$(flag_value "$d" --output-format)" = json ] &&
    check [ "$(flag_value "$d" --add-dir)" = "$d/run" ] &&
    check grep -qx -- -p "$d/args" && check grep -qx -- --strict-mcp-config "$d/args" &&
    check grep -qx -- --setting-sources= "$d/args" &&
    check grep -qx -- --no-session-persistence "$d/args" &&
    check cmp -s "$d/stdin" "$d/run/inputs.md" && check [ "$(cat "$d/cwd")" = "$d/repo" ] &&
    check grep -q '^You are an adversarial reviewer' "$d/brief" && check fails grep -q '^name: code-reviewer' "$d/brief" &&
    check [ "$(tail -n 1 "$d/err")" = 'second-opinion: model=other-model turns=7 input=10 cache_read=20 cache_write=30 output=40' ]
}

test_vision_second_opinion_fails_on_an_error_result() {
  local d
  d=$(opinion_dir) && answer "$d" "$REVIEW" true &&
    fails_with 'Error: the review session failed' second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo"
}

test_vision_second_opinion_fails_without_severity_headings() {
  local d
  d=$(opinion_dir) && answer "$d" "Looks fine to me." &&
    fails_with 'no crit= line' second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo"
}

test_vision_second_opinion_accepts_a_formatted_count_line() {
  local d
  d=$(opinion_dir) && answer "$d" $'`crit=0 imp=1 minor=0`\n#### Critical\n#### Important\n- a.ts:3 x\n#### Minor' &&
    second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo" > /dev/null 2>&1
}

test_vision_second_opinion_fails_when_a_heading_is_missing() {
  local d
  d=$(opinion_dir) && answer "$d" $'crit=0 imp=0 minor=0\n#### Critical\n#### Important' &&
    fails_with 'missing a severity heading' second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo"
}

test_vision_second_opinion_fails_when_claude_exits_non_zero() {
  local d
  d=$(opinion_dir) && export STUB_EXIT=1 && check fails second_opinion "$d" code-reviewer "$d/run/inputs.md" "$d/repo"
}

test_vision_second_opinion_needs_a_model() {
  local d rc=0
  d=$(opinion_dir) && answer "$d" "$REVIEW" || return 1
  STUB_DIR=$d PATH="$d/bin:$PATH" env -u VISION_SECOND_OPINION_MODEL \
    "$VISION/bin/second-opinion" code-reviewer "$d/run/inputs.md" "$d/repo" 2> /dev/null || rc=$?
  check [ "$rc" -eq 3 ] && check [ ! -e "$d/args" ]
}

gate_repo() {
  local d
  d=$(mktemp -d "$TMP_ROOT/gate.XXXXXX") &&
    git -C "$d" init -q -b main && git -C "$d" config user.email test@example.com &&
    git -C "$d" config user.name test && git -C "$d" -c core.hooksPath=/dev/null commit -q --allow-empty -m seed &&
    mkdir -p "$d/docs/vision" && echo "$d"
}

gate() { jq -n --arg command "$2" --arg cwd "$1" '{tool_input: {command: $command}, cwd: $cwd}' | "$VISION/hooks/pr-gate"; }

single_state() {
  printf -- '---\nStatus: %s\nShape: single\nBranch: %s\n---\n# X\n\n## Steps\n%s\n\n## Log\n' "$2" "$3" "$4" > "$1/docs/vision/2026-10-18-x.md"
}

UNREVIEWED='- [x] frame · [x] build · [ ] review · [ ] fix · [ ] verify · [ ] ship'
REVIEWED='- [x] frame · [x] build · [x] review · [x] fix · [x] verify · [ ] ship'

test_vision_gate_blocks_an_unreviewed_branch() {
  local d
  d=$(gate_repo) && git -C "$d" switch -q -c lt/x && single_state "$d" in_progress lt/x "$UNREVIEWED" &&
    fails_with 'unticked for lt/x: review fix verify' gate "$d" "gh pr create --draft --title t"
}

test_vision_gate_allows_a_reviewed_branch() {
  local d
  d=$(gate_repo) && git -C "$d" switch -q -c lt/x && single_state "$d" in_progress lt/x "$REVIEWED" &&
    gate "$d" "gh pr create --draft --title t"
}

test_vision_gate_finds_a_stack_task_from_its_worktree() {
  local d
  d=$(gate_repo) && git -C "$d" worktree add -q -b lt/x "$d/wt" &&
    printf -- '%s\n' '---' 'Status: in_progress' 'Shape: stack' '---' '# S' '' '## [x] Task 1: a' \
      '- [x] build · [x] review · [x] fix · [x] verify · [x] pr' '- **Branch:** lt/a' '' '## [ ] Task 2: b' \
      '- [x] build · [x] review · [ ] fix · [ ] verify · [ ] pr' '- **Branch:** lt/x' '' '## Log' > "$d/docs/vision/2026-10-18-s.md" &&
    fails_with 'unticked for lt/x: fix verify' gate "$d" "cd $d/wt && gh pr create --fill"
}

test_vision_gate_requires_the_drift_review_when_listed() {
  local d
  d=$(gate_repo) && git -C "$d" switch -q -c lt/x &&
    printf -- '%s\n' '---' 'Status: in_progress' 'Shape: stack' '---' '# S' '' '## [ ] Task 3: c' \
      '- [x] build · [x] review · [x] fix · [x] verify · [ ] drift · [ ] pr' '- **Branch:** lt/x' '' '## Log' > "$d/docs/vision/2026-10-18-s.md" &&
    fails_with 'unticked for lt/x: drift' gate "$d" "gh pr create --fill" &&
    /usr/bin/sed -i '' 's/\[ \] drift/[x] drift/' "$d/docs/vision/2026-10-18-s.md" && check gate "$d" "gh pr create --fill"
}

test_vision_gate_reads_the_head_flag() {
  local d
  d=$(gate_repo) && single_state "$d" in_progress lt/x "$UNREVIEWED" &&
    check fails gate "$d" "gh pr create --head lt/x --fill" &&
    check fails gate "$d" "gh pr create --head \"lt/x\" --fill" &&
    check fails gate "$d" "gh pr new -H 'lt/x'"
}

test_vision_gate_reads_a_subshell_cd() {
  local d
  d=$(gate_repo) && git -C "$d" worktree add -q -b lt/x "$d/wt" && single_state "$d" in_progress lt/x "$UNREVIEWED" &&
    check fails gate "$d" "(cd \"$d/wt\" && gh pr create --fill)"
}

test_vision_gate_blocks_when_it_cannot_check() {
  local d
  d=$(gate_repo) && git -C "$d" switch -q -c lt/x && single_state "$d" in_progress lt/x "$REVIEWED" &&
    mkdir "$d/stub" && printf '#!/bin/sh\nexit 1\n' > "$d/stub/awk" && chmod +x "$d/stub/awk" || return 1
  local rc=0
  jq -n --arg cwd "$d" '{tool_input: {command: "gh pr create --fill"}, cwd: $cwd}' |
    PATH="$d/stub:$PATH" "$VISION/hooks/pr-gate" 2> /dev/null || rc=$?
  check [ "$rc" -eq 2 ]
}

test_vision_gate_ignores_what_it_does_not_govern() {
  local d
  d=$(gate_repo) && git -C "$d" switch -q -c lt/x && single_state "$d" in_progress lt/xy "$UNREVIEWED" &&
    check gate "$d" "gh pr create --fill" &&
    single_state "$d" done lt/x "$UNREVIEWED" && check gate "$d" "gh pr create --fill" &&
    single_state "$d" in_progress lt/x "$UNREVIEWED" && check gate "$d" "git status" &&
    check gate "$d" "gh pr view 3"
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
for section in ${*:-guard merge vision install}; do
  run_section "$section"
done
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
