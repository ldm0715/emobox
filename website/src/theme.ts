import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-components";

// 与应用 src/components/ThemeProvider.tsx 完全一致的品牌 ramp 与主题 override，
// 保证官网观感与桌面应用一致。改主题色时两边同步。
const fontFamily = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

const brand: BrandVariants = {
  10: "#061724",
  20: "#082338",
  30: "#0a2e4a",
  40: "#0a3b5c",
  50: "#0e4775",
  60: "#0f548c",
  70: "#115ea3",
  80: "#0f6cbd",
  90: "#2886de",
  100: "#479ef5",
  110: "#62abf5",
  120: "#77b7f7",
  130: "#96c6fa",
  140: "#b4d6fa",
  150: "#cfe4fa",
  160: "#ebf3fc",
};

export const lightTheme: Theme = {
  ...createLightTheme(brand),
  fontFamilyBase: fontFamily,
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
  colorNeutralStroke2: "#e8e8e8",
  colorSubtleBackgroundSelected: "#e8f1fa",
};

// 暗色 Surface 层级：窗口底(BG2)最暗 → 内容区(BG1) → 卡片(BG3)最亮。
export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  fontFamilyBase: fontFamily,
  fontFamilyMonospace: '"Cascadia Mono", Consolas, monospace',
  colorNeutralBackground2: "#191d26",
  colorNeutralBackground2Hover: "#20242f",
  colorNeutralBackground1: "#222732",
  colorNeutralBackground1Hover: "#2c3240",
  colorNeutralBackground3: "#2a303d",
  colorNeutralBackground3Hover: "#333a49",
  colorNeutralBackground3Pressed: "#242a36",
  colorSubtleBackgroundHover: "#282f3b",
  colorSubtleBackgroundSelected: "#24384f",
  colorSubtleBackgroundPressed: "#1d2532",
  colorNeutralForeground3: "#b3bac6",
  colorNeutralStroke1: "#454c5a",
  colorNeutralStroke1Hover: "#545c6c",
  colorNeutralStroke2: "#333947",
  colorNeutralStroke3: "#333a48",
  colorNeutralStrokeAccessible: "#6d7689",
  colorBrandBackground2: "#1d3a5a",
};
