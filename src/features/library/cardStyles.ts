import { shorthands, tokens, type GriffelStyle } from "@fluentui/react-components";

// 表情卡片的公共样式片段，EmojiGridItem（主网格）与 QuickSearchContent（浮层结果格）共用。
// 两处卡片只有这两段完全一致（透明描边 reset、选中态品牌描边环）；其余视觉
// 差异（圆角、光标、焦点环、frame 内边距）是各自刻意的设计，不强并。

/** 透明描边 reset：默认无边框但占位，选中/悬停时只换 border-color 不抖动布局。 */
export const cardBorderResetStyle: GriffelStyle = shorthands.border(
  tokens.strokeWidthThin,
  "solid",
  "transparent",
);

/** 选中态：品牌描边 + 同色外扩光环。 */
export const cardSelectedRingStyle: GriffelStyle = {
  ...shorthands.borderColor(tokens.colorBrandStroke1),
  boxShadow: `0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
};
