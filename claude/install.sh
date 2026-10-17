#!/usr/bin/env bash
set -euo pipefail

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

main() {
  echo "usage: $0" >&2
  exit 2
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
