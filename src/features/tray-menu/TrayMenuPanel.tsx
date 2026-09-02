import { Divider, makeStyles, tokens } from "@fluentui/react-components";
import {
  Home20Regular,
  Power20Regular,
  Search20Regular,
  Settings20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import type { TrayMenuAction } from "../../types";

interface TrayMenuPanelProps {
  onAction: (action: TrayMenuAction) => void;
}

interface MenuItemSpec {
  action: TrayMenuAction;
  label: string;
  icon: FluentIcon;
}

const TOP_ITEMS: MenuItemSpec[] = [
  { action: "open-main", label: "打开主窗口", icon: Home20Regular },
  { action: "open-search", label: "打开搜索浮层", icon: Search20Regular },
  { action: "open-settings", label: "设置", icon: Settings20Regular },
];

const useStyles = makeStyles({
  // 透明窗口里 surface 只占内容实际高度（height auto），窗口底部剩余区域
  // 保持透明 —— 即使字体度量有出入也不会出现色块死区。
  root: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  // Surface 阶梯与快捷搜索浮层一致：BG1 + 1px 描边 + XLarge 圆角，无投影
  // （tauri.conf.json 已关 shadow，CSS 投影没有衬垫空间可画）。
  surface: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    padding: tokens.spacingVerticalXS,
    overflow: "hidden",
  },
  item: {
    width: "100%",
    height: "36px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalS}`,
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    fontFamily: tokens.fontFamilyBase,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
    ":active": {
      backgroundColor: tokens.colorSubtleBackgroundPressed,
    },
  },
  itemIcon: {
    flexShrink: 0,
    fontSize: "20px",
    color: tokens.colorNeutralForeground2,
  },
  // flex column 里的 Fluent Divider 默认 flex-grow:1 会平分剩余高度
  // （Phase 14 坑），且自带 8px 上下 margin，菜单里手动收紧。
  divider: {
    flexGrow: 0,
    flexShrink: 0,
    margin: `${tokens.spacingVerticalXS} 0`,
  },
});

export function TrayMenuPanel({ onAction }: TrayMenuPanelProps) {
  const styles = useStyles();

  const renderItem = (spec: MenuItemSpec) => {
    const Icon = spec.icon;
    return (
      <button
        key={spec.action}
        type="button"
        role="menuitem"
        className={styles.item}
        onClick={() => onAction(spec.action)}
      >
        <Icon className={styles.itemIcon} />
        <span>{spec.label}</span>
      </button>
    );
  };

  return (
    <div className={styles.root}>
      {/* key 重挂载由 TrayMenuWindow 负责（activationId），appear 播入场动画；
          child 必须是 DOM 元素（presence 组件约束）。 */}
      <FadeSnappy visible appear>
        <section className={styles.surface} role="menu" aria-label="托盘菜单">
          {TOP_ITEMS.map(renderItem)}
          <Divider className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => onAction("exit")}
          >
            <Power20Regular className={styles.itemIcon} />
            <span>退出</span>
          </button>
        </section>
      </FadeSnappy>
    </div>
  );
}
