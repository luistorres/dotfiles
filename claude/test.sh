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
