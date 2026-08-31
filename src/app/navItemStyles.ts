import { tokens, type GriffelStyle } from "@fluentui/react-components";

// 侧栏（LibrarySidebar）与设置对话框左导航（SettingsMenu）共用的导航行范式
// （Phase 19 统一：原生 <button> + Griffel 样式）。两处仅布局差异——列模板、
// 行高、字号——由各自消费方在 navItemBase 之上覆盖；选中态完全共用。
// 修改这里的视觉（悬停/选中/指示条）会同时影响两处导航。

/** 导航行基础样式（悬停 / 焦点环 / reset）。 */
export const navItemBaseStyle: GriffelStyle = {
  position: "relative",
  width: "100%",
  display: "grid",
  alignItems: "center",
  color: tokens.colorNeutralForeground2,
  backgroundColor: "transparent",
  border: "none",
  borderRadius: tokens.borderRadiusMedium,
  cursor: "pointer",
  textAlign: "left",
  ":hover": {
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorSubtleBackgroundHover,
  },
  ":focus-visible": {
    outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
    outlineOffset: "-2px",
  },
};

/** 选中态：浅品牌背景 + 3px 品牌指示条 + 图标染品牌色。 */
export const navItemSelectedStyle: GriffelStyle = {
  color: tokens.colorNeutralForeground1,
  fontWeight: tokens.fontWeightSemibold,
  backgroundColor: tokens.colorSubtleBackgroundSelected,
  "& > svg": {
    color: tokens.colorBrandForeground1,
  },
  "::before": {
    position: "absolute",
    left: 0,
    width: "3px",
    height: "18px",
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandStroke1,
    content: '""',
  },
};
