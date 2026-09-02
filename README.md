# EmoBox

EmoBox 是一个 Windows 优先的本地表情资产管理工具，用于导入、整理、搜索和快速复制表情图片到剪贴板。基于 Tauri v2、React、TypeScript 和 Fluent UI React v9 构建，以 [GPL-3.0](LICENSE) 协议开源。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

应用有两个顶层窗口：主窗口 `main`（资料库 + 设置）和一个瞬态 `quick-search` 浮层（全局快捷键唤出）。用户原始图片保持原位；EmoBox 只把「导入」的图片复制到自己的受管素材库。

## 核心特性

- **受管导入与存储**：导入图片、拖放、导入文件夹都会把图片**复制**到 EmoBox 素材库（`app_data/assets/emojis/`）并生成缩略图，原始文件绝不被改动。导入文件夹时每个顶层子文件夹自动建立同名分组。
- **智能去重**：SHA-256 字节级精确去重 + dHash 感知去重；感知重复时可选择「强制导入」。
- **剪贴板收藏**：按 `Ctrl+Alt+S` 把当前剪贴板图片编码为 PNG 存入素材库（确定性编码，相同内容自动跳过）。
- **快速搜索浮层**：`Ctrl+Alt+Space` 唤出独立搜索窗口，全库跨字段实时搜索（支持 `组*标签` 精确语法），Enter / 点击即复制到剪贴板；可选自动粘贴到打开浮层前的窗口。
- **分组 / 标签 / 收藏 / 回收站**：全部经 SQLite 持久化（`app_data/emobox.sqlite3`），重启不丢失。
- **最近使用**：最近 50 条按 `lastUsedAt` 降序，复制即记录。
- **多排序**：名称、格式、按添加时间、按修改时间（新→旧）。
- **网格多选**：批量收藏、移入分组、打标签、删除 / 恢复 / 彻底删除。
- **自动检查更新**：启动时静默检查 GitHub Releases 上的新版本；内置 gh-proxy 风格加速镜像源（可自定义、可测速排序），安装包经 SHA-256 校验后启动安装程序，更新说明以 markdown 展示。
- **本地优先**：无云端、无账号、无网络同步；只处理你主动导入 / 收藏的图片。唯一的联网行为是「检查更新 / 下载安装包」（请求 GitHub 或你配置的镜像源）与默认关闭的「联网下载网页 GIF」。

## 导入方式

| 方式 | 说明 |
|---|---|
| 导入图片 / 拖放 | 复制到受管素材库，自动生成缩略图 |
| 导入文件夹 | 递归复制全部支持图片；每个顶层子文件夹自动建同名分组 |
| 从剪贴板收藏（`Ctrl+Alt+S`） | 把当前剪贴板图片编码为 PNG 存入素材库 |

支持格式：**PNG / JPG / JPEG / GIF / WebP**。受管副本静态图任一边超过 512px 会压缩到 512px 内；动画（GIF / APNG / 动画 WebP）保持原始字节。

## 全局快捷键

- `Ctrl+Alt+Space`：唤出 / 隐藏快速搜索浮层（可在设置中修改；避开 Windows 的 `Alt+Space` 系统菜单）
- `Ctrl+Alt+S`：从剪贴板收藏（可在设置中修改）

快捷键被其他应用占用时，主窗口显示错误提示，设置页保留可见的失败原因，注册失败的修改不会覆盖已生效的快捷键。

## 自动粘贴（Windows）

快速搜索复制成功后，可自动把图片粘贴到打开浮层前的窗口（微信 / QQ / 飞书等）。它只合成 `Ctrl+V`，**绝不发送 Enter**；目标窗口无法恢复时自动降级为仅复制。可在设置中关闭。

## 设置

侧栏底部「设置」打开设置对话框，四个部分：

- **常规**：外观（主题：跟随系统 / 浅色 / 深色）、通用（默认启动页面）、行为（自动粘贴开关）
- **快捷键**：录制 / 编辑两个全局快捷键、打开浮层
- **存储与导入**：素材库位置、导入方式说明、支持格式
- **关于**：logo + 版本胶囊、仓库与协议（GPL-3.0）、检查更新（markdown 更新说明）、镜像源管理（增删 / 测速 / 恢复默认）、能力清单与开源依赖

主题、侧栏折叠、默认启动页面、全局快捷键、自动粘贴开关、自动检查更新、镜像源列表持久化到 `localStorage: emobox.settings`，并同步到 Tauri 原生窗口。

## 环境要求

- Windows 10 或 Windows 11
- Microsoft Visual Studio C++ Build Tools
- Microsoft Edge WebView2 Runtime
- Node.js 22 或兼容版本
- Rust stable，目标 `x86_64-pc-windows-msvc`

## 安装与运行

```powershell
npm install
npm run tauri dev
```

## 构建与检查

```powershell
npm run build                                  # tsc --noEmit + vite build
npm run tauri build -- --no-bundle             # 产出 src-tauri/target/release/emobox.exe
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npx vitest run                                 # 前端单测
```

## 发布新版本

发布由 GitHub Actions 自动完成（`.github/workflows/release.yml`）：推送 `v*` 格式的 tag（如 `v0.1.0`）即自动构建并创建 Release。

1. 同步修改三处版本号：`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json`。
2. 在 `CHANGES.md` **顶部**追加 `## vX.Y.Z（YYYY-MM-DD）` 段落（markdown，会作为应用内更新说明与 GitHub Release 正文展示）。
3. 提交后打 tag 并推送：

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. Actions 构建完成后，Release 会附带：NSIS 安装包 `EmoBox_X.Y.Z_x64-setup.exe`、便携版 `EmoBox_X.Y.Z_x64.zip`、更新清单 `latest.json`，以及各产物的 `.sha256` 校验文件。

tag 必须与 `src-tauri/tauri.conf.json` 的 `version` 一致（workflow 会校验），否则构建直接失败。应用内更新会按「镜像源列表 → 官方直连」顺序拉取 `releases/latest/download/latest.json` 与安装包，SHA-256 校验通过后启动安装器。

## 已知限制

- GIF：素材库悬停/搜索浮层选中时播放原始动画；Windows 上复制会把 GIF 文件（CF_HDROP）连同首帧位图、`image/gif` 字节一起放上剪贴板——微信/QQ 等按文件粘贴的应用得到动图，其他应用得到静态首帧；剪贴板收藏在剪贴板含 GIF 原始数据时（Firefox 的 `image/gif` 字节、QQ 复制图片/资源管理器复制的文件路径）保留动画；从 Chrome/Edge 复制的网页动图可开启「联网下载网页 GIF」设置下载原始动图（默认关闭，仅保存静态首帧并提醒）。
- APNG / 动画 WebP：缩略图与复制仍只取静态首帧。
- Fluent UI bundle 会触发 Vite 的 500 kB chunk warning，不影响构建。
- 完整手动验收清单见 `MANUAL_ACCEPTANCE.md`；设计决策与各阶段笔记见 `docs/`。
