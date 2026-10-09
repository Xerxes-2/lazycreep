#!/usr/bin/env bash
# Called by jj-worktree-create.sh (same dir) as: <this> <new-workspace> <main-root>
# Output goes to stderr; failure is logged by the hook, never fatal.
set -uo pipefail
dest=$1 root=$2

# Secrets: link (not copy) so a rotated token reaches every workspace. Ignored by .gitignore.
for f in .env.local .env; do
  [ -f "$root/$f" ] && [ ! -e "$dest/$f" ] && ln -s "$root/$f" "$dest/$f" && echo "worktree-setup: linked $f"
done

# Dependencies: pnpm's content-addressed store makes this a fast, mostly-offline link step.
for dir in "$dest" "$dest/web"; do
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    (cd "$dir" && pnpm install --frozen-lockfile --prefer-offline --reporter=silent) \
      && echo "worktree-setup: pnpm install ok in ${dir#$dest/}"
  fi
done
exit 0
