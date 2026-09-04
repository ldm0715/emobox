import { makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { FISH_STICKERS } from "../mockStickers";
import { StickerImage } from "./StickerImage";
import { useSectionStyles } from "../styles/common";

/* ------------------------------------------------------------------ */
/* 「几秒钟，从素材库到聊天框」：横向场景流程图                          */
/* 三幕场景插画（聊天窗 → 浮层 → 完成态）+ 带键帽标注的流动箭头          */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  flow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    "@media (max-width: 1120px)": {
      flexDirection: "column",
      gap: "26px",
    },
  },
  scene: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
  },
  sceneCaption: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  sceneCaptionNo: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    fontSize: tokens.fontSizeBase200,
    color: "#ffffff",
    backgroundColor: tokens.colorBrandBackground,
    borderRadius: tokens.borderRadiusCircular,
  },
  flowNote: {
    marginTop: "22px",
    textAlign: "center",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground4,
  },

  // 幕 1 / 幕 3：迷你聊天窗口
  miniChat: {
    width: "282px",
    height: "244px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow8,
  },
  miniTitleBar: {
    height: "30px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  miniMsgs: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px",
    overflow: "hidden",
  },
  miniMsg: {
    alignSelf: "flex-start",
    maxWidth: "190px",
    padding: "6px 11px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  miniMsgSelf: {
    alignSelf: "flex-end",
    backgroundColor: tokens.colorBrandBackground2,
  },
  miniInput: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "40px",
    margin: "0 12px 12px",
    padding: "0 12px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  inputEmoji: {
    fontSize: "22px",
    lineHeight: "1",
    animationName: {
      "0%": { opacity: "0", transform: "scale(0.4)" },
      "15%": { opacity: "1", transform: "scale(1)" },
      "100%": { opacity: "1", transform: "scale(1)" },
    },
    animationDuration: "4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-out",
  },
  caret: {
    display: "inline-block",
    width: "2px",
    height: "18px",
    backgroundColor: tokens.colorBrandForeground1,
    animationName: {
      from: { opacity: "1" },
      to: { opacity: "0" },
    },
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "steps(1)",
  },
  // 幕 3：发送后的新消息气泡（与输入框里的表情交替出现，循环讲故事）
  sentMsg: {
    animationName: {
      "0%, 30%": { opacity: "0", transform: "translateY(6px)" },
      "45%, 100%": { opacity: "1", transform: "translateY(0)" },
    },
    animationDuration: "4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-out",
  },

  // 幕 2：迷你快捷搜索浮层
  miniOverlay: {
    width: "282px",
    height: "244px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}, ${tokens.shadow8}`,
  },
  miniOverlayBar: {
    height: "30px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  miniOverlayShortcut: {
    marginLeft: "auto",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "11px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  miniSearch: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "10px 12px 0",
    padding: "7px 11px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    "& svg": {
      flexShrink: 0,
      width: "14px",
      height: "14px",
    },
  },
  miniGrid: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "8px",
    padding: "10px 12px",
    alignContent: "start",
  },
  miniCell: {
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
  },
  miniCellSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  miniImg: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    padding: "3px",
    boxSizing: "border-box",
  },
  miniSticker: {
    display: "block",
    width: "46px",
    height: "46px",
    objectFit: "contain",
  },
  miniGridHint: {
    flexShrink: 0,
    padding: "0 12px 10px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },

  // 流程箭头：键帽标注 + 流动线
  arrow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "7px",
    flexShrink: 0,
    alignSelf: "center",
    "@media (max-width: 1120px)": {
      padding: "2px 0",
    },
  },
  arrowKeys: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  keyCap: {
    padding: "1px 6px",
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    whiteSpace: "nowrap",
  },
  arrowLine: {
    position: "relative",
    width: "88px",
    height: "2px",
    backgroundColor: tokens.colorBrandStroke1,
    "@media (max-width: 1120px)": {
      width: "2px",
      height: "64px",
    },
  },
  arrowHead: {
    position: "absolute",
    right: "-6px",
    top: "-4px",
    borderTop: "5px solid transparent",
    borderBottom: "5px solid transparent",
    borderLeft: `7px solid ${tokens.colorBrandStroke1}`,
    "@media (max-width: 1120px)": {
      right: "-5px",
      top: "auto",
      bottom: "-6px",
      borderTop: `7px solid ${tokens.colorBrandStroke1}`,
      borderLeft: "5px solid transparent",
      borderRight: "5px solid transparent",
      borderBottom: "none",
    },
  },
  arrowDot: {
    position: "absolute",
    top: "-2.5px",
    left: "-3px",
    width: "7px",
    height: "7px",
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandForeground1,
    animationName: {
      from: { left: "-3px", opacity: "0" },
      "20%": { opacity: "1" },
      "80%": { opacity: "1" },
      to: { left: "calc(100% - 3px)", opacity: "0" },
    },
    animationDuration: "2.2s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (max-width: 1120px)": {
      animationName: {
        from: { top: "-3px", left: "-2.5px", opacity: "0" },
        "20%": { opacity: "1" },
        "80%": { opacity: "1" },
        to: { top: "calc(100% - 3px)", left: "-2.5px", opacity: "0" },
      },
    },
  },
  arrowLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
});

/* ------------------------------------------------------------------ */
/* 幕场景组件                                                           */
/* ------------------------------------------------------------------ */

function SceneCaption(props: { no: string; children: string }) {
  const styles = useStyles();
  return (
    <div className={styles.sceneCaption}>
      <span className={styles.sceneCaptionNo}>{props.no}</span>
      {props.children}
    </div>
  );
}

function KeyCap(props: { children: string }) {
  const styles = useStyles();
  return <kbd className={styles.keyCap}>{props.children}</kbd>;
}

function FlowArrow(props: { keys: string[]; label: string }) {
  const styles = useStyles();
  return (
    <div className={styles.arrow} aria-hidden>
      <div className={styles.arrowKeys}>
        <KeyCap>{props.keys.join(" + ")}</KeyCap>
      </div>
      <div className={styles.arrowLine}>
        <span className={styles.arrowDot} />
        <span className={styles.arrowHead} />
      </div>
      <div className={styles.arrowLabel}>{props.label}</div>
    </div>
  );
}

/** 幕 1：聊天窗口，光标停在输入框 */
function ChatBeforeScene() {
  const styles = useStyles();
  return (
    <div className={styles.scene}>
      <div className={styles.miniChat}>
        <div className={styles.miniTitleBar}>天才程序员（233）</div>
        <div className={styles.miniMsgs}>
          <span className={styles.miniMsg}>deepseek 貌似要大幅涨价了</span>
          <span className={styles.miniMsg}>梁叔叔最不喜欢就是你们这些10块10快充的用户了</span>
        </div>
        <div className={styles.miniInput}>
          <span className={styles.caret} aria-hidden />
        </div>
      </div>
      <SceneCaption no="1">在聊天输入框</SceneCaption>
    </div>
  );
}

/** 幕 2：浮层弹出，搜索并选中贴纸 */
function OverlayScene() {
  const styles = useStyles();
  const cells = FISH_STICKERS.slice(0, 8).map((sticker, index) => ({
    img: sticker.src,
    gif: sticker.gif,
    selected: index === 0,
  }));
  return (
    <div className={styles.scene}>
      <div className={styles.miniOverlay}>
        <div className={styles.miniOverlayBar}>
          快捷搜索
          <span className={styles.miniOverlayShortcut}>Ctrl+Alt+Space</span>
        </div>
        <div className={styles.miniSearch}>
          <Search20Regular aria-hidden />
          鱼
          <span className={styles.caret} aria-hidden />
        </div>
        <div className={styles.miniGrid}>
          {cells.map((cell, index) => (
            <span
              key={index}
              className={mergeClasses(styles.miniCell, cell.selected && styles.miniCellSelected)}
            >
              <StickerImage className={styles.miniImg} src={cell.img} gif={cell.gif} />
            </span>
          ))}
        </div>
        <div className={styles.miniGridHint}>↑↓ 选择 · Enter 复制</div>
      </div>
      <SceneCaption no="2">浮层里搜到贴纸</SceneCaption>
    </div>
  );
}

/** 幕 3：贴纸自动粘贴进输入框，发送后出现在消息列表（循环演示） */
function ChatAfterScene() {
  const styles = useStyles();
  const sent = FISH_STICKERS[0];
  return (
    <div className={styles.scene}>
      <div className={styles.miniChat}>
        <div className={styles.miniTitleBar}>天才程序员（233）</div>
        <div className={styles.miniMsgs}>
          <span className={styles.miniMsg}>ds老师，我还记得你</span>
          <span className={mergeClasses(styles.miniMsg, styles.miniMsgSelf, styles.sentMsg)} aria-hidden>
            <img className={styles.miniSticker} src={sent.src} alt="" draggable={false} />
          </span>
        </div>
        <div className={styles.miniInput}>
          <img className={styles.miniSticker} src={sent.src} alt="" draggable={false} />
          <span className={styles.caret} aria-hidden />
        </div>
      </div>
      <SceneCaption no="3">自动粘贴 · 发送</SceneCaption>
    </div>
  );
}

export function Workflow() {
  const section = useSectionStyles();
  const styles = useStyles();

  return (
    <section id="workflow" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>几秒钟，从素材库到聊天框</h2>
        <p className={section.description}>
          从唤起浮层到发出表情，全程只需按四次键。
        </p>
      </div>
      <div className={styles.flow}>
        <ChatBeforeScene />
        <FlowArrow keys={["Ctrl", "Alt", "Space"]} label="唤起浮层" />
        <OverlayScene />
        <FlowArrow keys={["Enter"]} label="复制 · 自动粘贴" />
        <ChatAfterScene />
      </div>
      <div className={styles.flowNote}>以上为演示动画，自动循环播放。</div>
    </section>
  );
}
