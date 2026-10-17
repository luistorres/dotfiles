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
