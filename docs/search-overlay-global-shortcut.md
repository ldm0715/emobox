# 搜索浮层与全局快捷键实现说明

> 完成日期：2026-08-24
> 范围：搜索浮层、全局快捷键和快捷键设置
> 不包含：系统托盘、剪贴板复制、自动粘贴、自动发送

## 1. 实现目标

本次修改将主窗口内部的快捷搜索预览升级为独立 Tauri 浮层窗口，并接入可自定义的 Windows 全局快捷键。

已完成：

- 全局快捷键唤出或隐藏浮层；
- 设置页修改、录制和持久化快捷键；
- 唤出时自动清空查询并聚焦搜索框；
- 按文件名实时过滤；
- 鼠标、方向键、Enter 和 Esc 交互；
- 主窗口侧栏和设置按钮打开同一浮层；
- 快捷键注册失败时显示明确提示；
- 保持剪贴板、托盘和自动粘贴能力未实现。

## 2. 默认快捷键

默认值集中定义在：

```text
src/config/shortcuts.ts
```

当前默认值为 `Ctrl+Alt+Space`。

没有使用 `Alt+Space`，因为它与 Windows 系统窗口菜单冲突。设置页输入该组合时会显示警告；系统拒绝注册时会显示具体错误。

## 3. 窗口架构

### 主窗口 `main`

负责目录导入、图片展示、索引状态、设置入口和错误 Toast。

### 快捷搜索窗口 `quick-search`

配置位于 `src-tauri/tauri.conf.json`：

- 默认隐藏；
- 固定尺寸 `680 x 500`；
- 无边框；
- 始终置顶；
- 不显示在任务栏；
- 不允许调整大小；
- 显示时重新居中并聚焦。

Rust 会拦截该窗口的关闭事件并改为隐藏，避免窗口被销毁后无法再次唤出。

## 4. 全局快捷键

后端实现位于：

```text
src-tauri/src/quick_search.rs
```

新增依赖：

```toml
tauri-plugin-global-shortcut = "2"
```

注册流程：

1. 前端从 `localStorage: emobox.settings` 读取快捷键；
2. 主窗口调用 `update_quick_search_shortcut`；
3. Rust 校验组合键必须包含修饰键；
4. 插件注册全局快捷键；
5. 按键触发时切换浮层显隐；
6. 显示后发送 `quick-search-opened` 事件。

修改快捷键时先注册新值，再注销旧值。新值注册失败时旧快捷键继续有效；旧值注销失败时回滚新值。

## 5. 跨窗口索引

新增 Rust 共享状态 `LibraryIndexState`。目录扫描完成后，`scan_directory` 将图片元数据保存到当前进程的共享状态。

浮层每次显示时调用 `get_indexed_images`。该实现不会复制、移动、重命名或删除用户原始图片。索引当前只在进程内保存，退出应用后清空。

## 6. 前端窗口入口

`src/main.tsx` 根据 Tauri 窗口标签选择根组件：

```text
main         -> App
quick-search -> QuickSearchWindow
```

两个窗口复用同一套 Vite 构建产物、Fluent UI 主题和 Tauri command 边界。

## 7. 搜索与选择

主要文件：

```text
src/features/search/QuickSearchWindow.tsx
src/features/search/QuickSearchPanel.tsx
src/features/search/QuickSearchContent.tsx
src/features/search/useSearchKeyboard.ts
```

### 文件名过滤

- 查询和文件名使用小写标准化；
- 执行大小写不敏感的包含匹配；
- 最多显示 30 个结果；
- 当前不搜索标签或 OCR 内容。

### 鼠标和键盘

- 鼠标移入结果时更新选中状态；
- 单击确认并隐藏浮层；
- 左右方向键逐项移动；
- 上下方向键按网格行移动；
- `Enter` 确认当前项并隐藏；
- `Esc` 隐藏浮层；
- 选中项超出可视区域时自动滚动；
- 当前不会执行剪贴板复制。

## 8. 自动聚焦和重置

每次收到 `quick-search-opened` 事件后，浮层会：

1. 重新读取图片索引；
2. 读取当前已注册快捷键；
3. 清空上次查询；
4. 重置选择到第一项；
5. 在下一动画帧聚焦输入框。

通过全局快捷键、侧栏按钮或设置按钮打开时行为一致。

## 9. 快捷键设置

编辑组件位于：

```text
src/features/search/ShortcutEditor.tsx
```

支持直接输入或录制组合键。注册成功后保存到 `emobox.settings`，不同 WebView 通过 `storage` 事件同步设置。

## 10. 错误处理

快捷键注册失败可能来自 Windows 保留组合键、其他应用占用、格式无法解析或没有修饰键。

提示位置：

- 主窗口错误 Toast；
- 设置页错误 MessageBar；
- 侧栏快捷键 Tooltip。

窗口显示、隐藏、居中、聚焦或事件发送失败时，Rust command 返回中文错误信息。

## 11. 主要文件变更

### 新增

```text
src/config/shortcuts.ts
src/features/search/QuickSearchWindow.tsx
src/features/search/ShortcutEditor.tsx
src-tauri/src/quick_search.rs
docs/search-overlay-global-shortcut.md
```

### 重点修改

```text
src/App.tsx
src/main.tsx
src/types.ts
src/lib/tauri.ts
src/app/LibrarySidebar.tsx
src/app/SettingsMenu.tsx
src/components/ThemeProvider.tsx
src/features/search/QuickSearchPanel.tsx
src/features/search/QuickSearchContent.tsx
src-tauri/src/commands.rs
src-tauri/src/lib.rs
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
README.md
MANUAL_ACCEPTANCE.md
```

## 12. 自动检查

已执行：

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

结果：

- TypeScript 和 Vite 构建通过；
- Rust fmt、check 和 clippy 通过；
- Rust 单元测试 6 项通过；
- Vite 仍有 bundle 超过 500 kB 的警告，不影响构建。

## 13. 手工验收重点

1. 导入包含多张图片的文件夹；
2. 切换到其他应用并按 `Ctrl+Alt+Space`；
3. 确认浮层出现且搜索框自动聚焦；
4. 输入文件名并验证大小写不敏感过滤；
5. 测试鼠标、方向键、Enter 和 Esc；
6. 在设置中修改快捷键并验证新旧组合；
7. 测试已占用快捷键的错误提示；
8. 重启后确认快捷键仍然保存。

## 14. 明确未实现

本次没有实现：

- 系统托盘；
- 图片剪贴板复制；
- 从剪贴板收藏；
- 自动切换聊天窗口；
- 自动粘贴；
- 自动发送；
- 最近使用持久化；
- 图片索引磁盘持久化。

当前鼠标单击或 Enter 只确认选中并隐藏浮层，不会产生剪贴板或聊天软件操作。
