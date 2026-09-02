# 系统托盘、关闭隐藏与最近使用持久化

本文档记录 EmoBox 第四阶段的实际实现：系统托盘、主窗口关闭隐藏、托盘真正退出、最近使用 JSON 持久化，以及快捷搜索空查询时的最近使用优先排序。

## 1. 范围与结论

本阶段完成以下行为：

1. 点击主窗口关闭按钮时只隐藏窗口，不结束应用进程；
2. 系统托盘菜单包含“打开主窗口”“打开搜索浮层”“退出”；
3. 只有托盘“退出”会真正结束应用；
4. 每次成功复制图片后记录原始路径、最后使用时间和累计使用次数；
5. 最近使用记录保存在本地 JSON，应用重启后继续存在；
6. 快捷搜索在空查询时优先显示最近使用，再补充当前内存索引；
7. 未引入云端、账号、网络同步或 SQLite；
8. 不复制、移动、重命名或删除用户原图。

本阶段没有改变 `scan_directory`、`load_thumbnail` 和图片剪贴板的既有命令语义。当前目录扫描索引仍保存在运行内存中，最近使用则保存图片元数据快照，因此重启后即使尚未重新导入目录，也能展示并再次复制仍然存在的最近图片。

## 2. 相关文件

### Rust 后端

| 文件 | 职责 |
|---|---|
| `src-tauri/src/tray.rs` | 创建托盘菜单，恢复主窗口，打开搜索浮层，处理真正退出 |
| `src-tauri/src/recent.rs` | 最近使用记录模型、加载、排序、计数和 JSON 写入 |
| `src-tauri/src/commands.rs` | 复制成功后更新记录，向前端返回最近记录 |
| `src-tauri/src/lib.rs` | 初始化状态和托盘，拦截主窗口与浮层关闭事件 |
| `src-tauri/src/scanner.rs` | 为 `IndexedImage` 增加反序列化和相等比较能力 |
| `src-tauri/Cargo.toml` | 启用 Tauri `tray-icon` feature |

### React 前端

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 定义 `RecentImageRecord` 和复制事件字段 |
| `src/lib/tauri.ts` | 更新 `getRecentImages` 返回类型 |
| `src/App.tsx` | 加载持久化记录并更新主窗口“最近使用”视图 |
| `src/features/search/QuickSearchWindow.tsx` | 同时加载当前索引和持久化最近记录 |
| `src/features/search/QuickSearchPanel.tsx` | 向搜索内容传递最近记录 |
| `src/features/search/QuickSearchContent.tsx` | 合并、去重并按最近使用优先展示 |
| `src/features/library/EmojiLibraryView.tsx` | 更新最近使用空状态说明 |
| `src/app/SettingsMenu.tsx` | 如实展示关闭到托盘和已实现能力 |

### 文档

- `README.md`：更新当前能力、数据位置、限制和托盘说明；
- `MANUAL_ACCEPTANCE.md`：增加完整手工验收步骤；
- `docs/system-tray-recent-usage.md`：本阶段技术说明。

## 3. 窗口生命周期

### 3.1 主窗口关闭

`src-tauri/src/lib.rs` 监听所有窗口的 `CloseRequested`：

- `main`：调用 `api.prevent_close()`，随后隐藏窗口；
- `quick-search`：调用 `api.prevent_close()`，随后隐藏浮层；
- 其他窗口：不做额外处理。

因此标题栏关闭按钮不会销毁 WebView，也不会结束后台进程。隐藏期间托盘菜单和全局快捷键继续工作。

### 3.2 恢复主窗口

托盘“打开主窗口”执行：

1. 查找标签为 `main` 的 WebViewWindow；
2. 调用 `unminimize()`；
3. 调用 `show()`；
4. 调用 `set_focus()`。

### 3.3 打开搜索浮层

托盘“打开搜索浮层”复用 `quick_search::show_quick_search`：

1. 将浮层居中；
2. 显示并聚焦窗口；
3. 发出 `quick-search-opened` 事件；
4. 前端清空旧查询并重新加载索引与最近记录。

### 3.4 真正退出

托盘“退出”直接调用：

```rust
app.exit(0)
```

该流程不是关闭主窗口，因此不会再次进入“关闭隐藏”逻辑。退出后窗口、托盘、全局快捷键和进程全部结束。

## 4. 托盘菜单

> **Phase 26 重写**：托盘菜单已从原生 Win32 菜单换成自绘 Fluent 菜单窗口（`tray-menu`），本节描述现状；历史三菜单行为保留在下方表中。详见 `docs/phase26-tray-menu-window.md`。

托盘交互（Phase 26 现状）：

- **左键单击**：打开主窗口（恢复、显示、聚焦）；
- **右键单击**：在托盘图标上方弹出自绘 Fluent 菜单窗口（跟随应用深/浅主题、带图标、36px 行高、圆角），失焦/Esc/点击菜单项后关闭。

菜单项（`TrayMenuAction`，Rust 统一先隐藏菜单窗口再执行动作）：

| 动作 ID | 显示文字 | 行为 |
|---|---|---|
| `open-main` | 打开主窗口 | 恢复、显示并聚焦主窗口 |
| `open-search` | 打开搜索浮层 | 先藏菜单 + 50ms 等焦点归还，再显示快捷搜索窗口（防粘贴目标抓到菜单自己） |
| `open-settings` | 设置 | 显示主窗口 + `settings-open-requested` 事件让前端打开设置弹窗 |
| `exit`（分隔线后） | 退出 | 以退出码 0 结束应用 |

托盘图标使用 Tauri 默认窗口图标，Tooltip 为“表情匣 EmoBox”。Phase 4 时的原生三菜单（无「设置」项、无图标、系统样式）已被上表整体替代。

## 5. 最近使用数据模型

Rust 和 TypeScript 共享以下逻辑结构：

```json
{
  "item": {
    "name": "hello.png",
    "path": "C:\\emoji\\hello.png",
    "extension": "png",
    "width": 256,
    "height": 256,
    "sizeBytes": 12345
  },
  "lastUsedAt": 1787587200000,
  "useCount": 3
}
```

字段含义：

| 字段 | 含义 |
|---|---|
| `item.path` | 用户原始图片绝对路径 |
| `item.*` | 最近使用时保存的索引元数据快照 |
| `lastUsedAt` | Unix epoch 毫秒时间戳 |
| `useCount` | 成功复制次数，首次为 1，之后饱和递增 |

记录规则：

- 成功写入 Windows 图片剪贴板后才更新最近使用；
- 相同路径只保留一条记录；
- 再次使用会增加 `useCount`、更新时间并移动到列表首位；
- 按 `lastUsedAt` 从新到旧读取；
- 最多保留 50 条。

## 6. 持久化位置

设置继续保存在：

```text
localStorage: emobox.settings
```

最近使用保存在 Tauri 应用数据目录：

```text
recent-images.json
```

Windows 默认完整路径：

```text
%APPDATA%\com.emobox.app\recent-images.json
```

可以使用以下命令检查：

```powershell
notepad "$env:APPDATA\com.emobox.app\recent-images.json"
```

文件不存在时按空记录启动。文件无法读取或 JSON 无效时记录警告并按空记录继续启动，不阻断主窗口和快捷搜索。

## 7. 复制与记录流程

`copy_image_to_clipboard` 的流程为：

1. 先从当前内存索引按路径查找图片；
2. 如果当前索引不存在，再从持久化最近记录查找元数据；
3. 使用原始路径读取图片并写入 Windows 图片剪贴板；
4. 成功后更新最近使用 JSON；
5. 向主窗口发送 `image-copied` 事件；
6. 主窗口更新最近使用列表并显示 Toast。

如果原文件已不存在、无法读取或无法解码，剪贴板命令返回可读错误，不会伪造成功记录。

如果剪贴板已成功写入但最近记录无法保存，命令会返回“图片已复制，但最近使用记录无法保存”类错误，避免把持久化失败伪装成完整成功。

## 8. 快捷搜索排序

浮层激活时并行读取：

```text
get_indexed_images
get_recent_images
```

前端使用路径作为唯一键：

1. 先插入最近使用记录，保持后端的最后使用时间顺序；
2. 再插入当前索引中未出现的图片；
3. 空查询直接截取前 30 条；
4. 有查询时在合并结果中按文件名进行大小写不敏感过滤。

因此空查询能够稳定保证“最近使用优先”，同时保留对当前目录中其他图片的搜索能力。

## 9. 自动检查

本阶段执行并通过：

```powershell
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
```

Rust 单元测试覆盖：

- 重复使用去重并移动到首位；
- `useCount` 累计；
- 50 条上限；
- 路径、时间和次数 JSON 序列化往返。

Release EXE 可以通过以下命令生成：

```powershell
npm run tauri build -- --no-bundle
```

输出位置：

```text
src-tauri\target\release\emobox.exe
```

`dist/`、`src-tauri/target/` 和 EXE 构建产物不提交到 Git。

## 10. 手工验收

### 10.1 准备

1. 启动应用；
2. 准备唯一命名的 `alpha.png`、`beta.jpg`、`gamma.webp`；
3. 打开任务管理器观察 `emobox.exe`；
4. 展开 Windows 通知区域。

### 10.2 关闭隐藏

1. 点击主窗口关闭按钮；
2. 确认主窗口消失；
3. 确认 `emobox.exe` 仍在运行；
4. 确认托盘图标仍存在；
5. 按 `Ctrl + Alt + Space`；
6. 确认搜索浮层仍能打开；
7. 按 Esc 隐藏浮层。

### 10.3 托盘菜单

1. 打开托盘菜单；
2. 确认三个菜单项文字正确；
3. 使用“打开主窗口”恢复主窗口；
4. 再次隐藏主窗口；
5. 使用“打开搜索浮层”打开浮层并确认输入框聚焦。

### 10.4 路径、时间和次数

1. 导入测试目录；
2. 复制 `alpha.png`；
3. 复制 `beta.jpg`；
4. 再复制 `alpha.png`；
5. 打开 `recent-images.json`；
6. 确认 `alpha.png` 只有一条、排第一且 `useCount` 为 2；
7. 确认 `beta.jpg` 的 `useCount` 为 1；
8. 确认两条记录都有路径和时间戳；
9. 确认应用数据目录没有原图副本。

### 10.5 空查询排序

1. 打开搜索浮层并保持输入为空；
2. 确认 `alpha.png`、`beta.jpg` 排在未使用图片之前；
3. 输入 `gamma`，确认能找到 `gamma.webp`；
4. 清空查询，确认恢复最近使用优先顺序。

### 10.6 重启持久化

1. 使用托盘“退出”；
2. 确认 `emobox.exe` 结束；
3. 重新启动应用，不重新导入目录；
4. 确认主窗口“最近使用”仍显示原记录；
5. 确认空搜索仍优先显示最近记录；
6. 再次复制 `alpha.png`；
7. 确认 `useCount` 增加且 `lastUsedAt` 更新。

### 10.7 真正退出

1. 关闭主窗口使其隐藏；
2. 从托盘选择“退出”；
3. 确认所有窗口和托盘图标消失；
4. 确认 `emobox.exe` 不再存在；
5. 再按全局快捷键，确认浮层不会出现。

### 10.8 异常与边界

- 仅对专用测试副本临时改名或移出测试目录，再尝试复制；
- 应显示可读错误且应用不崩溃；
- 测试后恢复测试副本；
- 确认没有账号、云同步、网络上传或 SQLite；
- 确认没有复制、移动、重命名或删除用户原图。

## 11. 已知限制

- 当前扫描索引仍只存在于运行内存；
- 收藏仍只在当前会话有效；
- 最近使用依赖原始路径，源文件移动或删除后无法继续复制；
- 缩略图没有磁盘缓存；
- GIF 缩略图和剪贴板复制均只保留首帧；
- Fluent UI bundle 仍会产生 Vite 500 kB chunk warning，但不影响构建成功。
