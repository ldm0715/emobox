# EmoBox 官网（website/）

EmoBox 的静态介绍站点：项目功能、解决痛点、界面原型演示与下载入口。
部署于 GitHub Pages：<https://ldm0715.github.io/emobox/>

## 技术栈

与主应用保持同版本：React 19 + TypeScript + Fluent UI v9（`@fluentui/react-components` 9.74.6、`@fluentui/react-icons` 2.0.338）+ Vite。

> 注意：国内 npmmirror 镜像尚未同步 `@fluentui/react-icons@2.0.338`，安装时请使用官方源：
>
> ```powershell
> npm install --registry=https://registry.npmjs.org/
> ```

## 命令

```powershell
npm install     # 安装依赖（见上方 registry 说明）
npm run dev     # 开发预览（Vite dev server）
npm run build   # tsc --noEmit + vite build → dist/
npm run preview # 本地预览构建产物（http://localhost:4173/emobox/）
```

`vite.config.ts` 的 `base` 固定为 `/emobox/`（GitHub Pages 项目页子路径），本地 preview 也走同样路径。

## 部署

`.github/workflows/pages.yml`：

- **仅当 `website/**`（或 workflow 自身）变更时触发**，push 到 `main` 自动构建并部署到 GitHub Pages。
- 首次启用需要在仓库 **Settings → Pages** 把 Source 设为 **GitHub Actions**（一次性手动操作）。

## 目录结构

```
website/src/
├── theme.ts                  # 品牌 ramp + 暗/亮主题 override（照抄主应用 ThemeProvider.tsx）
├── themeContext.ts           # 网站级主题 Context
├── useSiteTheme.ts           # 浅/深/跟随系统 三态主题（localStorage: emobox-site.theme）
├── useLatestRelease.ts       # 最新版本拉取（GitHub releases/latest API + 本地回退）
├── styles/
│   ├── global.css            # 字体栈、主题底色、::selection
│   └── common.ts             # section 标题、卡片等公共样式
└── components/
    ├── SiteHeader.tsx        # 吸顶导航（锚点 + 主题点击切换 + 下载直链 + GitHub）
    ├── Hero.tsx              # 标语 + 下载入口 + 主窗口原型
    ├── PainPoints.tsx        # 痛点：左竖排卡片悬停联动右侧动画场景
    ├── MainWindowMockup.tsx  # 主窗口可交互原型（1100×720 固定布局 + 等比缩放显示）
    ├── QuickSearchMockup.tsx # 快捷搜索浮层场景演示（唤起 → 选图 → 自动粘贴 → 发送）
    ├── SettingsMockup.tsx    # 设置弹窗原型（在演示窗口内部弹出）
    ├── Showcase.tsx          # 浮层展示区（包裹 QuickSearchMockup）
    ├── Features.tsx          # 九大特性
    ├── Workflow.tsx          # 「素材库到聊天框」三幕场景流程图
    ├── DownloadSection.tsx   # 下载安装（系统检测 + 直链下载 + 校验命令复制）
    ├── SiteFooter.tsx        # 页脚
    └── KeyCap.tsx            # 键帽样式组件
```

## 约定与不变量

### 主题与主应用同步

- `theme.ts` 的品牌 ramp 与暗/亮 override **逐行照抄主应用 `src/components/ThemeProvider.tsx`**（暗色背景阶梯 BG2 `#191d26` → BG1 `#222732` → BG3 `#2a303d`）。改主题色时**两边同步**，否则官网与应用观感脱节。

### 双层主题（互不影响）

- **网站主题**：`SiteHeader` 的太阳/月亮按钮，点击在浅/深间切换（图标显示当前状态），`useSiteTheme` + localStorage 持久化，`index.html` 内联脚本防首屏闪烁。
- **演示窗口局部主题**：`MainWindowMockup` 内部有独立的浅/深/跟随系统状态，包在嵌套 `FluentProvider`（`display: contents`）里——**在原型里切主题只影响演示窗口，不影响网站页面**，与应用「设置页与工具栏按钮是同一份设置」的语义对应。

### 界面原型（mockup）

- 主窗口原型**布局固定 1100×720**（与应用默认窗口一致），通过 `ResizeObserver` + `transform: scale` 按可用宽度等比缩放显示，内部布局永不 reflow 变形。
- 所有交互（复制、收藏、回收站、多选、导入、分组切换、设置弹窗等）都是**本地 state 演示**：不写真实剪贴板、不持久化、不调用后端；操作反馈用窗口内自绘 toast（Fluent `Toaster` 是页面级 portal，会把通知弹到网站右上角，因此 mockup 内不使用）。
- 快捷搜索浮层场景（点输入框唤起 → 选表情自动粘贴 → 发送）消息语境写死，表情进入输入框与消息列表均为循环动画演示。
- 界面细节（尺寸、图标、徽章、布局结构）**对照主应用源码 1:1 复刻**：`AppToolbar` / `LibrarySidebar` / `LibraryHeader` / `EmojiGridItem` / `QuickSearchPanel` / `QuickSearchContent` / `SettingsMenu` / `navItemStyles` / `cardStyles` / `ImportMenu`。改应用 UI 时请检查 mockup 是否需要跟进。

### 最新版本与下载直链

- `useLatestRelease.ts` 请求 GitHub 公开 API（`releases/latest`，有 CORS、无需鉴权）解析版本号与 `x64-setup.exe` / `x64.zip` 资产直链；模块级缓存让页面多处共享同一次请求。
- API 限流/失败时回退到 `FALLBACK_VERSION` 常量拼 `releases/download/` 直链——**发布新版本时同步更新该常量**。
- 顶部导航「下载」与下载区的按钮 `href` 直接指向资产 URL（点击即下载），不跳转 Releases 页面。

## 发布新版本时的检查清单

1. 更新 `website/package.json` 的 `version`
2. 更新 `src/useLatestRelease.ts` 的 `FALLBACK_VERSION`
3. 检查 `src/components/SettingsMockup.tsx` 内写死的版本 Badge 是否需要跟进
