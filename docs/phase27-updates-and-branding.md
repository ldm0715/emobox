# Phase 27：自动更新 + 镜像源 + 品牌改造（EmoBox 开源发布）

> 日期：2026-09-02。范围：设置→关于的仓库/协议/检查更新/镜像源，应用 logo 替换，品牌名「表情匣」→「EmoBox」，GPL-3.0 开源化。

## 1. 自动更新为什么自定义实现，不用官方 tauri-plugin-updater

镜像源是 gh-proxy 风格的**前缀代理**（`https://gh-proxy.com/` + 完整 GitHub 文件 URL），这是整个镜像需求的核心。官方 updater 插件按 latest.json 里写死的原始 URL 下载，镜像前缀**改写不了**下载地址；而插件还要求 minisign 签名密钥（`tauri signer generate` + 构建时注入私钥 + 发布 `.sig`），对个人手动发布流程太重。

因此自定义 `src-tauri/src/updater.rs`：

- **清单**：Release 资产里的 `latest.json`（`releases/latest/download/latest.json` 恒指向最新），字段 `version / pubDate / notes / platforms{windows-x86_64:{url,sha256,size}}`（camelCase serde）。
- **完整性**：SHA-256（清单里带，脚本算好）流式边下边算、下完比对，不匹配删临时文件报错——取代 minisign 签名。**信任根是 GitHub Release 本身 + HTTPS**，镜像只代理不篡改（若镜像篡改会校验失败）。
- **下载**：ureq（复用 clipboard_collect 的 `AgentBuilder + timeout + into_reader().take()` 范式），上限 200MB，每 ≥256KB 发一次 `update-download-progress` 事件（emit_to main），`UpdateState` 的 AtomicBool 支持取消；成功后 pending 存临时文件路径，`install_pending_update` spawn 安装器 + `app.exit(0)`。
- **版本比较**：`semver` crate，容忍 `v` 前缀；无法解析时退化为字符串不等。
- **测速**：`test_mirror_speed` 经镜像完整拉取仓库 main 分支 README.md（1MB 截断）计整次耗时。选 raw README 是因为它**不依赖是否已发布 Release**，且各 gh-proxy 系镜像都支持 raw 代理。

## 2. 镜像源语义

- 持久化 `updateMirrors: string[]`（ThemeProvider / `emobox.settings`），默认 `https://gh-proxy.com/`、`https://ghproxy.net/`、`https://ghfast.top/`；可增删、可「恢复默认」。
- 尝试顺序 = 列表顺序，**官方直连永远在末尾兜底**（Rust `candidate_urls` 恒追加、去重；用户误填 github.com 本尊会被识别跳过，避免拼出无效前缀地址）。
- 规范化：trim + 去多余尾斜杠 + 补一个 `/`；必须 URL 可解析且 http(s) 有主机名（前后端同规则，`mirrorSources.ts::normalizeMirror` / Rust `join_mirror`）。
- 「全部测速」串行逐个测（并发会抢带宽影响读数），测完按延迟升序**重排并持久化**——列表顺序即优先级。
- 管理界面是关于页摘要行 + **弹出 Fluent Dialog 面板**（列表行 + 添加 + 全部测速/恢复默认）；测速结果存卡片层 state，面板关掉摘要行仍显示。

## 3. 发布说明链路：CHANGES.md → latest.json → 应用内 markdown

- `CHANGES.md` 是唯一事实源：每版本一段 `## vX.Y.Z（YYYY-MM-DD）`，顶部追加。
- `scripts/make-release-manifest.mjs`：读 tauri.conf.json version → 找 `target/release/bundle/nsis/*-setup.exe` → 算 SHA-256/size → **从 CHANGES.md 提取对应段落**写进 latest.json 的 `notes`（段落缺失告警留空；`--notes-file` 可覆盖）。
- 前端检查到新版本后，「检查更新」卡片出「查看更新内容」chevron，`Collapse`（unmountOnExit）+ `react-markdown` + `remark-gfm` 渲染（**react-markdown 默认不渲染原始 HTML**，镜像劫持也得过 markdown 白名单这一关）。

## 4. 启动检查

`App.tsx` 挂载 3s 后（错开库加载/缩略图请求高峰）静默 `checkForUpdate`；设置读 latest-ref（effect 只跑一次，中途改设置下次启动生效——用户选择的语义是「每次启动都检查」）。失败**静默**（网络不可用不该每次启动弹错），只有 `status === "available"` 才弹 info toast 指向 设置→关于。

## 5. 品牌改造

- logo 事实源 `static/logo.ico`（256×256 32bpp ARGB）→ 提取 `static/logo.png` → `npx tauri icon` 重新生成 `src-tauri/icons/*` 全套（托盘图标走 `default_window_icon()` 自动跟随）；前端显示用 `src/assets/logo.png`（首次引入 vite 静态图片 import）。
- 设置弹窗标题栏改为品牌行：logo + "EmoBox" + 版本胶囊（`Badge tint`）。版本 = `getVersion()` 运行时读 tauri.conf.json 的 version，state 初始 `null`、读到才渲染胶囊（**不写死回退值**）。
- 「表情匣」展示字符串全部改「EmoBox」：tauri.conf.json main 窗口 title、tray tooltip、index.html title、AppToolbar 品牌区、关于页文案。docs/phase*.md 历史文档不改。
- **设置行图标范式（2026-09 二轮整改）**：全部设置行带 Fluent 20px 左端 `rowIcon`（Win11 设置同款，`colorNeutralForeground2` 弱化色）——三列 `settingRow`（图标|文案|控件，`max-width: 640px` 断点下控件 `gridColumn: 2` 落到文案列下方）与两列 `settingRowStack`（图标 + 纵向内容：素材库路径、快捷键卡）；**「当前功能」「开源依赖」是信息清单卡，不带行图标**（用户指定）。图标语义：主题=Color、托盘=ArrowMinimize、启动页=Home、自动粘贴=ClipboardPaste、选中文字=Highlight、网页 GIF=Gif、快速搜索=Search、剪贴板收藏=Image、打开浮层=SearchSquare、素材库=FolderOpen、导入=ArrowUpload、格式=ImageMultiple、仓库行=Link、协议行=Document、自动检查=Alert（铃铛）、检查更新卡=ArrowSync、镜像源=Globe。新加设置行必须带图标。
- **关于页文案收敛（同轮）**：原仓库行的说明文字上移为「关于」PageHeader 副标题；仓库、开源协议两行只留标签不带描述（用户指定「这个选项不要文字」）。协议 chip 用 Fluent `ShieldCheckmark20Regular`——GPL 没有官方品牌标，按用户要求统一走 Fluent 图标。
- `public/favicon.ico`（logo 的 ico 副本）+ index.html `<link rel="icon">`，消除 dev 控制台的 favicon 404。

## 6. 协议：GPL-3.0-only

全部依赖为 MIT/Apache-2.0/BSD/CC0 等宽松协议，GPL-3.0 无兼容问题。采用 SPDX `GPL-3.0-only`（LICENSE 全文 + package.json + Cargo.toml）；关于页有协议 chip 跳 GitHub 上的 LICENSE。注意事项：今后若引入依赖必须检查其协议与 GPL-3.0 兼容。

## 7. 坑与教训

- Rust 原始字符串：测试 JSON 里 `"## 更新内容"` 的 `"##` 会终结 `r##"..."##`——含 markdown 标题的字符串要用 `r###"..."###`。
- `@fluentui/react-components@9.74.6` 的 `Button` **没有 `loading` prop**（later 版本才有）——忙碌态用 `icon={<Spinner size="extra-tiny" />}` + `disabled`。
- `@fluentui/react-icons` 里**没有 `Bell20Regular`**——Fluent 的铃铛是 `Alert20Regular`；图标名是否存在以 tsc 编译为准（import 不存在的导出会 TS2724）。
- **tauri-build 2.6 的 `rerun-if-changed` 不监听 `icons/`**（只声明 tauri.conf.json / capabilities / 资源）：换 `icon.ico` 后 build 脚本不重跑，exe 资源里嵌的旧图标被一直复用——任务栏/标题栏纹丝不动，**重启 dev 也没用**（cargo 认为无变化，不重链接）。已在 `build.rs` 显式声明 `cargo:rerun-if-changed=icons/icon.ico` 修复：换图标即触发 build 脚本重跑（重嵌入 .res）+ 依赖 crate 重编译（`generate_context!` 的 `default_window_icon` 同步重新展开）。窗口/任务栏图标是**编译期**嵌入 exe 的两处副本，改前端资源不等于改应用图标。重启后资源管理器/任务栏偶尔仍显旧图，是 Windows shell 图标缓存（按路径缓存，非应用问题）。
- 下载进度事件按字节量节流（≥256KB）而非每块都发，收尾补发一次保证终值准确。
- `Mutex<Option<PendingUpdate>>` / `AtomicBool` 都没有 Clone——UpdateState 的 Clone 语义（共享状态拷给 spawn_blocking）要用 `Arc<Inner>` 手工实现。
