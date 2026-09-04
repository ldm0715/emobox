import { makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  ArrowRepeatAll20Regular,
  ArrowRight20Regular,
  ChatMultiple20Regular,
  Folder20Regular,
  FolderOpen20Regular,
  MoviesAndTv20Regular,
  Search20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";
import { useSectionStyles } from "../styles/common";

/* ------------------------------------------------------------------ */
/* 痛点场景：左侧竖排卡片（悬停/点击切换），右侧联动动画示意             */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 400px) minmax(0, 1fr)",
    gap: "24px",
    alignItems: "stretch",
    "@media (max-width: 920px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
    },
  },

  // 左列：竖排痛点卡
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  pointCard: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "14px",
    width: "100%",
    padding: "18px 18px 18px 22px",
    textAlign: "left",
    fontFamily: "inherit",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: tokens.durationFaster,
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
  },
  pointCardActive: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    "&::before": {
      content: '""',
      position: "absolute",
      left: "0",
      top: "14px",
      bottom: "14px",
      width: "3px",
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorBrandStroke1,
    },
  },
  pointIconBox: {
    width: "40px",
    height: "40px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: "background-color, color",
    transitionDuration: tokens.durationFaster,
  },
  pointIconBoxActive: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  pointBody: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  pointTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.3",
  },
  pointTitleActive: {
    color: tokens.colorNeutralForeground1,
  },
  pointText: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground3,
  },
  pointNo: {
    marginLeft: "auto",
    flexShrink: 0,
    alignSelf: "flex-start",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground4,
  },

  // 右侧：联动展示面板
  panel: {
    position: "sticky",
    top: "76px",
    minHeight: "460px",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    overflow: "hidden",
    "@media (max-width: 920px)": {
      position: "static",
      order: -1,
      minHeight: "380px",
    },
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  panelLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  panelBadge: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusSmall,
    padding: "2px 8px",
  },
  panelTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  demoStage: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 24px",
  },
  demoFade: {
    width: "100%",
    display: "flex",
    justifyContent: "center",
    animationName: {
      from: { opacity: "0", transform: "translateY(10px)" },
      to: { opacity: "1", transform: "translateY(0)" },
    },
    animationDuration: tokens.durationGentle,
    animationTimingFunction: tokens.curveEasyEase,
  },

  /* ---- 通用动画 ---- */
  float: {
    animationName: {
      from: { transform: "translateY(0)" },
      to: { transform: "translateY(-8px)" },
    },
    animationDuration: "2.4s",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
    animationTimingFunction: "ease-in-out",
  },
  bounce: {
    animationName: {
      "0%": { transform: "translateY(0) scale(1, 1)" },
      "30%": { transform: "translateY(-16px) scale(0.96, 1.04)" },
      "55%": { transform: "translateY(0) scale(1.04, 0.94)" },
      "75%": { transform: "translateY(0) scale(1, 1)" },
      "100%": { transform: "translateY(0) scale(1, 1)" },
    },
    animationDuration: "1.2s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-out",
  },
  scan: {
    animationName: {
      from: { transform: "translateX(-26px)" },
      to: { transform: "translateX(26px)" },
    },
    animationDuration: "2.8s",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
    animationTimingFunction: "ease-in-out",
  },
  stackBreath: {
    animationName: {
      from: { transform: "rotate(-2deg) scale(1)" },
      to: { transform: "rotate(-2deg) scale(1.05)" },
    },
    animationDuration: "2s",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
    animationTimingFunction: "ease-in-out",
  },

  /* ---- Demo 1：表情散落各处 ---- */
  scatterWrap: {
    position: "relative",
    display: "flex",
    gap: "16px",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  appCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    width: "132px",
    padding: "18px 12px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  appCardName: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  appCardEmojis: {
    display: "flex",
    gap: "6px",
    fontSize: "26px",
    lineHeight: "1",
  },
  scatterFloat: {
    position: "absolute",
    fontSize: "22px",
    opacity: "0.55",
    pointerEvents: "none",
  },

  /* ---- Demo 2：翻聊天记录找不到 ---- */
  chatScrollFrame: {
    position: "relative",
    width: "300px",
    height: "250px",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  chatScrollTrack: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px",
    animationName: {
      from: { transform: "translateY(0)" },
      to: { transform: "translateY(-50%)" },
    },
    animationDuration: "7s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  chatBubble: {
    alignSelf: "flex-start",
    maxWidth: "190px",
    padding: "6px 10px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chatScan: {
    position: "absolute",
    top: "50%",
    left: "50%",
    margin: "-26px 0 0 -26px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "52px",
    height: "52px",
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusCircular,
    boxShadow: tokens.shadow8,
  },
  chatSearchRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "16px",
    padding: "8px 12px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },

  /* ---- Demo 3：GIF 变静帧 ---- */
  gifCompare: {
    display: "flex",
    alignItems: "center",
    gap: "18px",
  },
  gifCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    width: "168px",
    padding: "18px 12px 14px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  gifFrame: {
    position: "relative",
    width: "96px",
    height: "96px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "52px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  gifCardName: {
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground2,
  },
  gifCardLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  gifFrozen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    position: "absolute",
    right: "4px",
    bottom: "4px",
    padding: "1px 6px",
    fontSize: "10px",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralForeground3,
    borderRadius: tokens.borderRadiusSmall,
  },
  gifArrow: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },

  /* ---- Demo 4：重复堆积 ---- */
  dupWrap: {
    display: "flex",
    alignItems: "center",
    gap: "28px",
  },
  dupStack: {
    position: "relative",
    width: "150px",
    height: "150px",
    flexShrink: 0,
  },
  dupCard: {
    position: "absolute",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
  },
  dupEmoji: {
    fontSize: "40px",
    lineHeight: "1",
  },
  dupName: {
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
  },
  dupList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  dupListRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground2,
  },
  dupDot: {
    width: "6px",
    height: "6px",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorPaletteYellowForeground1,
  },
  dupNote: {
    marginTop: "10px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

/* ------------------------------------------------------------------ */
/* Demo 场景组件                                                        */
/* ------------------------------------------------------------------ */

// 场景 1：同一个表情，三个 App 各存一份
function ScatterDemo() {
  const styles = useStyles();
  const apps = [
    { name: "微信", icon: <ChatMultiple20Regular />, emojis: ["😂", "🤣"] },
    { name: "QQ", icon: <ChatMultiple20Regular />, emojis: ["😂", "😭"] },
    { name: "下载文件夹", icon: <Folder20Regular />, emojis: ["😂", "🎉"] },
  ];
  const drifts = [
    { emoji: "😂", top: "6%", left: "4%", delay: "0s" },
    { emoji: "🎉", top: "12%", right: "5%", delay: "0.7s" },
    { emoji: "😭", bottom: "8%", left: "8%", delay: "1.3s" },
    { emoji: "🤣", bottom: "4%", right: "10%", delay: "1.9s" },
  ];
  return (
    <div className={styles.scatterWrap}>
      {drifts.map((drift) => (
        <span
          key={drift.emoji + drift.top}
          className={mergeClasses(styles.scatterFloat, styles.float)}
          style={{
            top: drift.top,
            left: drift.left,
            right: drift.right,
            bottom: drift.bottom,
            animationDelay: drift.delay,
          }}
          aria-hidden
        >
          {drift.emoji}
        </span>
      ))}
      {apps.map((app, index) => (
        <div
          key={app.name}
          className={mergeClasses(styles.appCard, styles.float)}
          style={{ animationDelay: `${index * 0.6}s` }}
        >
          <span className={styles.appCardName}>
            {app.icon}
            {app.name}
          </span>
          <span className={styles.appCardEmojis}>
            {app.emojis.map((emoji) => (
              <span key={emoji} role="img" aria-label={emoji}>
                {emoji}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// 场景 2：聊天记录刷屏，翻不到那张图
function ChatScrollDemo() {
  const styles = useStyles();
  const lines = [
    "今晚谁去吃烧烤 🍢",
    "[图片]",
    "哈哈哈笑死 😂",
    "[图片]",
    "[图片]",
    "那只猫敲键盘的呢",
    "[图片]",
    "谁发过猫猫动图来着",
    "[图片]",
    "[图片]",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className={styles.chatScrollFrame}>
        <div className={styles.chatScrollTrack} aria-hidden>
          {[...lines, ...lines].map((line, index) => (
            <span key={`${line}-${index}`} className={styles.chatBubble}>
              {line}
            </span>
          ))}
        </div>
        <div className={mergeClasses(styles.chatScan, styles.scan)}>
          <Search20Regular />
        </div>
      </div>
      <div className={styles.chatSearchRow}>
        <Search20Regular aria-hidden />
        <span>翻了 500+ 条记录，还是没找到</span>
      </div>
    </div>
  );
}

// 场景 3：GIF 粘出去只剩首帧
function GifDemo() {
  const styles = useStyles();
  return (
    <div className={styles.gifCompare}>
      <div className={styles.gifCard}>
        <div className={styles.gifFrame}>
          <span style={{ position: "absolute", top: "4px", left: "4px" }}>
            <span
              style={{
                padding: "1px 5px",
                fontSize: "10px",
                fontWeight: tokens.fontWeightSemibold,
                color: "white",
                backgroundColor: "rgba(24, 24, 27, 0.66)",
                borderRadius: tokens.borderRadiusSmall,
              }}
            >
              GIF
            </span>
          </span>
          <span className={styles.bounce} role="img" aria-label="动图">
            😹
          </span>
        </div>
        <span className={styles.gifCardName}>cat-laugh.gif</span>
        <span className={styles.gifCardLabel}>素材库里 · 完整动画</span>
      </div>
      <ArrowRight20Regular className={styles.gifArrow} aria-hidden />
      <div className={styles.gifCard}>
        <div className={styles.gifFrame}>
          <span style={{ filter: "grayscale(0.4)" }} role="img" aria-label="定格画面">
            😹
          </span>
          <span className={styles.gifFrozen}>静止</span>
        </div>
        <span className={styles.gifCardName}>cat-laugh.gif</span>
        <span className={styles.gifCardLabel}>粘贴后 · 只剩首帧</span>
      </div>
    </div>
  );
}

// 场景 4：同一张图存了五份
function DuplicateDemo() {
  const styles = useStyles();
  const copies = [
    { rotate: "-8deg", x: "-26px", y: "-14px" },
    { rotate: "-4deg", x: "-13px", y: "-7px" },
    { rotate: "0deg", x: "0px", y: "0px" },
    { rotate: "4deg", x: "13px", y: "7px" },
    { rotate: "8deg", x: "26px", y: "14px" },
  ];
  return (
    <div className={styles.dupWrap}>
      <div className={mergeClasses(styles.dupStack, styles.stackBreath)} aria-hidden>
        {copies.map((copy, index) => (
          <div
            key={copy.rotate}
            className={styles.dupCard}
            style={{
              transform: `translate(${copy.x}, ${copy.y}) rotate(${copy.rotate})`,
              zIndex: index + 1,
            }}
          >
            <span className={styles.dupEmoji}>😂</span>
            <span className={styles.dupName}>image({index + 1}).png</span>
          </div>
        ))}
      </div>
      <div>
        <div className={styles.dupList}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={styles.dupListRow}>
              <span className={styles.dupDot} aria-hidden />
              image({n}).png
            </span>
          ))}
        </div>
        <div className={styles.dupNote}>同一张图 · 5 份拷贝，想清理又不敢删</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 痛点数据                                                             */
/* ------------------------------------------------------------------ */

type PainPoint = {
  id: string;
  icon: FluentIcon;
  title: string;
  text: string;
  demo: ReactNode;
};

const PAIN_POINTS: PainPoint[] = [
  {
    id: "scatter",
    icon: FolderOpen20Regular,
    title: "表情散落各处",
    text: "微信存一份、QQ 存一份、下载文件夹里还有一份——想找某张图，先回忆它在哪个 App 里。",
    demo: <ScatterDemo />,
  },
  {
    id: "cantfind",
    icon: ChatMultiple20Regular,
    title: "聊天时找不到那张图",
    text: "只记得「是一只猫在敲键盘」，然后花半小时翻聊天记录和收藏夹。",
    demo: <ChatScrollDemo />,
  },
  {
    id: "gif",
    icon: MoviesAndTv20Regular,
    title: "GIF 粘出去只剩首帧",
    text: "辛辛苦苦攒的动图，粘贴到聊天框里变成一张安静的截图。",
    demo: <GifDemo />,
  },
  {
    id: "dup",
    icon: ArrowRepeatAll20Regular,
    title: "重复素材越堆越多",
    text: "同一张图存了五遍，文件名全是 image(3).png，想清理又不敢下手。",
    demo: <DuplicateDemo />,
  },
];

export function PainPoints() {
  const section = useSectionStyles();
  const styles = useStyles();
  const [activeIndex, setActiveIndex] = useState(0);
  const active = PAIN_POINTS[activeIndex];
  const ActiveIcon = active.icon;

  return (
    <section id="pain-points" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>这些瞬间，你一定很熟悉</h2>
        <p className={section.description}>
          表情包越来越多的同时，也越来越难找。把鼠标移到左边的场景上，看看是不是你。
        </p>
      </div>
      <div className={styles.layout}>
        <div className={styles.list}>
          {PAIN_POINTS.map((point, index) => {
            const Icon = point.icon;
            const isActive = index === activeIndex;
            return (
              <button
                key={point.id}
                type="button"
                className={mergeClasses(styles.pointCard, isActive && styles.pointCardActive)}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
              >
                <span className={mergeClasses(styles.pointIconBox, isActive && styles.pointIconBoxActive)}>
                  <Icon aria-hidden />
                </span>
                <span className={styles.pointBody}>
                  <span className={mergeClasses(styles.pointTitle, isActive && styles.pointTitleActive)}>
                    {point.title}
                  </span>
                  <span className={styles.pointText}>{point.text}</span>
                </span>
                <span className={styles.pointNo}>{String(index + 1).padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>
              <ActiveIcon aria-hidden />
              <span className={styles.panelTitle}>{active.title}</span>
            </span>
            <span className={styles.panelBadge}>
              {String(activeIndex + 1).padStart(2, "0")} / {String(PAIN_POINTS.length).padStart(2, "0")}
            </span>
          </div>
          <div className={styles.demoStage}>
            <div key={active.id} className={styles.demoFade}>
              {active.demo}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
