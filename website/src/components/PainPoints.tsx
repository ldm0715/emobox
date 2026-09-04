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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useCardStyles, useSectionStyles } from "../styles/common";
import { ALL_STICKERS, COW_STICKERS, FISH_STICKERS } from "../mockStickers";
import { StickerImage } from "./StickerImage";

// 聊天记录里「[图片]」占位随机替换成的贴纸池（每次刷新重洗一次）
const CHAT_STICKERS = ALL_STICKERS.slice().sort(() => Math.random() - 0.5);

/* ------------------------------------------------------------------ */
/* 痛点场景：左侧竖排卡片（悬停/点击切换），右侧联动动画示意             */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 400px) minmax(0, 1fr)",
    gap: "24px",
    alignItems: "stretch",
    "@media (max-width: 1000px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
    },
  },

  // 左列：竖排痛点卡（纵向均布，让底边与右栏演示对齐）
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    justifyContent: "space-between",
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
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: "background-color, color",
    transitionDuration: tokens.durationFaster,
  },
  pointIconBoxActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
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
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    "@media (max-width: 1000px)": {
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
  // 定宽是硬约束：FitToWidth 靠「固定自然宽度」算缩放比，流式宽度在窄容器里只会换行重排
  // （三张卡竖堆、scale 恒为 1），不会按预期缩小。566 = 178×3 + 16×2。
  scatterWrap: {
    position: "relative",
    display: "flex",
    gap: "16px",
    justifyContent: "center",
    flexWrap: "wrap",
    width: "566px",
  },
  appCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    width: "178px",
    padding: "20px 14px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  appCardName: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  appBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusCircular,
    color: "#ffffff",
    "& svg": {
      width: "14px",
      height: "14px",
      display: "block",
    },
  },
  appSticker: {
    display: "block",
    width: "150px",
    height: "150px",
    objectFit: "contain",
  },
  gifImg: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    padding: "4px",
    boxSizing: "border-box",
  },

  /* ---- Demo 2：翻聊天记录找不到 ---- */
  chatScrollFrame: {
    position: "relative",
    width: "460px",
    height: "300px",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  chatScrollTrack: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
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
  chatBubbleImg: {
    alignSelf: "flex-start",
    display: "flex",
    padding: "3px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  chatImg: {
    display: "block",
    width: "86px",
    height: "86px",
    objectFit: "contain",
  },
  chatScan: {
    position: "absolute",
    top: "50%",
    left: "50%",
    margin: "-36px 0 0 -36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "72px",
    height: "72px",
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
    gap: "26px",
  },
  gifCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    width: "256px",
    padding: "22px 16px 18px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  gifFrame: {
    position: "relative",
    width: "172px",
    height: "172px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "52px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  gifFrameMuted: {
    backgroundColor: tokens.colorNeutralBackground3,
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
    color: "#ffffff",
    backgroundColor: "rgba(219, 68, 55, 0.92)",
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
    gap: "48px",
  },
  dupStack: {
    position: "relative",
    width: "300px",
    height: "300px",
    flexShrink: 0,
    cursor: "default",
  },
  dupImg: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "205px",
    height: "205px",
    objectFit: "contain",
    transitionProperty: "transform",
    transitionDuration: tokens.durationFast,
    transitionTimingFunction: tokens.curveEasyEase,
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
  hint: {
    marginTop: "22px",
    textAlign: "center",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground4,
  },

  // 桌面双栏布局：窄屏隐藏
  wideOnly: {
    "@media (max-width: 1000px)": {
      display: "none",
    },
  },

  // 移动端横向滑动轮播：宽屏隐藏
  mobile: {
    display: "none",
    "@media (max-width: 1000px)": {
      display: "block",
    },
  },
  mobileViewport: {
    display: "flex",
    // 高度跟随当前激活 slide（组件内动态设置），避免被最高的 slide 撑高；
    // 不加 height 过渡——过渡在标签页被节流时时间线冻结，高度会卡在过渡起点。
    alignItems: "flex-start",
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: "x mandatory",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    "&::-webkit-scrollbar": {
      display: "none",
    },
  },
  mobileSlide: {
    flex: "0 0 100%",
    minWidth: "100%",
    scrollSnapAlign: "start",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "4px 0",
    boxSizing: "border-box",
  },
  mobileBody: {
    marginTop: "12px",
  },
  mobileHead: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "6px",
  },
  mobileIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    flexShrink: 0,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  mobileTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  mobileText: {
    margin: "0",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.65",
    color: tokens.colorNeutralForeground2,
  },
  mobilePager: {
    marginTop: "14px",
    display: "flex",
    justifyContent: "center",
    gap: "6px",
  },
  pagerDot: {
    width: "8px",
    height: "8px",
    padding: "0",
    border: "none",
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralStroke2,
    cursor: "pointer",
    transitionProperty: "width, background-color",
    transitionDuration: tokens.durationFast,
  },
  pagerDotActive: {
    width: "22px",
    backgroundColor: tokens.colorBrandBackground,
  },
});

/** 演示内容按可用宽度等比缩放（窄屏自动缩小、不裁剪），宽屏为 1:1。 */
function FitToWidth({
  children,
  onHeightChange,
}: {
  children: ReactNode;
  onHeightChange?: (height: number) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      const width = inner.offsetWidth;
      if (!width) return;
      const scale = Math.min(1, outer.clientWidth / width);
      const height = Math.round(inner.offsetHeight * scale);
      setFit({ scale, height });
      onHeightChange?.(height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        height: fit.height,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        overflow: "hidden",
      }}
    >
      <div ref={innerRef} style={{ transform: `scale(${fit.scale})`, transformOrigin: "top center" }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Demo 场景组件                                                        */
/* ------------------------------------------------------------------ */

// 场景 1：同一张贴纸，三个 App 各存一份
function ScatterDemo() {
  const styles = useStyles();
  const sticker = FISH_STICKERS[1];
  const apps = [
    {
      name: "WeChat",
      logo: <span style={{ fontSize: "11px", lineHeight: 1, fontWeight: 700 }}>W</span>,
      color: "#07C160",
      bg: "rgba(7, 193, 96, 0.12)",
    },
    {
      name: "QQ",
      logo: <span style={{ fontSize: "10px", lineHeight: 1, fontWeight: 700 }}>QQ</span>,
      color: "#12B7F5",
      bg: "rgba(18, 183, 245, 0.12)",
    },
    {
      name: "下载文件夹",
      logo: <Folder20Regular />,
      color: "#E8B24A",
      bg: "rgba(232, 178, 74, 0.16)",
    },
  ];
  return (
    <div className={styles.scatterWrap}>
      {apps.map((app, index) => (
        <div
          key={app.name}
          className={mergeClasses(styles.appCard, styles.float)}
          style={{
            animationDelay: `${index * 0.6}s`,
            borderColor: app.color,
            backgroundColor: app.bg,
          }}
        >
          <span className={styles.appCardName} style={{ color: app.color }}>
            <span className={styles.appBadge} style={{ backgroundColor: app.color }}>
              {app.logo}
            </span>
            {app.name}
          </span>
          <img className={styles.appSticker} src={sticker.src} alt="" draggable={false} />
        </div>
      ))}
    </div>
  );
}

// 场景 2：聊天记录刷屏，翻不到那张图
function ChatScrollDemo() {
  const styles = useStyles();
  const lines = [
    "deepseek 貌似要大幅涨价了",
    "[图片]",
    "梁叔叔最不喜欢就是你们这些10块10快充的用户了",
    "[图片]",
    "[图片]",
    "ds老师，我还记得你",
    "[图片]",
    "哈哈哈 这楼都能吵起来",
    "[图片]",
    "[图片]",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className={styles.chatScrollFrame}>
        <div className={styles.chatScrollTrack} aria-hidden>
          {[...lines, ...lines].map((line, index) => {
            if (line === "[图片]") {
              const sticker = CHAT_STICKERS[index % CHAT_STICKERS.length];
              return (
                <span key={`${line}-${index}`} className={styles.chatBubbleImg}>
                  <img className={styles.chatImg} src={sticker.src} alt="" draggable={false} />
                </span>
              );
            }
            return (
              <span key={`${line}-${index}`} className={styles.chatBubble}>
                {line}
              </span>
            );
          })}
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
  // 用组里的真 gif（100000002043.gif）：左边完整动画，右边同图只显示首帧
  const gif = COW_STICKERS[0];
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
          <img className={mergeClasses(styles.gifImg, styles.bounce)} src={gif.src} alt="" draggable={false} />
        </div>
        <span className={styles.gifCardName}>{gif.name}</span>
        <span className={styles.gifCardLabel}>素材库里 · 完整动画</span>
      </div>
      <ArrowRight20Regular className={styles.gifArrow} aria-hidden />
      <div className={styles.gifCard}>
        <div className={mergeClasses(styles.gifFrame, styles.gifFrameMuted)}>
          <span style={{ display: "flex", width: "100%", height: "100%", filter: "grayscale(1) opacity(0.85)" }}>
            <StickerImage className={styles.gifImg} src={gif.src} gif />
          </span>
          <span className={styles.gifFrozen}>静止</span>
        </div>
        <span className={styles.gifCardName}>{gif.name}</span>
        <span className={styles.gifCardLabel}>粘贴后 · 只剩首帧</span>
      </div>
    </div>
  );
}

// 场景 4：同一张贴纸存了五份
function DuplicateDemo() {
  const styles = useStyles();
  const sticker = FISH_STICKERS[2];
  const [fanned, setFanned] = useState(false);
  // 5 层同一张贴纸：平时轻微叠压，悬停时散开露出层数
  const layers = Array.from({ length: 5 }, (_, i) => {
    const d = i - 2; // -2..2
    return {
      rotate: `${d * 3.5}deg`,
      baseX: d * 5,
      baseY: d * 3,
      openX: d * 40,
      openY: d * 13,
      z: i + 1,
    };
  });
  return (
    <div className={styles.dupWrap}>
      <div
        className={styles.dupStack}
        onMouseEnter={() => setFanned(true)}
        onMouseLeave={() => setFanned(false)}
        aria-label="同一张贴纸重复保存了五份"
      >
        {layers.map((layer, index) => (
          <img
            key={index}
            className={styles.dupImg}
            src={sticker.src}
            alt=""
            draggable={false}
            style={{
              transform: `translate(-50%, -50%) translate(${fanned ? layer.openX : layer.baseX}px, ${fanned ? layer.openY : layer.baseY}px) rotate(${layer.rotate})`,
              zIndex: layer.z,
            }}
          />
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
        <div className={styles.dupNote}>同一份表情包 · 存了 5 份，想清理又不敢删</div>
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
    text: "只记得「好像是一条鱼的动图」，然后花半小时翻聊天记录和收藏夹。",
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

/** 移动端轮播：演示横向滑动（末尾循环回第 1 张），下方说明联动切换。 */
function PainMobileCarousel() {
  const styles = useStyles();
  const trackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  // 各 slide 的缩放后内容高度（FitToWidth 回调上报）：轨道高度跟随当前激活 slide，
  // 避免被最高的一张撑出底部空白（此前较矮的演示离下方说明卡有 40px+ 隐形间距）。
  const [slideHeights, setSlideHeights] = useState<number[]>([]);
  const count = PAIN_POINTS.length;

  const handleSlideHeight = useCallback((index: number, height: number) => {
    setSlideHeights((prev) => {
      if (prev[index] === height) return prev;
      const next = [...prev];
      next[index] = height;
      return next;
    });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const width = track.clientWidth;
      if (!width) return;
      const pos = Math.round(track.scrollLeft / width);
      if (pos >= count) {
        // 滑到最后一张克隆的首屏：循环回到第 1 张
        setActive(0);
        activeRef.current = 0;
        track.scrollTo({ left: 0 });
      } else if (pos !== activeRef.current) {
        setActive(pos);
        activeRef.current = pos;
      }
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [count]);

  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) return;
    const width = track.clientWidth;
    setActive(index);
    activeRef.current = index;
    track.scrollTo({ left: index * width, behavior: "smooth" });
  }

  const slides = [...PAIN_POINTS, PAIN_POINTS[0]];
  const current = PAIN_POINTS[active];
  const ActiveIcon = current.icon;
  const viewportHeight = slideHeights[active];

  return (
    <div className={styles.mobile}>
      {/* +8 = mobileSlide 上下各 4px 的 padding */}
      <div
        className={styles.mobileViewport}
        ref={trackRef}
        style={{ height: viewportHeight !== undefined ? viewportHeight + 8 : undefined }}
      >
        {slides.map((point, index) => (
          <div key={index} className={styles.mobileSlide}>
            <FitToWidth onHeightChange={(height) => handleSlideHeight(index, height)}>
              {point.demo}
            </FitToWidth>
          </div>
        ))}
      </div>
      <div className={styles.mobileBody}>
        <div className={styles.mobileHead}>
          <span className={styles.mobileIcon}>
            <ActiveIcon aria-hidden />
          </span>
          <span className={styles.mobileTitle}>{current.title}</span>
        </div>
        <p className={styles.mobileText}>{current.text}</p>
        <div className={styles.mobilePager}>
          {PAIN_POINTS.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`查看第 ${index + 1} 个场景`}
              className={mergeClasses(styles.pagerDot, index === active && styles.pagerDotActive)}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PainPoints() {
  const section = useSectionStyles();
  const card = useCardStyles();
  const styles = useStyles();
  const [activeIndex, setActiveIndex] = useState(0);
  const active = PAIN_POINTS[activeIndex];
  const ActiveIcon = active.icon;

  return (
    <section id="pain-points" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>表情攒得越多，越难找到想用的那张</h2>
        <p className={section.description}>
          表情散落在不同 App、聊天记录和文件夹里，GIF 粘出去常只剩首帧，重复的图也越攒越多。
        </p>
      </div>
      <div className={styles.wideOnly}>
        <div className={styles.layout}>
        <div className={styles.list}>
          {PAIN_POINTS.map((point, index) => {
            const Icon = point.icon;
            const isActive = index === activeIndex;
            return (
              <button
                key={point.id}
                type="button"
                className={mergeClasses(
                  card.card,
                  styles.pointCard,
                  isActive && styles.pointCardActive,
                )}
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
        <p className={styles.hint}>把鼠标移到卡片上，可查看对应的场景演示。</p>
      </div>

      <PainMobileCarousel />
    </section>
  );
}
