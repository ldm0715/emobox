import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ClipboardPaste20Regular,
  Keyboard20Regular,
  Search20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { QuickSearchMockup } from "./QuickSearchMockup";
import { useSectionStyles } from "../styles/common";

const useStyles = makeStyles({
  points: {
    marginTop: "40px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
  },
  point: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  pointIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
  pointText: {
    margin: "0",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground2,
  },
  pointTextStrong: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
});

const POINTS: { icon: FluentIcon; strong: string; text: string }[] = [
  {
    icon: Keyboard20Regular,
    strong: "全局快捷键唤起",
    text: "在任何应用里按 Ctrl+Alt+Space，浮层直接出现在当前窗口上方。",
  },
  {
    icon: Search20Regular,
    strong: "键盘流操作",
    text: "输入关键词，↑↓ 选择，Enter 即复制——手不用离开键盘。",
  },
  {
    icon: ClipboardPaste20Regular,
    strong: "可选自动粘贴",
    text: "复制后自动粘贴回唤起浮层前的聊天窗口，只合成 Ctrl+V，绝不发送 Enter。",
  },
];

export function Showcase() {
  const section = useSectionStyles();
  const styles = useStyles();

  return (
    <section id="showcase" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>在任何应用里，一键唤起</h2>
        <p className={section.description}>
          在微信 / QQ / 飞书的输入框里按 Ctrl+Alt+Space，搜索浮层直接出现在手边——不用切换窗口，不用中断聊天。
        </p>
      </div>
      <QuickSearchMockup />
      <div className={styles.points}>
        {POINTS.map((point) => {
          const Icon = point.icon;
          return (
            <div key={point.strong} className={styles.point}>
              <span className={styles.pointIcon}>
                <Icon aria-hidden />
              </span>
              <p className={styles.pointText}>
                <span className={styles.pointTextStrong}>{point.strong}</span>
                {"　"}
                {point.text}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
