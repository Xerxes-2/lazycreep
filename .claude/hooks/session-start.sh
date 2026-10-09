#!/bin/bash
# Claude Code 云会话启动：装 jj 并 colocate，装 pnpm 依赖。本地会话直接退出。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# jj：容器里没有，从 nixpkgs 装（走 cache.nixos.org，约 40 秒）
if ! command -v jj >/dev/null 2>&1; then
  nix profile install nixpkgs#jujutsu
fi

# 仓库是 git clone 出来的，补成 jj colocated
if [ ! -d .jj ]; then
  jj git init --colocate
fi

# jj 不读 git 的 user.*，沿用容器的 git 身份
jj config set --repo user.name "$(git config user.name)"
jj config set --repo user.email "$(git config user.email)"

# 跟踪远端 main，方便 rebase 到 main 之上
jj bookmark track main@origin >/dev/null 2>&1 || true

pnpm install
