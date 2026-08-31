# Phase 14：侧栏分组区被 Fluent Divider 挤占的修复（Divider 默认 `flex-grow: 1`）

> 实施完成。一行样式修复：用户报告侧栏「我的分组」区只能显示 3 个分组、各区块之间出现大片空白。根因是 `@fluentui/react-divider@9.7.4` 的 root 默认样式自带 **`flex-grow: 1`**——侧栏 flex column 里的 3 个 `<Divider>` 与分组列表（`flex: 1`）平分剩余高度，分组列表只拿到约 1/4 空间。修法：`LibrarySidebar.tsx` 的 `divider` 样式显式 `flexGrow: 0` + `flexShrink: 0`。纯前端样式改动，不涉及 Rust。

---

## 一、症状

用户视角（截图 + 实机窗口均一致）：

- 「收藏」和「我的分组」之间有约 110px 的空白带，空白带正中悬着一根细分隔线；
- 「我的分组」列表只有约 3 行高（右侧出现滚动条），下方又是大空白；
- 「未分组/回收站」上方、「回收站」和快捷键之间同样有大空白带 + 居中的细线；
- 唯独「快捷键」和「设置」之间间距正常。

这与 Phase 13 拍板的最终布局（「其余区块固定紧凑贴边、空白只允许出现在分组列表内部」）完全不符——**Phase 13 的设计自合入起就没有真正渲染出来过**。

## 二、排查路径（为什么绕了弯）

按怀疑度从高到低逐项排除：

| 假设 | 排除证据 |
|---|---|
| 用户跑的是旧构建（release exe 是 8/25 的旧产物） | 进程链核实：`npm run tauri dev` → `tauri.js dev` → `vite` → `emobox.exe`（debug），WebView 实际加载 `http://localhost:1420`，即 Vite 实时供应的磁盘代码 |
| Vite 供应的代码与磁盘不一致（陈旧模块 / 第二份检出） | `curl http://localhost:1420/src/app/LibrarySidebar.tsx` 与磁盘文件逐字一致；转换产物内嵌的 `_jsxFileName` 指向本检出路径；全机只有一个 vite 实例（端口 1420 归属 PID 核对无误） |
| `height: 100%` 高度链断裂导致 flex 失效 | `global.css` 中 `html, body, #root` 均 `height: 100%`；`AppShell` grid `54px + minmax(0,1fr)` 完整 |
| 静态推演与实机渲染矛盾（代码上不可能出现这种布局） | computer-use 截图 + 局部放大实机窗口：**分隔线的细线恰好居中于空白带**——这是「元素本身被撑高、画线行垂直居中」的特征，指向 Divider 元素自身 |

最后一条把视线引向 Fluent Divider 的默认样式，读 `node_modules` 后定案。

## 三、根因

`@fluentui/react-divider@9.7.4` 的 `useDividerStyles` 无条件应用于每个 Divider root 的生成 CSS（摘自 `node_modules/@fluentui/react-divider/lib/components/Divider/useDividerStyles.styles.js`）：

```css
.f22iagw { display: flex; }
.f1063pyq { flex-direction: row; }
.f122n59 { align-items: center; }
.fqerorx { flex-grow: 1; }   /* ← 元凶 */
.f10pi13n { position: relative; }
```

失效机制：

1. 侧栏 `styles.root` 是 flex column，高度撑满窗口；
2. 子元素中可伸展项有 4 个：分隔线 ×3（Fluent 默认 `flex-grow: 1`，`flex-basis` 默认 auto 但容器有富余）+ 分组列表（`flex: 1`）；
3. 约 380px 剩余高度被四者平分，每个分隔线被撑到约 95px；
4. Divider root 被拉高后，其 `align-items: center` 使真正画线的伪元素行**垂直居中于空壳**——视觉上就是「细线悬在大片空白正中」；
5. 分组列表只分到约 1/4 空间 → 只能显示 3 个分组。

「快捷键」与「设置」之间的第 4 个 Divider 位于 `styles.bottom`（内容自然高度）内部，容器没有富余空间可分配，所以那一处间距始终正常——这解释了症状的不对称性。

Phase 13 手动验收未发现此问题，是因为分组多时列表仍会内部滚动、底部区块依然贴底，撑高的分隔线在视觉上容易被当作正常留白。

## 四、修复

`src/app/LibrarySidebar.tsx` 的 `divider` 样式追加两个属性：

```ts
divider: {
  width: "100%",
  marginTop: tokens.spacingVerticalS,
  marginBottom: tokens.spacingVerticalS,
  // Fluent Divider 默认 flex-grow:1，在 flex column 中会撑高分隔线、挤占分组列表空间
  flexGrow: 0,
  flexShrink: 0,
},
```

要点：

- Griffel 中 Fluent 组件把用户 `className` 放在组件默认样式**之后** `mergeClasses`，用户值胜出，无需 `!important` 类手段；
- 该样式类覆盖侧栏全部 4 处 Divider（顶部导航后、分组列表后、底部导航后、快捷键与设置之间），一处修改全部生效；
- 修复后分组列表成为侧栏唯一弹性区，独占约 380px（720 高窗口实测），空白重新只出现在分组列表内部——恢复 Phase 13 拍板的设计。

## 五、其余 Divider 用法审计

全仓库 `<Divider>` 共 3 处（侧栏之外）：

| 位置 | 结论 |
|---|---|
| `features/library/TagPickerDialog.tsx:237` | 安全。父容器 `content` 是 flex column，但高度由内容自然撑出（对话框只有 `maxHeight` 上限，无固定高度），Divider 的 `flex-grow` 吸收不到任何富余空间 |
| `features/library/MoveToGroupDialog.tsx:221` | 同上，安全 |

判据：**Divider 在 flex column 里，且容器高度可能大于子内容总和（固定高度 / flex 伸展）→ 必须显式 `flexGrow: 0`**；内容自然高度的容器无需处理。

## 六、不变量 / 经验（Phase 14 新增）

- **今后在 flex column 中放 Fluent `<Divider>`，只要容器高度可能高于内容总和，就必须显式 `flexGrow: 0`**（或改用自绘分隔线）。这是组件库的隐藏默认值，不看 `node_modules` 里生成的 CSS 察觉不到。
- 分组列表仍是侧栏唯一 `flex: 1` 弹性/滚动区（承继 Phase 13 不变量）；空白只允许出现在分组列表内部。
- 排查「渲染结果与源码推演不符」类问题的高效顺序：① 先验证运行时代码 = 磁盘代码（Vite dev 下可直接 `curl http://localhost:1420/src/xxx.tsx` 对比，转换产物里的 `_jsxFileName` 能证明服务根目录）；② 再查高度链（`html/body/#root` → grid/flex 容器）；③ 最后读组件库**实际生成的 CSS**（`node_modules` 里按生成的短类名 grep），不要只信对组件库样式的记忆。

## 七、验证

- dev 实例 HMR 热更后实机截图（computer-use）：分隔线恢复细线，三个大空白消失，「我的分组」列表从标题正下方一直延伸到「未分组」上方，全部分组可见，底部区块紧凑贴底 ✅
- `npm run build`（tsc --noEmit + vite）✅
- `npx vitest run`：25 passed（3 个测试文件）✅
- 纯前端样式改动，不涉及 Rust，无需 cargo 套件。
