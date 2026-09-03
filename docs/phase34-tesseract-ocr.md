# Phase 34：Tesseract OCR 引擎（本地第三方，检测 + 引导安装）

## 需求与决策

用户反馈 Windows 本地 OCR 效果有限，机器上有 Tesseract OCR（需要下载安装），
希望：新增一栏引擎选项，检测环境是否装有该组件，没有则引导下载安装。

预期管理（重要）：Tesseract 5 的 chi_sim（LSTM）对表情包这类风格化文字通常
**不如 AI Studio PaddleOCR**，与装好中文语言包的 Windows OCR 大致相当或略差。
「Windows OCR 效果有限」最常见根因其实是没装系统「文字识别」语言包（设置页
Windows 卡片会显示「不可用」）。Tesseract 的定位是补充选项：完全本地离线、
不依赖系统语言包、无额度成本，适合系统语言包装不上（LTSC/精简系统）或不想
走云端的场景。该预期已写进设置页「识别引擎」的 Tooltip 文案。

## 引擎接入（Rust）

- `ocr/tesseract_ocr.rs`（新模块，跨平台不 gate `#[cfg(windows)]`）：
  - **定位**：`resolve_exe` = 设置自定义路径（存在才用，允许填安装目录）→
    `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LocalAppData%\Programs` 下的
    `Tesseract-OCR\tesseract.exe` → 逐目录扫 PATH。不读注册表。
  - **执行**：`run_tesseract` = `std::process::Command` + 轮询 `try_wait`
    （50ms 间隔）超时 kill（30s，无 wait_timeout 依赖）。stdout/stderr 管道
    收集、进程退出后一次读取——单张识别文本远小于管道缓冲区，无死锁风险。
  - **识别**：`recognize_lines(custom_path, png_bytes)` 与另两个引擎同契约
    （PNG 字节进、行文本出、中文 String 错误）：PNG 字节写临时文件
    `%TEMP%/emobox-ocr-{纳秒}.png`（OCR_LOCK 串行保证不撞名，所有路径清理）→
    `tesseract <tmp> stdout -l <langs> --psm 6`。**psm 6**（单一均匀文本块）
    是表情图的有意选择：跳过版面分析（默认 psm 3）在小图上更稳，常量可调。
  - **语言策略**：不提供语言设置项——探测已安装语言（`--list-langs`，输出在
    stderr，与 stdout 合并解析）后按 `chi_sim` > `eng` 优先级求交，
    `chi_sim+eng` 都有则以 `+` 连接，都没有报错引导安装语言包（含 chi_sim
    traineddata 的两条安装路径提示）。表情包场景中文为主、英文兜底，够用且
    少一个设置项。
  - **缓存**：`RESOLUTION_CACHE: Mutex<Option<(custom_path 键, exe, langs)>>`，
    键为自定义路径原值。`probe()`（设置页能力探测）刷新缓存；识别路径优先读
    缓存，省掉每张图一次 `--list-langs` spawn。用户中途装语言包 → 重开设置页
    （触发 probe）即刷新，或改自定义路径（换键必失效）。
  - 探测输出解析（`--version` 取含 tesseract 的首行、`--list-langs` 跳首行）、
    `pick_languages`、`split_lines` 均为纯函数，单测锁定契约；另覆盖自定义
    路径解析（文件/目录两种形态）。
- `ocr/mod.rs`：`OcrEngineKind::Tesseract`（serde `"tesseract"`）；
  `OcrConfig.tesseract_path`（空串 = 自动检测）；`recognize_lines` 分发加分支；
  **引擎级失败与 Windows 同款本地分级**——warn + `Ok(RowOutcome::Failed)` 跳过
  该行，绝不中止整批（`is_cloud_engine` 仍只认 AiStudio）；
  `OcrCapabilities` 加 4 个 tesseract 字段（available/version/languages/path）；
  `capabilities(config)` 改签名收 `&OcrConfig`（Tesseract 探测需要自定义路径）。
- `commands.rs`：`set_ocr_config` 加 `tesseract_path` 参数；
  `get_ocr_capabilities` 加 `State<OcrState>` 先 snapshot 再 `spawn_blocking`
  （IPC 契约不变）。命令总数不变（仍 53 个）。

## 前端改动

- `types.ts` / `lib/tauri.ts` / `ThemeProvider`：`OcrEngineKind` 加
  `"tesseract"`；`OcrCapabilities` 加 4 字段；`PersistedSettings.tesseractPath`
  （默认空串，localStorage 事实源）+ `setTesseractPath`，随既有 `setOcrConfig`
  effect 一并推送 Rust 内存镜像。
- `SettingsMenu.tsx`：引擎下拉第 4 项（排在系统 OCR 之后，两个本地引擎相邻）；
  Tesseract 条件卡片（`settingRowStack` 纵向，仿 AI Studio 卡）：
  - 三态文案：检测中 / 已安装（版本 + 已安装语言；缺 chi_sim 时内联警示）/
    未安装（下载页按钮 + 安装时勾选 Chinese (Simplified) 的提醒）。
  - 「重新检测」按钮 = `setOcrCaps(null)` 复用既有懒检测 effect 重拉（用户装
    完 Tesseract / 语言包后就地刷新，不必重启应用）。
  - 自定义路径输入（`ocrFields`/`ocrInput` 同 AI Studio 先例），placeholder
    注明「留空自动检测」。
  - 下载页 `https://github.com/UB-Mannheim/tesseract/wiki` 在
    `open_external_url` 的 github.com 白名单内，**无需扩白名单**。
- `tagPickerHelpers.buildOcrNotice`：engine 参数改用共享 `OcrEngineKind`；
  tesseract 无文字时附「检查 chi_sim/eng 语言数据」建议（区别于 windows 的
  「切 AI Studio」）；`TagPickerDialog` OCR 卡 caption 对 tesseract 补安装前提。

## 验收

- `cargo fmt/check/clippy -D warnings/test`（225 通过，含新模块 8 个单测）。
- `npm run build` + `npx vitest run`（85 通过，含 buildOcrNotice tesseract 分支）。
- 开发机（2026-09-03）未安装 Tesseract：设置卡片应显示「未安装」+ 下载按钮。
  真机装好后的端到端（检测状态、存量回填、标签弹窗手动识别）待用户复验。
