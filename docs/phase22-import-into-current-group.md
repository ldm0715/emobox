# Phase 22：导入自动加入当前分组

## 需求

用户在主窗口浏览某个分组（`group:N` 视图）时，通过以下四个入口导入的图片**自动加入该分组**：

1. 工具栏「导入图片」（文件选择器）
2. 工具栏「导入文件夹」
3. 拖放文件 / 文件夹到主窗口
4. 剪贴板收藏（全局快捷键 `Ctrl+Alt+S` 或工具栏菜单「从剪贴板收藏」）

配套语义（用户确认）：

- **文件夹导入抑制自动建组**：带目标分组时，文件夹内全部图片（含子文件夹、根目录散图）只归入目标分组，不再为顶层子文件夹/平铺文件夹自动建同名分组（`groups_created` 为空）。
- **停留在分组视图**：导入完成后不再强制切回「全部」，留在当前分组并重拉第 1 页，让新图可见。
- 重复图片（SHA-256 精确 / 感知）不导入也就不入组（维持现状）；toast 的「感知强制导入」重试成功的图同样入组。
- toast 注明「已加入分组「X」」（用发起导入那一刻捕获的分组名）。

## 设计决策

### 目标分组在 Rust 侧同事务落库（而非前端二次调 addEmojisToGroup）

前端在导入成功后拿 `summary.items[].id` 再调 `add_emojis_to_group` 理论可行，但：

1. 文件夹导入「抑制子文件夹建组」无法在前端表达——`import_folder` 的 `ImportGroup::ByName` 推导发生在 Rust 事务内，事后无法撤销；
2. 前端二段式存在窗口期（图片已落库、未归组），浮层 `library-changed` 收到的是中间态；
3. `ImportGroup::Existing(i64)` 机制（`insert_managed` 同一事务写 `emoji_groups`）是现成的，只是没有任何调用方使用。

因此把 `target_group_id: Option<i64>` 贯穿三个命令：

```
前端 targetGroupId
  → import_managed_paths / import_folder / collect_image_from_clipboard（命令层，id<=0 过滤为 None）
  → ImportService::import_paths / import_folder / import_dynamic_image / import_bytes
      ├─ ensure_target_group_exists：批量开始前预检分组存在（缺失 → 整批 Err、零半成品；
      │   不预检的话 insert_managed 的 Existing(id) 会在写关联时以 FK 错误逐张失败）
      └─ import_group_for_target：Some(id) → ImportGroup::Existing(id)，None → 各入口原行为
  → insert_managed 同一事务写 emojis + emoji_groups
```

`clipboard_collect` 四条通道（`"image/gif"` 字节 / CF_HDROP 文件 / 网页 GIF 下载 / RGBA 回退）全部透传 `target_group`（RGBA 路径经 `import_dynamic_image`，其余经 `import_bytes` ← `import_bytes_to_outcome`）。

### 发起时捕获，而非完成时读取

目标分组在 **handler 发起导入前**经 `getCurrentGroupId()` 捕获（读 `currentViewRef`）：

- 拖放 effect 的 deps 是 `[handleDroppedPaths, isImporting, notifyError]`、剪贴板收藏走 `collectFromClipboardRef` latest-ref——两者都不随 `currentView` 变化重注册/重建，若读 state 闭包会过期（App.tsx 闭包陷阱惯例）。
- 导入期间用户切到别的分组：图片仍归入**发起时**的分组（符合直觉），toast 文案用捕获时 id 从 `groups` 查名，不随视图漂移；分组名查不到时回退「已加入当前分组」。
- 全局快捷键收藏（可能发生在别的应用前台）：归属主窗口当前浏览的分组——主窗口视图就是应用的「当前上下文」。

### 停留分组视图与重拉

原 `prepareAfterImport()` 无条件 `setCurrentView("all")`——会把用户踢出分组，功能不可见。新签名 `prepareAfterImport(targetGroupId: number | null)`：

- `targetGroupId !== null` **且** 用户仍停在 `group:<id>` 视图 → 不切视图，`setViewReloadTick(t => t + 1)` 触发视图 effect 重拉第 1 页；
- 其余情况维持原行为（切回「全部」、清搜索、清多选、刷新计数）。

重拉机制：`viewReloadTick` 加入视图 effect deps（`[currentView, debouncedQuery, sortOption, recentItems, groups, tags, viewReloadTick]`）。同视图重拉时 `landingKey`（`view|query|sort`）不变 → 不递增 `viewGeneration` → **不重播入场动画**（keep-previous 语义，Phase 17）；effect 开头 `nextOffsetRef.current = null` 保证分页游标正确重置，`viewSeqRef` 作废在途的 loadMore 响应。若留组时原本有搜索词，`setSearchQuery("")` 会使 debouncedQuery 稍后再触发一次重拉——重复一次请求，可接受。

## 变更清单

**Rust**

- `commands.rs`：`import_managed_paths` / `import_folder` / `collect_image_from_clipboard` 加 `target_group_id: Option<i64>`（`id <= 0` 过滤为 `None` 防御）。
- `services/import_service.rs`：
  - 新增 `import_group_for_target` / `ensure_target_group_exists` 助手；
  - `import_paths` / `import_folder` / `import_dynamic_image` / `import_bytes` 加 `target_group: Option<i64>` 末位参数；
  - `import_folder` 带 target 时每文件 `dir` 推导短路为 `None`、分组固定 `Existing(id)`（不写 `groups_created`、不建组）。
- `clipboard_collect.rs`：入口与 `try_collect_gif_bytes` / `try_collect_file_drop_image` / `attempt_web_gif` / `import_bytes_to_outcome` 透传（非 Windows `#[cfg(not(windows))]` 分支的 `let _ = (...)` 同步补参防 unused）。
- 新增 4 个单测：`import_paths_with_target_group_places_emojis_in_group`、`folder_import_with_target_group_skips_subfolder_grouping`（断言全部入目标组 + `groups` 表计数不变）、`import_paths_with_missing_target_group_fails_cleanly`（零落库）、`clipboard_import_with_target_group_places_emoji_in_group`。

**前端**

- `lib/tauri.ts`：三个包装加末位可选参 `targetGroupId?: number`，invoke 传 `targetGroupId: targetGroupId ?? null`。
- `features/import/useLibraryImport.ts`：`importImages / importPaths / importFolder / collectFromClipboard` 末位透传。
- `App.tsx`：
  - `currentViewRef` 上移到 `currentView` 声明处（原在 toggleFavorite 附近，导入入口在它之前定义会 TDZ）；
  - `getCurrentGroupId()` 稳定 useCallback；`viewReloadTick` state；视图 effect deps 增补；
  - 四 handler 发起时捕获 → 传参 → `prepareAfterImport(targetGroupId)`；
  - `showManagedImportResult(summary, note?, targetGroupId?)`，「强制导入」重试透传；
  - `groupNameForToast` + 文件夹导入 toast 注明。

## 明确不做

- 重复图片自动入组（等于「指派分组」语义，已有 MoveToGroupDialog / 批量操作覆盖）。
- `ungrouped` / `favorites` / `recent` / `trash` 视图的导入停留行为（维持切回「全部」）。
- 拖放单文件到分组视图的「移动」语义（EmoBox 导入恒为受管复制）。
