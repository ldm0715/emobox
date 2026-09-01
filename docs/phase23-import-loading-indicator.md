# Phase 23：导入加载条四入口拉齐（剪贴板收藏接入 + 600ms 最短可见）

> 实施完成。用户反馈：拖动导入和从剪贴板收藏没有加载条，只有「导入图片 / 导入文件夹」有，感知不到正在导入。排查结论：加载条由 `useLibraryImport` 的 `isImporting` 驱动，四个入口里**唯独 `collectFromClipboard` 不设置该状态**（真缺口）；拖放其实与「导入图片」共用 `importPaths`、一直有加载条，只是短导入几百毫秒结束、进度条一闪而过感知不到（感知缺口）。修法两头都堵：`collectFromClipboard` 补上 loading 托管 + 所有入口的加载条增加 **600ms 最短可见时长**。纯前端改动（`src/features/import/useLibraryImport.ts` + 新测试文件），不涉及 Rust。

---

## 一、现状盘点（改动前四入口对比）

加载条本体在 `EmojiLibraryView.tsx` 状态行（`LibraryHeader` 之下、内容区之上）：indeterminate `<ProgressBar />` + 「正在导入表情…」标签，由 App 从 `useLibraryImport` 解构出的 `isImporting` 经 `importing` prop 传入。同一 state 还被 `AppToolbar` / `EmptyLibraryState` 消费，用于禁用「导入」菜单与空状态按钮。

| 入口 | 调用链 | 改动前的加载条 |
|---|---|---|
| 导入图片 | `importImages` → 原生选框 → `importPaths` | 有（选框关闭后 `setIsImporting(true)`） |
| 导入文件夹 | `importFolder` → 原生选框 → `importFolder` 命令 | 有（选框打开期间不显示，行为不变） |
| 拖放 | `onDragDropEvent` → `handleDroppedPaths` → **同一 `importPaths`** | **有**（代码上一直接了；用户感知不到是因为太快） |
| 剪贴板收藏 | `clipboard-collect-requested` 事件 / 菜单 → `collectFromClipboard` | **无**——唯一不碰 loading 状态的入口，只有结束后的 toast |

## 二、改动（`src/features/import/useLibraryImport.ts`）

- `isImporting` 改由 hook 内的 `beginImport()` / `endImport()` 托管，不再由各动作直接 `setIsImporting`：
  - `activeImportsRef` **并发计数**：多个导入动作可能重叠（快捷键收藏无互斥），计数归零才安排熄灭——防止先结束者把仍在进行中的导入的加载条提前藏掉；
  - `endImport` 归零后 `setTimeout` 延迟 **600ms**（模块常量 `IMPORT_INDICATOR_MIN_VISIBLE_MS`）再 `setIsImporting(false)`：拖几张图 / 收藏单张这类短导入不再一闪而过；长导入只是熄灭晚 600ms，完成 toast 照常即时弹出；
  - 卸载 effect 清理未触发的熄灭定时器；`beginImport` 会先清掉残留定时器（新导入接住余晖，避免「显示中却计数已归零」的窗口）。
- `importFolder` / `importPaths`：换用 begin/end，行为不变。
- **`collectFromClipboard`：补 `beginImport()` + `try/finally endImport()`**——剪贴板命令返回 outcome 枚举而非 `Result`，`finally` 保证 `empty` / `duplicate` / `failed` / `unavailable` 全部分支都熄灭加载条。

### 新测试 `useLibraryImport.test.ts`（第 6 个 JS 测试文件）

沿用 `useQuickSearchQuery.test.tsx` 的模式（`vi.mock("../../lib/tauri")` + `@testing-library/react` 的 `renderHook`）+ fake timers，锁定四件事：

1. `collectFromClipboard` 命令在途 → `isImporting` 为 true；resolve 后**保持 true 满 600ms 才熄灭**（锁定最短可见时长）；
2. `importPaths` 同样的生命周期；
3. 命令 rejected → 经 `finally` 熄灭、错误交给 `onError`（即 App 的 `notifyError`）；
4. 并发两次收藏 → 第一个结束加载条不灭，最后一个结束才开始计时。

## 三、连带行为（均为期望，与其他入口一致）

- 剪贴板收藏进行中，`AppToolbar` 的「导入」菜单与空状态按钮被禁用（`importing` 早已传给它们，此前只是恒为 false）。
- `App.tsx` 拖放守卫 `if (!isImporting)` 现在也覆盖剪贴板收藏期间（含结束后 600ms 余晖），期间新 drop 被忽略——此前 drop 只在其他导入进行中被忽略。
- 连按两次 `Ctrl+Alt+S` 仍会并发两次收藏（现状未改）：Rust 端 `IMPORT_LOCK` 串行化，第二次得到 Duplicate toast；前端计数托管保证加载条不会被先结束者提前藏掉。

## 四、验证

- `npx vitest run`：6 个测试文件 41 用例全过（含新增 4）。
- `npm run build`（tsc --noEmit + vite）通过。
- 无 Rust 改动，`cargo check` / `clippy` / `test` 不受影响。
- 手动（真机）：在某分组视图按 `Ctrl+Alt+S` 收藏一张图 → header 下方出现「正在导入表情…」进度条且肉眼可感知（≥600ms）；从资源管理器拖 2-3 张图进主窗口 → 同样可见。已补进 `MANUAL_ACCEPTANCE.md`「导入和表情网格」小节。
