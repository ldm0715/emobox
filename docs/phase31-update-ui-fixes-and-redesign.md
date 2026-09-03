# Phase 31：设置弹窗关闭修复 + 更新界面修复与重设计（2026-09-03）

Phase 30 落地后真机暴露的一批问题：设置弹窗无法关闭、更新界面整体不可用
（`npm run build` 一直是挂的）、镜像测速三档显示未同步到设置页。本轮全部
修复，并按用户要求重设计更新弹窗、调整默认下载源语义。

## 1. 设置弹窗无法关闭：`<Toaster>` 放进了 `<Dialog>`

### 根因（node_modules 源码实锤）

`SettingsMenu.tsx` 里 `<Toaster>` 被写成了 `<Dialog>` 的**第二个子元素**：

```tsx
<Dialog open={open} onOpenChange={...}>
  <DialogSurface>…整个设置界面…</DialogSurface>
  <Toaster toasterId={toasterId} />   {/* ← 第二个子元素 */}
</Dialog>
```

Fluent v9（@fluentui/react-dialog 9.74.x）`useDialog.js::childrenToTriggerAndContent`
对 children 的解析规则：**正好 2 个子元素时，第 1 个当 trigger、第 2 个当
content**。于是：

- `renderDialog.js` 对 `state.trigger`（整个 DialogSurface 设置界面）**无条件
  渲染**；只有 `state.content`（Toaster）被 `surfaceMotion` 包裹、受 `open`
  控制卸载。
- 结果：设置 surface 从应用启动起就常驻显示；关闭按钮/Esc/遮罩点击都正确
  触发了 `onOpenChange(false)`，但被卸载的只有看不见的 Toaster——弹窗纹丝不动。
- 连带灾害：常驻 surface 拦截全应用点击、层级错乱，用户感知为「更新界面
  完全无法使用、测速失效、无法选镜像源、布局全乱」。

### 修复与不变量

`<Toaster>` 移出 `</Dialog>` 成为兄弟节点（组件 return 包 Fragment）。

**不变量（新增）**：Fluent `Dialog` 的 children 只能是「单个 `<DialogSurface>`」
或「`<DialogTrigger>` + `<DialogSurface>`」对；Toaster / Tooltip 弹层 /
任何兄弟节点一律放 `<Dialog>` **外面**。dev console 出现
`Dialog must contain at least one child <DialogSurface/>…` 警告即说明违反。

## 2. `npm run build` 自 Phase 30 起一直是挂的：Dropdown 属性名写错

`UpdateAvailableDialog` 的下载源 Dropdown 用了不存在的 `onOptionClick`
prop（Fluent Dropdown 的 `(event, data: OptionOnSelectData)` 回调是
**`onOptionSelect`**；`onOptionClick` 是普通鼠标事件签名且不在 DropdownProps
上），tsc TS2322。**改前端必须跑 `npm run build`，vitest 过 ≠ tsc 过**
（vitest 不做全量类型检查）。

## 3. 版本号意外回退 0.1.1 → 0.1.0（用户决定暂不恢复）

`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` 四处版本号
被意外改回 0.1.0（HEAD 是 bump 0.1.1 提交，v0.1.1 已发布）。后果是启动
静默检查会把已发布的 v0.1.1 判成新版本、每次启动弹更新窗。

**用户决定：保持 0.1.0 不恢复**——正好用真实 Release（v0.1.1）端到端测试
更新弹窗全流程（phase30 文档里「要下一个真实 Release 才能端到端回归」的
验证缺口就此补上）。**下次发布前记得把四处版本号 bump 到 0.1.2**。

## 4. 镜像测速三档显示抽共享模块 `src/app/mirrorLatency.tsx`

UpdateAvailableDialog 原本就实现了延迟三档（注释写着「更新弹窗与设置页
镜像面板共用」但设置页从未接入——正是未完成的部分）。本轮抽出：

- `latencyGrade(result)`：`idle`（未测速，灰）/ `good`（<300ms，绿「良好」）/
  `fair`（300–800ms，橙「一般」）/ `slow`（≥800ms 或失败，红「较慢/不可用」）。
- `LatencyTag({ result, busy })`：图标（勾/感叹/叉）+「128 ms · 良好」样式文本；
  `busy` 时渲染 Spinner；**失败原因走原生 `title` 属性**——不用 Fluent
  Tooltip，因为本标签会渲染进 Dropdown 的 listbox Option，弹层组件在
  listbox 内定位不可靠（与网格卡片用原生 title 同一性能/可靠性理由）。
- 四个档位配色样式（`colorPaletteGreen/Marigold/RedForeground1` +
  `colorNeutralForeground3`），SVG 一律 `display:block; flexShrink:0`。

设置页 `MirrorSourcePanel` 的行内状态列（原纯文本「未测速/123 ms/失败」）
改用 `<LatencyTag>`，状态列 `minWidth: 104px` 防行宽跳动。

## 5. 设置页镜像面板修复

- **失败行内可见**：`handleTestOne` 的 invoke 异常改为写入
  `{ ok:false, latencyMs:null, error }`（与更新弹窗同语义），不再只弹 toast、
  行内无痕迹；`MirrorSourceCard` 因此不再需要 `onNotifyError` prop。
- **全部测速逐个落地**：每测完一个立即 `setLatencies`（原来是全测完一次性
  写入，测速期间界面无反馈）；保留测完按延迟升序重排并持久化。
- **摘要行计数 bug**：原来「N 个可用」实际统计的是已测数（含失败）。现在
  区分展示：`3 个镜像 · 可用 2 · 失败 1 · 未测 1 · 最快 245 ms`（无测速时
  「未测速」）。
- 删死样式 5 个（statusRow/statusOk/statusError/actionsRow/notesToggle，
  UpdateCard 删除后无人引用）；`formatBytes` 改为 export 供更新弹窗共用
  （消灭逐字重复的第二份实现）。

## 6. 更新弹窗重设计（用户反馈「丑死了」）

`UpdateAvailableDialog` 布局重排为三段式（`useVersionBadgeStyles` 重写，
全部 token、零硬编码色）：

1. **品牌 hero**：`colorBrandBackground2` 品牌色横幅——应用 logo（44px）+
   大号加粗新版本号（`fontSizeBase600` 品牌色）+ 一行元信息
   「当前 v0.1.0 · 安装包 4.7 MB · 2026/9/2」（替代原来的双版本胶囊 +
   图标元信息行；`Badge`/`ArrowDownload16Regular`/`Clock16Regular` 导入随之删除）。
2. **更新说明卡片** `notesCard`：限高 216px + 滚动 + BG2 底 + 描边圆角，
   长更新说明不再把弹窗撑出屏幕；`aboutUpdate.tsx` 的 `releaseNotes` 样式
   去掉 marginTop/paddingTop/borderTop（分隔线内联式 → 卡片内排版）。
3. **下载源分区**：标题行（Globe 图标 + 「下载源」semibold + 右侧「全部测速」）
   → 说明文案（与检查更新同源链路、直连兜底、测速自动选最快）→ **全宽
   Dropdown**（原 220–280px 挤在右侧的小框）。

下载进度段落（`progressRow`/`progressCaption`）与安装确认弹窗不变。

## 7. 默认下载源 = 检查成功命中的源（用户指定）

原默认是 `selectedMirror = null`，下拉显示「默认顺序（官方直连兜底）」——
被用户感知为「默认的下载源是空的」。

- **第一版**：open 快照时 `setSelectedMirror(updateMirrors[0])`——盲选列表
  第一项。
- **修订（用户反馈「默认选中检查有新版本的那个源」）**：后端把检查命中的
  来源报告给前端——`candidate_urls` 重构出带来源的 `candidate_sources`
  （`Vec<(Option<String>, String)>`，`None` = 直连兜底；`candidate_urls`
  保留为只取 URL 的薄包装，下载路径不受影响），`fetch_manifest_via` 成功
  时同时返回命中镜像，`UpdateCheckResult::Available` 新增
  `checked_via: Option<String>`（serde `checkedVia`，直连 = null）。
  前端 open 快照时
  `setSelectedMirror(checkedVia && options.includes(checkedVia) ? checkedVia : updateMirrors[0] ?? null)`
  ——它才是「此刻已被证明可用」的源；列表里找不到（用户刚改过镜像）回退
  首选。契约由 `updater_serde_contract.rs` 锁死。
- 「镜像列表顺序（与检查更新一致）」选项（value="default"）保留：选中即
  回到 `selectedMirror = null` = 整表按序尝试 + Rust 直连兜底。
- 「全部测速」完成后仍自动改选延迟最低的可用源。
- 副作用说明：选中单一镜像时下载只尝试该镜像 + 直连兜底（不再逐个尝试
  其余镜像）；要整表尝试就选「镜像列表顺序」项。

### 修订 2：触发框显示选中文案（用户反馈「选中了但框里是空的」）

Fluent Dropdown 的触发框文案 = `baseState.value || placeholder`，而 `value`
由**已注册 Option** 的 text 推导——listbox 折叠（未聚焦/未展开）时 Option
不挂载、option collection 为空，所以受控 `selectedOptions` 在首次展开下拉
前触发框**永远显示空**。Fluent 的 Selection 契约注释也写明：受控
`selectedOptions` 时 `value` prop MUST also be controlled。

修复：

- `Dropdown` 同时受控 `value={selectedDisplay}`（镜像名 / 官方直连 /
  镜像列表顺序三种文案，与对应 Option 的 text 一致）。
- 顺带把「官方直连」从「镜像列表顺序」哨兵项拆成**独立选项**
  （value=`DIRECT_MIRROR`="github.com/"，选中 = 只走直连）——原实现里直连
  兜底项复用 value="default"，若「全部测速」选中最快的是直连，
  `selectedMirror` 会匹配不到任何 Option。现在检查走直连时默认选
  「官方直连（恒定兜底）」项；测速 best=直连也能正确回显与选中。
- 「镜像列表顺序」哨兵行不参与测速、不显示延迟标签。

## 8. 下载并发保护（前端 + Rust 双层）

- **前端**：`open` 翻 false 且 `downloading` 时自动 `cancelUpdateDownload()`
  ——「稍后」即放弃本次下载，不留在无人看管的界面继续跑。
- **Rust `updater.rs`**：`UpdateState` 增加 `download_in_flight: AtomicBool`，
  `try_begin_download` CAS false→true 成功返回 `DownloadGuard`（Drop 清除
  标志——完成/取消/失败/panic 任何路径都释放槽位）；`download_and_stage`
  顶部占用失败即 `Err("已有更新下载正在进行，请等待其完成或取消。")`。
  关闭弹窗重开、重复点击触发的并发双下载（互相覆盖临时文件与进度事件）
  从根上防住。测试：`download_single_flight_guard_blocks_concurrent_start`。

## 9. 清理

`SettingsMenu.tsx` 删未使用的 `ArrowSync20Regular` 导入、修正注释里过时的
`onOpenUpdateDialog` prop 名；`UpdateAvailableDialog` 删死代码
`mirrorDropdownLabel`。CLAUDE.md/AGENTS.md：「47 个命令」→48、Phase 30
条目改述为「与设置页『检查更新』按钮并存」（UpdateCard 已删）并补充
mirrorLatency / 单飞 / 默认源语义。

## 验证

`cargo fmt --check` / `cargo check` / `cargo clippy -- -D warnings` /
`cargo test`（229 项：226 过 3 ignored）/ `npm run build`（tsc + vite）/
`npx vitest run`（63 过）全绿。真机（dev，v0.1.0）：启动静默检查弹更新窗 →
全部测速三档标签正常（491ms 一般 / 923ms 较慢 / 不可用）→ 选源 → 下载
4.7MB 约 5s 完成 → SHA-256 校验通过弹「安装更新」确认 → 「稍后再说」/
「稍后」正常关闭（未点「立即安装」，避免覆盖开发版）。设置弹窗关闭与
镜像面板交互由用户手动验收（见 MANUAL_ACCEPTANCE.md 新增小节）。
