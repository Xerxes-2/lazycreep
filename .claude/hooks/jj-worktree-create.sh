#!/usr/bin/env bash
# WorktreeCreate, this repo's version: ~/.claude/hooks/jj-worktree-create.sh execs this when it
# exists, passing the hook JSON on stdin. Prints the workspace path on stdout; the rest → stderr.
#
# Workspaces live in <root>/.claude/worktrees/<name> (gitignored, so the main workspace never
# snapshots them). The base, in order of preference:
#   1. repo config `claude.worktree-base`, when it resolves to exactly one commit. An
#      orchestrator points it at its integration bookmark
#      (`jj config set --repo claude.worktree-base integ`) and unsets it after.
#   2. trunk() (`main`).
#   3. a frozen copy of @ via `jj duplicate` ("cc-base: <name>"); basing directly on @ would go
#      stale as soon as the main workspace snapshots again.
#
# Claude Code never calls WorktreeRemove for hook-based subagent worktrees, so "agent-*" ones are
# registered under .claude/worktrees/.sessions/<session_id>/ for jj-worktree-sweep.sh.
set -euo pipefail

input=$(cat)
name=$(jq -r '.name // .worktree_name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
sid=$(jq -r '.session_id // empty' <<<"$input")
[ -n "$name" ] && [ -n "$cwd" ] || { echo "jj-worktree: missing name/cwd" >&2; exit 1; }

root=$(jj -R "$cwd" --ignore-working-copy workspace root)
root=${root%%/.claude/worktrees/*}   # called from inside a subagent workspace: use the main one
wts="$root/.claude/worktrees"
dest="$wts/$name"
[ -e "$dest" ] && { echo "jj-worktree: $dest already exists" >&2; exit 1; }
mkdir -p "$wts"

j() { jj -R "$root" --ignore-working-copy --color never "$@"; }
cfg_base=$(j config get claude.worktree-base 2>/dev/null || true)
if [ -n "$cfg_base" ] && [ "$(j log --no-graph -r "$cfg_base" -T '"x"' 2>/dev/null)" = "x" ]; then
  base="$cfg_base"
  echo "jj-worktree: basing on claude.worktree-base = $cfg_base" >&2
elif [ -n "$(j log --no-graph -r 'trunk() ~ root()' -T '"x"' 2>/dev/null)" ]; then
  base="trunk()"
else
  out=$(jj -R "$root" --color never duplicate @ 2>&1)
  base=$(sed -n 's/^Duplicated [0-9a-f]* as \([a-z]*\) .*/\1/p' <<<"$out" | head -1)
  [ -n "$base" ] || { echo "jj-worktree: cannot parse duplicate output: $out" >&2; exit 1; }
  jj -R "$root" describe -r "$base" -m "cc-base: $name" >&2
fi
jj -R "$root" workspace add --name "cc-$name" -r "$base" "$dest" >&2

if [[ "$name" == agent-* && -n "$sid" ]]; then
  mkdir -p "$wts/.sessions/$sid"
  printf '%s\n' "$dest" >"$wts/.sessions/$sid/$name"
fi

# Setup failures are logged, never fatal, so a broken setup can't block a subagent.
"$(dirname "$0")/worktree-setup.sh" "$dest" "$root" >&2 || echo "jj-worktree: setup failed ($?)" >&2
echo "$dest"
