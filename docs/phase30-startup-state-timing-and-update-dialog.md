# Phase 30：启动时序竞态修复 + 更新提示改弹窗（2026-09-02）

两个问题：应用每次启动报 `state not managed for field 'databaseState'`（手动刷新才恢复）、
新版本提示从右上角 toast 改为弹窗（弹窗内直接下载安装）。

## 1. 启动报错 `state not managed`：窗口先于 setup 创建的竞态

### 根因（tauri 2.11.5 源码实锤）

- `tauri-2.11.5/src/app.rs::setup`：**先**遍历 `config().app.windows` 创建
  tauri.conf.json 里的全部窗口（`WebviewWindowBuilder::from_config(...).build()`），
  **后**执行用户的 `setup` 闭包；整个 `setup()` 在事件循环 `Ready` 事件里同步执行。
- main 窗口配置无 `visible` 字段（默认 `true`），创建后立即开始加载前端。
- 而 `DatabaseState` 原本在 `setup` 闭包里才 `app.manage()`（lib.rs 旧 56 行），
  setup 前段还有建目录、跑 7 个迁移、legacy recent 导入、文件名标签回填循环
  （每批 500 到完）等同步重活。
- 前端 JS 抢在 setup 完成前 invoke `search_emojis`（**同步命令**，派发时立即
  提取 `State<'_, DatabaseState>`，`tauri/src/state.rs:60-69` 查不到即抛
  "state not managed for field …"）→ 每次启动必现两条错误 toast；手动刷新时
  setup 早已完成，所以恢复。

### 修复：state 全部提前到 Builder 链

`Builder::manage` 的状态随 `build()` 进 `StateManager`（app.rs:2259 传给
`AppManager::with_handlers`），**先于任何窗口创建**——这是时序上唯一正确的注册点。

- **`Cargo.toml`**：加 `dirs = "6"`（Cargo.lock 里 tauri 的传递依赖 6.0.0，
  零新增下载）。
- **app_data_dir 复算**：`run()` 顶部 `dirs::data_dir().join("com.emobox.app")`
  （Windows = `%APPDATA%\com.emobox.app`）。tauri 的 `app_data_dir()` 就是
  `dirs::data_dir().join(config.identifier)`（`src/path/desktop.rs:247-251`），
  identifier 从 tauri.conf.json 读死为 `com.emobox.app`。**改 identifier 必须
  同步改 lib.rs 这一处**。
- **`database/mod.rs`**：`initialize_at(&Path)` 私有转 `pub`；删除只被旧路径
  使用的 `initialize(app: &AppHandle)`（避免 dead_code warning）。
- **`recent.rs`**：同理删除 `load(app)`、`load_at(&Path)` 成为唯一构造入口
  （`storage_path` 字段一并设置——`record()` 的持久化依赖它）。
- **`lib.rs::run()`**：Builder 链上依次 `.manage(database_state)` /
  `.manage(recent_state)` / 四个纯内存 state（TargetWindow / SelectionSearch /
  CloseBehavior / Update——`set_selection_search_enabled` 等命令同理可能早到）；
  初始化失败 `.expect(...)` 直接退出（与原 setup 返回 Err 的 panic 行为等价，
  但窗口来不及加载前端，不会出现"窗口开着但命令全挂"）。
- **setup 闭包**只留 tray::setup、文件名标签回填循环、快捷键 reconcile、
  DWM 圆角三件套。回填期间前端可正常读库（WAL + busy_timeout 5s 兜底并发）。
- **重复 manage 会 panic**：`app.manage` 与 `Builder::manage` 是同一个
  StateManager（`assert!("state for type ... is already being managed")`），
  提前上链后 setup 里的旧 `app.manage(...)` 必须删干净（本次共删 6 处）。

### 验证

`cargo check` / `cargo fmt --check` / `cargo clippy -- -D warnings` /
`cargo test`（191 个，188 过 3 ignored）全过；dev 真机启动：前端命令启动即成功
（日志 list_indexed 无报错）、网格直接出数据、无错误 toast。

**不变量（新增）**：所有 Tauri state 必须在 Builder 链上 manage；setup 闭包里
禁止再出现 `app.manage(...)`。需要 AppHandle 的初始化一律改成 `_at(&Path)` 形态。

## 2. 新版本提示改为弹窗（弹窗内直接下载安装）

原体验：启动 3s 后静默检查，发现新版本弹右上角 info toast（7s 自动消失，
指向 设置→关于），显示效果差、转化路径长。

### `src/app/UpdateAvailableDialog.tsx`（新组件）

- 常挂载 + `open` 控制（勿改回条件挂载——截断 Dialog 内置退场动画）；
  App 传 `result: UpdateCheckResult | null`，`open` 变 true 时**快照进本地
  state**（CloseActionDialog 范式，防退场期间闪空）。
- 内容：标题「发现新版本 vX」+ 当前版本/大小行 + 更新说明 markdown
  （react-markdown + remarkGfm，复用 `aboutUpdate.tsx` 导出的 `useStyles` 里的
  `releaseNotes` 排版——该样式对象已 export，两处渲染保持一致）。
- 内置完整流程：未下载 =「稍后」/「下载并安装」；下载中 = 进度条
  （`UPDATE_DOWNLOAD_PROGRESS_EVENT` 监听）+「取消下载」；完成 = 弹内嵌
  「安装更新」确认（同 UpdateCard 的 ConfirmInstallDialog 文案，`installPendingUpdate`
  成功路径应用退出）。
- `modalType="alert"`；与设置页 UpdateCard 并存不冲突（Rust 侧 pending 单例，
  同一时间只有一处下载）。「稍后」只关弹窗不改 `autoCheckUpdates`，本次会话
  不再重弹（启动检查只跑一次）。

### `src/App.tsx`

- 新增 `updateAvailable: UpdateCheckResult | null` state；启动检查 effect 的
  dispatchToast 分支改为 `setUpdateAvailable(result)`（deps 相应去掉
  `dispatchToast`）；挂载点在 CloseActionDialog 旁。

### 更新检查与弹窗的验证边界

真实「有新版本 → 弹窗 → 下载 → 安装」全链路需要下一个真实 Release（v0.1.2+）
才能端到端回归；本地已验证：启动检查正常走通（当前 v0.1.1 为最新，upToDate
不弹窗）、组件类型与渲染经 build/vitest 通过。

## 3. 后续修订（Phase 31，2026-09-03）

第 2 节两处描述已过时，以 `docs/phase31-update-ui-fixes-and-redesign.md` 为准：

- 「与设置页 UpdateCard 并存」——UpdateCard 已整体删除，设置页现在是
  「自动检查更新」开关 + 「检查更新」按钮 + 镜像源卡；发现新版本统一由
  UpdateAvailableDialog 弹窗承载。
- 上节「验证边界」已由版本号保持 0.1.0（用户决定，见 Phase 31 第 3 节）+
  真实 v0.1.1 Release 补上端到端验证：弹窗 → 测速/选源 → 下载 → SHA-256 →
  安装确认全流程真机走通。
- 弹窗已重设计（品牌 hero + 限高更新说明卡片 + 下载源分区全宽下拉），
  默认下载源 = 检查更新所用镜像列表的首选源；下载并发由 Rust 单飞 guard +
  前端关弹窗自动取消双层保护。
