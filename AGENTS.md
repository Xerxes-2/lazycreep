# lazycreep

自用的 Screeps 客户端 lazycreep（旧名 my-screeps-client）。

## Version control

本仓库用 jj（colocated，底层 git）。所有版本控制操作走 jj，遵循 `jj` skill；git 只读。

单人仓库，**不用 PR**。GitHub 只做备份与 issue 记录。

- `main` 只在一项工作完成并验证后才前移；开发在从 `main` 拉出的新 change 上进行，需要命名时用本地书签（例如 `feat/<slug>`），多个子代理并行时用一个集成书签。
- 完成后在本地把工作 rebase 到 `main` 之上，验证（`pnpm test`、`pnpm typecheck`、`nix flake check`），再 `jj bookmark set main -r <顶部提交>` 快进并 `jj git push --bookmark main`。
- 关闭 issue：在提交说明里写 `Closes #N`（推到 `main` 时 GitHub 自动关闭），或 `gh issue close`。
- 功能书签合进 `main` 后删除（本地与远端）。需要中途备份时可以推功能书签，但不开 PR。

## Agent skills

### Issue tracker

Issues 在 GitHub Issues（Xerxes-2/lazycreep），用 gh CLI 操作。See `docs/agents/issue-tracker.md`.

### Triage labels

默认五个标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目录 `GLOSSARY.md` + `docs/adr/`。See `docs/agents/domain.md`.
