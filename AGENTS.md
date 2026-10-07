# my-screeps-client

自用的 Screeps 客户端。

## Version control

本仓库用 jj（colocated，底层 git）。所有版本控制操作走 jj，遵循 `jj` skill；git 只读。

## Agent skills

### Issue tracker

Issues 在 GitHub Issues（Xerxes-2/my-screeps-client），用 gh CLI 操作。See `docs/agents/issue-tracker.md`.

### Triage labels

默认五个标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目录 `GLOSSARY.md` + `docs/adr/`。See `docs/agents/domain.md`.
