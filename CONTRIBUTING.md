# 贡献指南

感谢你对 EmoBox 的关注！本文档介绍如何在本地跑起来、提交改动需要满足什么标准，以及维护者的发布流程。

## 开发环境

- Windows 10 / 11
- Node.js 22+
- Rust stable，目标三元组 `x86_64-pc-windows-msvc`，以及 MSVC C++ Build Tools
- Microsoft Edge WebView2 Runtime

## 本地开发

```powershell
npm install
npm run tauri dev    # 同时启动 Vite 与 Tauri
```

## 提交前验收标准

每个 PR 必须全部通过：

```powershell
npm run build                                       # tsc --noEmit + vite build
npx vitest run                                      # 前端单测
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test  --manifest-path src-tauri/Cargo.toml
```

涉及 UI / 交互的改动，请对照 `MANUAL_ACCEPTANCE.md` 的相关清单手动过一遍。

## 提交规范

Commit message 遵循 Conventional Commits：`type(scope): subject`

- type 取值：`feat` / `fix` / `refactor` / `docs` / `style` / `test` / `chore` / `perf`
- subject：英文、小写开头、祈使句、≤72 字符、结尾不加句号
- 破坏性变更在 type 后加 `!`，如 `refactor(api)!:`

## PR 指南

- 较大的改动请先开 issue 对齐方案，避免返工
- 一个 PR 聚焦一件事，混入无关改动会拖慢 review
- 仓库的架构约定与关键不变量集中在根目录 `CLAUDE.md` / `AGENTS.md`（两者内容一致），动核心链路（导入、剪贴板、回收站、分页）前务必先读
- 各阶段的实现决策与设计笔记在 `docs/`

## 项目结构速览

| 目录 | 内容 |
|---|---|
| `src/` | 前端：React 19 + TypeScript + Fluent UI v9（主窗口 / 快速搜索浮层 / 托盘菜单三棵独立 React 树） |
| `src-tauri/` | 后端：Rust + Tauri 2（SQLite 仓库层、导入/回收站服务、Windows 剪贴板与 UIA 平台层） |
| `docs/` | 各阶段实现决策与设计笔记 |
| `MANUAL_ACCEPTANCE.md` | 手动验收清单 |
| `CHANGES.md` | 更新日志（发布说明的唯一事实源） |

## 发布流程（维护者）

发布由 GitHub Actions 自动完成（`.github/workflows/release.yml`）：推送 `v*` 格式的 tag（如 `v0.1.0`）即自动构建并创建 Release。

1. 同步修改三处版本号：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`
2. 在 `CHANGES.md` **顶部**追加 `## vX.Y.Z（YYYY-MM-DD）` 段落（markdown，会作为应用内更新说明与 GitHub Release 正文展示）
3. 提交后打 tag 并推送：

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. Actions 构建完成后，Release 会附带：NSIS 安装包 `EmoBox_X.Y.Z_x64-setup.exe`、便携版 `EmoBox_X.Y.Z_x64.zip`、更新清单 `latest.json`，以及各产物的 `.sha256` 校验文件

> tag 必须与 `src-tauri/tauri.conf.json` 的 `version` 一致（workflow 会校验），否则构建直接失败。应用内更新按「镜像源列表 → 官方直连」顺序拉取 `latest.json` 与安装包，SHA-256 校验通过后启动安装器。
