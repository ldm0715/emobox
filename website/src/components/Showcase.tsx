import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ClipboardPaste20Regular,
  Keyboard20Regular,
  Search20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { QuickSearchMockup } from "./QuickSearchMockup";
import { useSectionStyles } from "../styles/common";

/* ------------------------------------------------------------------ */
/* 界面区：左侧“三步怎么用” + 右侧可交互演示（分栏对照）                   */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 340px) minmax(0, 1fr)",
    gap: "44px",
    alignItems: "center",
    "@media (max-width: 1000px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: "28px",
      alignItems: "stretch",
    },
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    "@media (max-width: 1000px)": {
      order: 1,
    },
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    width: "100%",
    padding: "16px",
    textAlign: "left",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  stepIcon: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "40px",
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
    "& svg": {
      width: "20px",
      height: "20px",
    },
  },
  stepBody: {
    minWidth: 0,
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  stepTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  stepText: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground2,
  },
  demo: {
    minWidth: 0,
    "@media (max-width: 1000px)": {
      order: 2,
    },
  },
});

type Step = { icon: FluentIcon; title: string; text: string };

const STEPS: Step[] = [
  {
    icon: Keyboard20Regular,
    title: "Ctrl+Alt+Space 唤起",
    text: "在微信 / QQ / 飞书等任意窗口里按下快捷键，浮层直接出现在当前窗口上方。",
  },
  {
    icon: Search20Regular,
    title: "键盘流选择",
    text: "输入关键词，↑↓ 移动、Enter 复制——全程不用碰鼠标。",
  },
  {
    icon: ClipboardPaste20Regular,
    title: "可选自动粘贴",
    text: "复制后自动粘贴回唤起前的聊天窗口；只负责粘贴，不会替你发送消息。",
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
          搜一张表情再发出去，全程不用切换窗口，也不用中断聊天。
        </p>
      </div>
      <div className={styles.layout}>
        <div className={styles.steps}>
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className={styles.step}>
                <span className={styles.stepIcon}>
                  <Icon aria-hidden />
                </span>
                <div className={styles.stepBody}>
                  <span className={styles.stepTitle}>{step.title}</span>
                  <span className={styles.stepText}>{step.text}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.demo}>
          <QuickSearchMockup />
        </div>
      </div>
    </section>
  );
}
