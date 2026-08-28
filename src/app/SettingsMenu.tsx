import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Dropdown,
  Option,
  Switch,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Apps24Regular,
  Dismiss20Regular,
  FolderOpen20Regular,
  Info24Regular,
  Keyboard24Regular,
  SearchSquare20Regular,
  Storage24Regular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useAppSettings, type ThemePreference } from "../components/ThemeProvider";
import { ShortcutEditor } from "../features/search/ShortcutEditor";
import type { DefaultLibraryView, StorageInfo } from "../types";

type SettingsSection = "general" | "shortcuts" | "storage" | "about";

interface SettingsDialogProps {
  open: boolean;
  storageInfo: StorageInfo | null;
  onOpenAssetsDirectory: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviewQuickSearch: () => void;
  shortcutRegistered: boolean;
  shortcutError: string;
  onUpdateQuickSearchShortcut: (shortcut: string) => Promise<string | null>;
  clipboardCollectShortcut: string;
  clipboardCollectRegistered: boolean;
  clipboardCollectError: string;
  onUpdateClipboardCollectShortcut: (shortcut: string) => Promise<string | null>;
}

const themeLabels: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

const viewLabels: Record<DefaultLibraryView, string> = {
  all: "全部表情",
  recent: "最近使用",
  favorites: "收藏",
  trash: "回收站",
  ungrouped: "未分组",
};

const useStyles = makeStyles({
  surface: {
    width: "min(780px, calc(100vw - 48px))",
    maxWidth: "780px",
    height: "min(560px, calc(100vh - 48px))",
    maxHeight: "560px",
  },
  content: {
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "176px minmax(0, 1fr)",
    gap: tokens.spacingHorizontalL,
    overflow: "hidden",
  },
  navigation: {
    minHeight: 0,
    paddingRight: tokens.spacingHorizontalM,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  panel: {
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    paddingRight: tokens.spacingHorizontalS,
  },
  panelTitle: {
    marginTop: 0,
    marginBottom: tokens.spacingVerticalL,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  settingRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
  },
  settingText: {
    minWidth: 0,
  },
  settingLabel: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  settingDescription: {
    marginTop: "3px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  dropdown: {
    minWidth: "160px",
  },
  shortcutRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
  },
  keyGroup: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  key: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  pathBox: {
    marginTop: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalS,
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  formatList: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
  },
  aboutName: {
    margin: 0,
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
  },
  aboutEnglish: {
    marginTop: "2px",
    color: tokens.colorNeutralForeground3,
  },
  paragraph: {
    color: tokens.colorNeutralForeground2,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function SettingsDialog({
  open,
  storageInfo,
  onOpenAssetsDirectory,
  onOpenChange,
  onPreviewQuickSearch,
  shortcutRegistered,
  shortcutError,
  onUpdateQuickSearchShortcut,
  clipboardCollectShortcut,
  clipboardCollectRegistered,
  clipboardCollectError,
  onUpdateClipboardCollectShortcut,
}: SettingsDialogProps) {
  const styles = useStyles();
  const { theme, setTheme, defaultView, setDefaultView, quickSearchShortcut, autoPaste, setAutoPaste } = useAppSettings();
  const [section, setSection] = useState<SettingsSection>("general");

  function renderGeneral() {
    return (
      <>
        <h2 className={styles.panelTitle}>常规</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingLabel}>主题</div>
            <div className={styles.settingDescription}>顶部主题按钮和这里使用同一份设置。</div>
          </div>
          <Dropdown
            className={styles.dropdown}
            value={themeLabels[theme]}
            selectedOptions={[theme]}
            onOptionSelect={(_, data) => data.optionValue && setTheme(data.optionValue as ThemePreference)}
          >
            <Option value="system">跟随系统</Option>
            <Option value="light">浅色</Option>
            <Option value="dark">深色</Option>
          </Dropdown>
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingLabel}>关闭窗口时最小化到系统托盘</div>
            <div className={styles.settingDescription}>主窗口关闭按钮固定隐藏到系统托盘；请通过托盘“退出”结束进程。</div>
          </div>
          <Switch disabled checked aria-label="关闭窗口时最小化到系统托盘" />
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingLabel}>默认启动页面</div>
            <div className={styles.settingDescription}>下次启动时默认打开的资料库视图。</div>
          </div>
          <Dropdown
            className={styles.dropdown}
            value={viewLabels[defaultView]}
            selectedOptions={[defaultView]}
            onOptionSelect={(_, data) => data.optionValue && setDefaultView(data.optionValue as DefaultLibraryView)}
          >
            <Option value="all">全部表情</Option>
            <Option value="recent">最近使用</Option>
            <Option value="favorites">收藏</Option>
          </Dropdown>
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingLabel}>选择表情后自动粘贴到打开浮层前的窗口</div>
            <div className={styles.settingDescription}>
              关闭后只复制到剪贴板；自动粘贴不会发送消息。Windows 专用，目标窗口无法恢复时将自动降级为仅复制。
            </div>
          </div>
          <Switch
            checked={autoPaste}
            onChange={(_, data) => setAutoPaste(data.checked)}
            aria-label="选择表情后自动粘贴到打开浮层前的窗口"
          />
        </div>
      </>
    );
  }

  function renderShortcuts() {
    return (
      <>
        <h2 className={styles.panelTitle}>快捷键</h2>
        <div>
          <div className={styles.settingLabel}>快速搜索</div>
          <div className={styles.settingDescription}>
            在任意应用中唤出或隐藏独立搜索浮层。默认使用 Ctrl + Alt + Space，避免与 Windows 的 Alt + Space 系统菜单冲突。
          </div>
          <div style={{ marginTop: tokens.spacingVerticalM }}>
            <ShortcutEditor
              shortcut={quickSearchShortcut}
              registered={shortcutRegistered}
              registrationError={shortcutError}
              onApply={onUpdateQuickSearchShortcut}
            />
          </div>
        </div>
        <Divider style={{ marginTop: tokens.spacingVerticalL }} />
        <div>
          <div className={styles.settingLabel}>从剪贴板收藏</div>
          <div className={styles.settingDescription}>
            在任意应用中按组合键，把当前剪贴板图片保存到 EmoBox 素材库。仅当应用运行时由用户主动触发，应用不监听剪贴板。
          </div>
          <div style={{ marginTop: tokens.spacingVerticalM }}>
            <ShortcutEditor
              shortcut={clipboardCollectShortcut}
              registered={clipboardCollectRegistered}
              registrationError={clipboardCollectError}
              onApply={onUpdateClipboardCollectShortcut}
              ariaLabel="从剪贴板收藏全局快捷键"
              placeholder="例如 Ctrl+Alt+S"
            />
          </div>
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>打开快捷搜索浮层</div>
            <div className={styles.settingDescription}>通过主窗口按钮打开与全局快捷键相同的独立窗口。</div>
          </div>
          <Button
            icon={<SearchSquare20Regular />}
            onClick={() => {
              onOpenChange(false);
              window.setTimeout(onPreviewQuickSearch, 0);
            }}
          >
            打开浮层
          </Button>
        </div>
      </>
    );
  }

  function renderStorage() {
    const libraryPath = storageInfo?.emojisDirectory ?? "正在读取素材库位置";
    const formats = storageInfo?.supportedFormats ?? ["PNG", "JPG", "JPEG", "GIF", "WebP"];
    return (
      <>
        <h2 className={styles.panelTitle}>存储与导入</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <div className={styles.settingLabel}>EmoBox 素材库</div>
            <div className={styles.settingDescription}>主动导入和拖入的图片会复制到这里。</div>
            <div className={styles.pathBox} title={libraryPath}>{libraryPath}</div>
          </div>
          <Button
            icon={<FolderOpen20Regular />}
            disabled={!storageInfo}
            onClick={onOpenAssetsDirectory}
          >
            在资源管理器中打开
          </Button>
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>导入与索引方式</div>
            <div className={styles.settingDescription}>
              导入图片和拖拽会复制到素材库；导入文件夹只索引外部原路径。
            </div>
          </div>
          <Badge appearance="tint">仅本地处理</Badge>
        </div>
        <Divider />
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>支持格式</div>
            <div className={styles.formatList}>
              {formats.map((format) => <Badge key={format} appearance="outline">{format}</Badge>)}
            </div>
          </div>
        </div>
        <Divider />
        <p className={styles.paragraph}>
          表情匣只处理你主动导入、拖入或主动从剪贴板收藏的图片，不会读取微信、QQ 聊天记录或缓存。
        </p>
      </>
    );
  }
  function renderAbout() {
    return (
      <>
        <h2 className={styles.panelTitle}>关于</h2>
        <h3 className={styles.aboutName}>表情匣</h3>
        <div className={styles.aboutEnglish}>EmoBox  版本 0.1.0</div>
        <p className={styles.paragraph}>表情匣是一款 Windows 优先的本地表情资产管理工具，不需要账号或网络服务。</p>
        <Divider />
        <p className={styles.paragraph}><strong>已实现：</strong>外部文件夹索引、素材库图片导入、拖拽导入、SHA-256 去重、缩略图、搜索、主题、系统托盘、最近使用、快捷搜索和自动粘贴到打开浮层前的窗口（Windows）。</p>
        <p className={styles.paragraph}><strong>尚未实现：</strong>云同步和跨设备同步。</p>
      </>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={<Button appearance="subtle" aria-label="关闭设置" icon={<Dismiss20Regular />} onClick={() => onOpenChange(false)} />}
          >
            设置
          </DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.navigation}>
              <TabList
                vertical
                selectedValue={section}
                onTabSelect={(_, data) => setSection(data.value as SettingsSection)}
              >
                <Tab value="general" icon={<Apps24Regular />}>常规</Tab>
                <Tab value="shortcuts" icon={<Keyboard24Regular />}>快捷键</Tab>
                <Tab value="storage" icon={<Storage24Regular />}>存储与导入</Tab>
                <Tab value="about" icon={<Info24Regular />}>关于</Tab>
              </TabList>
            </div>
            <section className={styles.panel}>
              {section === "general" && renderGeneral()}
              {section === "shortcuts" && renderShortcuts()}
              {section === "storage" && renderStorage()}
              {section === "about" && renderAbout()}
            </section>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
