import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

/** 每个 section 的公共容器与标题样式（居中标题 + 副标题）。 */
export const useSectionStyles = makeStyles({
  section: {
    maxWidth: "1120px",
    marginLeft: "auto",
    marginRight: "auto",
    paddingLeft: "24px",
    paddingRight: "24px",
    paddingTop: "72px",
    scrollMarginTop: "76px",
  },
  header: {
    textAlign: "center",
    marginBottom: "40px",
  },
  title: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: "0",
    lineHeight: "1.25",
  },
  description: {
    marginTop: "12px",
    marginBottom: "0",
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.6",
  },
});

/** 内容卡片基础样式：与应用一致的 1px 浅边框 + 大圆角。 */
export const useCardStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.padding("24px"),
  },
});
