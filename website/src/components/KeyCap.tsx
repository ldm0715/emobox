import { makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

const useStyles = makeStyles({
  keyCap: {
    display: "inline-block",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusSmall),
    ...shorthands.padding("1px", "6px"),
    whiteSpace: "nowrap",
  },
});

/** 键帽：模拟应用 footer 里的快捷键按键样式（等宽 + 描边小方块）。 */
export function KeyCap({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <kbd className={styles.keyCap}>{children}</kbd>;
}
