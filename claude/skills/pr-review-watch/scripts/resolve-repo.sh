#!/usr/bin/env bash
# resolve-repo.sh — map a GitHub "owner/repo" to a local clone path under ~/projects.
#
# Usage:
#   resolve-repo.sh <owner/repo>     # prints local path (empty + exit 1 if not cloned)
#   resolve-repo.sh --list           # prints "owner/repo<TAB>path" for every cloned repo
#
# Scans ~/projects/* and ~/projects/*/* (depth 1 and 2, so ~/projects/acme/widgets is found)
# for git repos, reads each origin remote, and matches on the NORMALIZED remote — not the
# folder name. This is why a local "acme/widgets" folder correctly resolves to
# "acme-corp/widgets-platform".
#
# Matching is case-insensitive (GitHub owner/repo are case-insensitive).

set -euo pipefail

ROOTS=("${PR_REVIEW_WATCH_ROOT:-$HOME/projects}")

# Normalize a git remote URL to lowercase "owner/repo".
# Handles: https://github.com/owner/repo(.git), git@github.com:owner/repo(.git),
#          ssh://git@github.com/owner/repo(.git)
normalize_remote() {
  local url="$1"
  url="${url%.git}"                 # strip trailing .git
  url="${url#git@*:}"               # strip scp-style "git@host:"
  url="${url#ssh://*/}"             # strip "ssh://.../"
  url="${url#https://*/}"           # strip "https://host/"
  url="${url#http://*/}"            # strip "http://host/"
  # Keep only the final "owner/repo" (last two path segments)
  local repo owner
  repo="${url##*/}"
  url="${url%/*}"
  owner="${url##*/}"
  printf '%s/%s' "$owner" "$repo" | tr '[:upper:]' '[:lower:]'
}

# Emit "owner/repo<TAB>path" for every cloned repo found under the roots.
enumerate() {
  local root d url norm
  for root in "${ROOTS[@]}"; do
    [ -d "$root" ] || continue
    # depth 1 and depth 2 directories
    for d in "$root"/*/ "$root"/*/*/; do
      [ -d "${d}.git" ] || [ -f "${d}.git" ] || continue
      url="$(git -C "$d" remote get-url origin 2>/dev/null)" || continue
      [ -n "$url" ] || continue
      norm="$(normalize_remote "$url")"
      printf '%s\t%s\n' "$norm" "${d%/}"
    done
  done
}

main() {
  local query="${1:-}"
  if [ -z "$query" ]; then
    echo "usage: resolve-repo.sh <owner/repo> | --list" >&2
    exit 2
  fi

  if [ "$query" = "--list" ]; then
    enumerate | sort -u
    return 0
  fi

  local want path
  want="$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')"
  # First exact match wins. No early `exit` in awk: that would SIGPIPE the upstream
  # git loop and, under pipefail+set -e, abort before we print. enumerate is small,
  # so reading it to EOF is cheap; the !found guard keeps only the first match.
  path="$(enumerate | awk -F'\t' -v w="$want" '$1==w && !found {print $2; found=1}')"
  if [ -n "$path" ]; then
    printf '%s\n' "$path"
    return 0
  fi
  exit 1   # not cloned locally
}

main "$@"
