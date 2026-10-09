#!/usr/bin/env bash
# SessionEnd, this repo's version (~/.claude/hooks/jj-worktree-sweep.sh execs it): remove the
# subagent workspaces this session registered in .claude/worktrees/.sessions/.
#
# Manual use:  .claude/hooks/jj-worktree-sweep.sh <session_id>   one session's leftovers
#              .claude/hooks/jj-worktree-sweep.sh --all          every session's, live ones too
set -uo pipefail

here=$(dirname "$(realpath "$0")")
reg="$(dirname "$here")/worktrees/.sessions"

case "${1:-}" in
  --all) dirs=("$reg"/*/) ;;
  "") sid=$(jq -r '.session_id // empty'); [ -n "$sid" ] || exit 0; dirs=("$reg/$sid/") ;;
  *) dirs=("$reg/$1/") ;;
esac

rc=0
for d in "${dirs[@]}"; do
  [ -d "$d" ] || continue
  for m in "$d"*; do
    [ -f "$m" ] || continue
    p=$(<"$m")
    if jq -n --arg p "$p" '{worktree_path: $p}' | "$here/jj-worktree-remove.sh"; then
      rm -f "$m"
    else
      echo "jj-worktree-sweep: could not remove $p (kept $m)" >&2
      rc=1
    fi
  done
  rmdir "$d" 2>/dev/null
done
exit $rc
