#!/usr/bin/env bash
# WorktreeRemove, this repo's version (~/.claude/hooks/jj-worktree-remove.sh execs it for paths
# under .claude/worktrees/). Snapshot, label the change "cc: <name>", forget the workspace, delete
# the dir. The change stays in the DAG; if empty it is abandoned, and so is its parent only when
# that parent is this workspace's own frozen "cc-base:" copy, still mutable, with no other
# children (the parent may be trunk or an integration commit — never drop those).
# Merge back with: jj squash -u --from <change> --into @ && jj abandon <cc-base>
set -uo pipefail

p=$(jq -r '.worktree_path // empty' <<<"$(cat)")
[ -n "$p" ] && [ -d "$p/.jj" ] || exit 0
[[ "$p" == */.claude/worktrees/* ]] || { echo "jj-worktree: refusing $p (not under .claude/worktrees)" >&2; exit 1; }
ws="cc-$(basename "$p")"

jj -R "$p" status >/dev/null 2>&1   # snapshot the subagent's edits
j() { jj -R "$p" --ignore-working-copy "$@"; }
own_base="$ws@- & description(regex:\"^cc-base: \") & mutable() & ~parents(children($ws@-) ~ $ws@)"
ids=$(j log -r "$ws@ | ($own_base)" --no-graph -T 'commit_id ++ " "')
if [ "$(j log -r "$ws@" --no-graph -T 'empty')" = "true" ]; then
  j workspace forget "$ws" >&2
  j abandon $ids >&2
else
  [ -n "$(j log -r "$ws@" --no-graph -T 'description')" ] || j describe -r "$ws@" -m "cc: $(basename "$p")" >&2
  j workspace forget "$ws" >&2
fi
rm -rf "$p"
