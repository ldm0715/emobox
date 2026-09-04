# Phase 37：安装版（NSIS）全局快捷键失效，dev 正常 —— 启动 `reconcile` 抹掉前端抢跑注册

> 结论先行：这不是「注册失败」，而是**注册成功后又被启动清理掉**的时序竞态，且注册表
> 内存态仍报 `Synced`，制造出「界面显示已注册、按键却无响应」的假注册。
>
> 链路：打包版前端从本地磁盘加载快 → React 挂载后立刻调 `update_*_shortcut` 命令把
> 热键真正 `RegisterHotKey` 到 OS → 随后 setup 末尾的 `ShortcutRegistry::reconcile`
> 执行 `unregister_all()`，把这批**刚注册**的热键全部抹掉 → 内存 `current`/`Synced`
> 状态没被清 → 前端报「已注册」。
>
> dev 为什么不炸：dev 前端走 `http://localhost:1420` dev server + React StrictMode，
> 加载慢，等它注册时 setup 早跑完了——注册落在 `reconcile` 之后，不被清。
>
> 修复 = **删除启动时的 `unregister_all`（`reconcile`）**。Windows `RegisterHotKey` 的
> 注册归进程所有、进程退出即自动释放，新进程本就没有「上次残留」可清；并发其他实例
> 的热键又清不掉（进程级隔离）。所以启动期 `unregister_all` 只可能是无害空操作或
> 破坏性的——删掉它，「已注册」从此永远真实。

---

## 1. 现象

`npm run tauri dev` 时两个全局快捷键（`Ctrl+Alt+Space` 快捷搜索 / `Ctrl+Alt+S`
剪贴板收藏）都正常；`npm run tauri build -- --bundles nsis` 打包安装后，快捷键
**完全无响应**。设置页快捷键状态却显示「已注册」。

排查三个观测点，先排除干扰项：
- **无旧 EmoBox 进程残留** → 排除 RegisterHotKey 被另一实例占用；
- **默认键也没反应** → 排除「dev 里自定义键未随 localStorage 迁移」；
- **设置页显示「已注册」** → OS 注册「成功」但按键到不了 handler。

## 2. 根因：前端注册被 setup 末尾的 `reconcile` 事后抹掉

### 2.1 注册完全由前端驱动，Rust 启动时不注册任何热键

快捷键的事实源是主窗口 webview 的 `localStorage`（`emobox.settings`）。Rust 侧
`ShortcutRegistry` 只在主窗口前端挂载后、两个 effect 调命令时才真正注册：

- `src/App.tsx:725-754` / `:756-807` → `updateQuickSearchShortcut` /
  `updateClipboardCollectShortcut`；
- `src-tauri/src/shortcut_registry.rs::try_set`（`:132`）→
  `manager.on_shortcut(...)` 真正 `RegisterHotKey`，成功置内存态 `Synced`。

前端 `commands.rs::update_*_shortcut` → `get_*_shortcut_status` 的 `registered`
字段就是读 `ShortcutSyncState`——它只反映**注册表内存态**，从不校验 OS 层真实状态。

### 2.2 Tauri 固定顺序：窗口先建、前端先加载，setup 后跑

`src-tauri/src/lib.rs:49-54` 的 Phase 30 注释已记录既定事实：tauri 的 config 窗口在
用户 `setup` 闭包**之前**创建并开始加载前端，**前端命令确实会抢在 setup 完成前执行**
（当初 state 放 setup 里 manage 就必现 `state not managed`）。状态上 Builder 链后，
前端命令在 setup 期间可以成功跑完（不报错），因此：

1. 窗口创建 → 打包版前端从磁盘加载 `index.html`（无 dev server 往返），几百毫秒内
   React 挂载完；
2. 挂载 effect 调 `update_*_shortcut` → `try_set` → OS 热键**注册成功**，内存态
   `Synced`；
3. setup 里的文件名标签回填（`lib.rs:79-110`，库越大越慢，500/批循环）跑完，随后
   `lib.rs:112-118`（本次已删）调 `reconcile` → `unregister_all()` **把第 2 步刚
   注册的热键全部抹掉**；
4. `reconcile` 只调插件 `unregister_all`，**不清** `RegistryInner.current`/`state`，
   所以状态仍 `Synced` → 前端 `get_*_shortcut_status` 报 `registered: true`。

### 2.3 为什么 dev 不触发

dev 前端走 Vite dev server（`http://localhost:1420`），加载明显更慢，加上 React
StrictMode 双挂载，等它注册时 setup（含 reconcile）早跑完 → 注册落在 reconcile
之后 → 不被清。同一份代码在打包版里因为「前端快、setup 里的回填慢」而必然输掉这
场抢跑——这是速度差，不是随机竞态。

## 3. 修复：删除启动时的 `unregister_all`

`unregister_all` / `reconcile` 是**全仓库唯一**会破坏 OS 注册、且不是 `try_set`
主动换键的调用点（`try_set` 内部「先注册新再注销旧」的 `unregister` 是主动换键，
保留）。删掉它后，只要前端 effect 注册成功，就没有任何启动期操作能再抹掉它。

改动点：
- `src-tauri/src/lib.rs`：删除 setup 闭包里 `reconcile(...)` 调用与注释
  （`unregister_all` 随之不再被调用），原地留注释说明原因，防后人误加回。
- `src-tauri/src/shortcut_registry.rs`：删除 `reconcile` 方法（原 `:119-128`），
  更新模块 doc 的状态机说明与「为何不在启动时 unregister_all」的说明。

未做的（有意取舍）：
- **不加「setup 完成」ready 屏障 / 重注册事件**：改动最少且语义正确即可，避免引入
  「命令是否在 setup 期间于主线程执行」这类线程模型依赖。
- **不改 localStorage 存储位置**：dev 与安装版 origin 不同导致设置不互通是独立问题
  （见 §6），不在此修。

## 4. 为什么删掉启动 `unregister_all` 是安全的

Windows `RegisterHotKey` 的注册**归进程所有，进程退出即自动释放**：

- 一个刚启动的新进程**不可能**有「上一次运行残留的 OS 级热键」——上个进程已死，
  OS 已自动清理（macOS 的全局快捷键同此语义）；
- 若真有一个**并发的其他实例**占着热键，当前进程的 `unregister_all()` 也**清不掉
  对方**（注册是进程级隔离的）；
- 因此启动期 `unregister_all` 只可能是 a) 无害空操作（前端尚未注册），或 b)
  破坏性的——抹掉前端抢跑刚注册的键。

D5 reconcile 的原始意图（清「上次崩溃残留」）在 RegisterHotKey 语义下不成立，
删除无功能损失；`get_*_shortcut_status` 在首次注册前如实返回 `registered: false`
（`Unknown`），比之前「空转也报 Synced」更诚实。

## 5. 验收清单（手动）

- 重新 `npm run tauri build -- --bundles nsis` → 安装 → **冷启动、不开任何设置页**，
  直接在其它前台窗口按 `Ctrl+Alt+Space` → 快捷搜索浮层出现；任意处按 `Ctrl+Alt+S`
  → 剪贴板收藏触发。（旧 bug 必须重启复现，重点验证首次启动即可用。）
- 设置页快捷键状态仍显示「已注册」，与真实 OS 行为一致。
- 回归 `npm run tauri dev`：两键在 dev 下仍正常。
- 重复启动 / 退出安装版 2–3 次无回归。

自动化：`cargo fmt --check` + `cargo check` + `cargo clippy -- -D warnings` +
`cargo test` 全绿（244 passed，0 failed；本次只删 Rust 代码，不涉及前端 / vitest）。
改动仅 Rust + 文档。

## 6. 关联但独立的问题（未修）

**dev 与安装版 localStorage origin 不同**：dev 是 `http://localhost:1420`，安装版是
tauri 自定义协议——localStorage 按 origin 隔离，`emobox.settings` 不互通。在 dev 里
配过的主题 / 自定义快捷键 / 关闭行为 / OCR 引擎与凭据 / 镜像源列表 / 自动检查更新，
安装版首次启动都是默认值（此后各自持久化各自的）。这是「dev 配置没带到安装版」的
原因，一次性重配即可；如需共享需把设置迁出 localStorage，另立方案。
