import {
  Button,
  SearchBox,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  Dismiss20Regular,
  Search20Regular,
  SearchSquare20Regular,
  Send20Regular,
} from "@fluentui/react-icons";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { COW_STICKERS, FISH_STICKERS, matchStickerQuery } from "../mockStickers";
import { StickerImage } from "./StickerImage";

/* ------------------------------------------------------------------ */
/* 数据（演示池：搜索、分组、加载更多都是本地过滤）                       */
/* ------------------------------------------------------------------ */

const TINTS = {
  blue: "rgba(71, 158, 245, 0.14)",
  green: "rgba(56, 190, 128, 0.14)",
  orange: "rgba(255, 153, 61, 0.16)",
  purple: "rgba(150, 110, 245, 0.14)",
  pink: "rgba(245, 110, 150, 0.14)",
  cyan: "rgba(56, 180, 200, 0.14)",
} as const;

type OverlayGroup = "cow" | "fish";

type OverlayItem = {
  img: string;
  name: string;
  gif?: boolean;
  groups: OverlayGroup[];
  tags: string[];
};

const POOL: OverlayItem[] = [
  ...COW_STICKERS.map((s) => ({
    img: s.src,
    name: s.name,
    gif: s.gif,
    groups: ["cow"] as OverlayGroup[],
    tags: ["牛"],
  })),
  ...FISH_STICKERS.map((s) => ({
    img: s.src,
    name: s.name,
    gif: s.gif,
    groups: ["fish"] as OverlayGroup[],
    tags: ["鱼"],
  })),
];

const PAGE_SIZE = 10;

const CHIPS: { label: string; group: OverlayGroup | null; icon?: ReactElement }[] = [
  { label: "全部", group: null },
  { label: "抽象草地牛", group: "cow" },
  { label: "蓝色大肥鱼", group: "fish" },
];

/* 聊天语境（写死），自己发送的贴纸会追加在后面。 */
type MockMessage = {
  id: number;
  self?: boolean;
  avatar: string;
  tint: string;
  text?: string;
  sticker?: { img: string; gif?: boolean };
};

const INITIAL_MESSAGES: MockMessage[] = [
  { id: 1, avatar: "🐟", tint: TINTS.cyan, text: "deepseek 貌似要大幅涨价了" },
  { id: 2, avatar: "🐻", tint: TINTS.orange, text: "梁叔叔最不喜欢就是你们这些10块10快充的用户了" },
  { id: 3, avatar: "😺", tint: TINTS.purple, text: "ds老师，我还记得你" },
];

const SELF_AVATAR = { emoji: "😊", tint: TINTS.pink };

const useStyles = makeStyles({
  scrollOuter: {
    overflowX: "clip",
  },
  // 演示固定 820px 设计稿宽度，按可用宽度等比缩放居中（与 Hero 主窗口 mock 一致）。
  stage: {
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  // 内层 820px 画布：外层 stage 按容器宽度缩放适配。
  wrapper: {
    position: "relative",
    width: "820px",
    flexShrink: 0,
    transformOrigin: "top center",
  },

  // 背景：极简聊天窗口示意（网站场景插画，非应用 UI）
  chat: {
    display: "flex",
    flexDirection: "column",
    minHeight: "640px",
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    overflow: "hidden",
    opacity: "0.92",
  },
  chatTitleBar: {
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  chatTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  chatMessages: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    padding: "22px",
    overflowY: "auto",
  },
  msgRow: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
  },
  msgRowSelf: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: "38px",
    height: "38px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    borderRadius: tokens.borderRadiusMedium,
  },
  bubble: {
    maxWidth: "320px",
    padding: "10px 14px",
    fontSize: tokens.fontSizeBase400,
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  bubbleSelf: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  bubbleEmoji: {
    fontSize: "26px",
    lineHeight: "1.3",
    padding: "6px 10px",
  },
  msgSticker: {
    display: "block",
    width: "86px",
    height: "86px",
    objectFit: "contain",
  },
  guideRow: {
    display: "flex",
    justifyContent: "center",
    paddingBottom: "10px",
  },
  guide: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalM}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusCircular,
  },
  chatInputBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "54px",
    margin: "16px",
    padding: "0 10px 0 16px",
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase400,
    cursor: "text",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1),
    },
  },
  inputBarActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  chatInputText: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "52px",
  },
  inputPreview: {
    width: "58px",
    height: "58px",
    objectFit: "contain",
    animationName: {
      from: { opacity: "0", transform: "scale(0.4)" },
      to: { opacity: "1", transform: "scale(1)" },
    },
    animationDuration: tokens.durationFast,
    animationTimingFunction: tokens.curveEasyEase,
  },
  caret: {
    display: "inline-block",
    width: "3px",
    height: "24px",
    backgroundColor: tokens.colorBrandForeground1,
    animationName: {
      from: { opacity: "1" },
      to: { opacity: "0" },
    },
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "steps(1)",
  },
  sendButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    backgroundColor: "transparent",
    ":hover": {
      color: tokens.colorBrandForeground1,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },

  // 前景：快捷搜索浮层（示意，原 680×500 同比例放大到接近原尺寸，保留长宽比）
  overlay: {
    position: "absolute",
    top: "60px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "660px",
    height: "486px",
    paddingBottom: "12px",
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    overflow: "hidden",
    animationName: {
      from: { opacity: "0", transform: "translateX(-50%) translateY(8px)" },
      to: { opacity: "1", transform: "translateX(-50%) translateY(0)" },
    },
    animationDuration: tokens.durationFast,
    animationTimingFunction: tokens.curveEasyEase,
  },
  titleBar: {
    flexShrink: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    height: "52px",
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalXS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  shortcut: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  content: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  search: {
    width: "100%",
    maxWidth: "none",
    "& input": {
      fontSize: tokens.fontSizeBase400,
      paddingBlock: "10px",
    },
  },
  groupRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    height: "44px",
    flexShrink: 0,
    minWidth: 0,
    overflowX: "auto",
  },
  status: {
    display: "flex",
    alignItems: "center",
    minHeight: "18px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
  },
  // 结果弹性滚动区（应用 results 同款：超出 500px 高度时内部滚动）
  results: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalS,
  },
  item: {
    minWidth: 0,
    padding: tokens.spacingHorizontalXS,
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
  },
  itemSelected: {
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  frame: {
    aspectRatio: "1 / 1",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    marginBottom: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
  },
  frameEmoji: {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "contain",
    padding: "4px",
    boxSizing: "border-box",
    borderRadius: tokens.borderRadiusSmall,
  },
  fileName: {
    display: "block",
    overflow: "hidden",
    padding: `0 ${tokens.spacingHorizontalXS}`,
    fontSize: tokens.fontSizeBase100,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    minHeight: "120px",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  loadMoreWrap: {
    display: "flex",
    justifyContent: "center",
    padding: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalXS}`,
  },
  footer: {
    minHeight: "18px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase100,
    lineHeight: "1.2",
  },
  key: {
    padding: "0 3px",
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    lineHeight: "1.2",
  },
  footerItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
  },
  caption: {
    marginTop: "16px",
    textAlign: "center",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },

  // 浮层内 toast（模拟应用通知；Fluent Toaster 是页面级 portal，这里自绘）
  toastLayer: {
    position: "absolute",
    top: "64px",
    right: "16px",
    zIndex: 3,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
    pointerEvents: "none",
  },
  toast: {
    maxWidth: "320px",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    animationName: {
      from: { opacity: "0", transform: "translateY(-8px)" },
      to: { opacity: "1", transform: "translateY(0)" },
    },
    animationDuration: tokens.durationFast,
    animationTimingFunction: tokens.curveEasyEase,
  },
});

export function QuickSearchMockup() {
  const styles = useStyles();

  // 外层按可用宽度等比缩放演示画布（820px 设计稿），窄屏/手机自适应。
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      setFit({
        scale: Math.min(1, outer.clientWidth / 820),
        height: inner.offsetHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // 浮层内 toast：模拟应用通知，2.6s 自动消失
  const [toasts, setToasts] = useState<{ id: number; title: string }[]>([]);
  const nextToastIdRef = useMemo(() => ({ current: 1 }), []);

  function notify(title: string) {
    const id = nextToastIdRef.current++;
    setToasts((prev) => [...prev.slice(-2), { id, title }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2600);
  }

  // 场景状态：输入框点击唤起浮层 → 选表情自动粘贴 → 发送进消息列表
  const [messages, setMessages] = useState<MockMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState<{ img: string; gif?: boolean } | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [activationCount, setActivationCount] = useState(0);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<OverlayGroup | null>(null);
  const [displayed, setDisplayed] = useState(PAGE_SIZE);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(
    () =>
      POOL.filter(
        (candidate) =>
          (chip === null || candidate.groups.includes(chip)) && matchStickerQuery(query, candidate),
      ),
    [query, chip],
  );

  const visible = filtered.slice(0, displayed);
  const hasMore = filtered.length > displayed;
  const trimmedQuery = query.trim();

  const statusText = trimmedQuery
    ? `搜索 “${trimmedQuery}” · ${filtered.length} 张结果`
    : chip !== null
      ? `分组「${CHIPS.find((candidate) => candidate.group === chip)?.label}」 · ${filtered.length} 张`
      : `最近使用 · ${filtered.length} 张`;

  function openOverlay() {
    setOverlayOpen(true);
    setActivationCount((prev) => prev + 1);
    setSelectedIndex(0);
    setDisplayed(PAGE_SIZE);
  }

  function closeOverlay() {
    setOverlayOpen(false);
  }

  // 选中贴纸 = 复制并「自动粘贴」回聊天输入框（应用 hide-then-paste 的演示化）。
  function pickItem(item: OverlayItem) {
    notify(`已复制 “${item.name}”，自动粘贴回聊天窗口`);
    setDraft({ img: item.img, gif: item.gif });
    setOverlayOpen(false);
  }

  function sendMessage() {
    if (!draft) {
      notify("先点输入框唤起快捷搜索，选一张贴纸");
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        self: true,
        avatar: SELF_AVATAR.emoji,
        tint: SELF_AVATAR.tint,
        sticker: { img: draft.img, gif: draft.gif },
      },
    ]);
    setDraft(null);
  }

  function handleOverlayKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (visible.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % visible.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + visible.length) % visible.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pickItem(visible[Math.min(selectedIndex, visible.length - 1)]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
    }
  }

  return (
    <div className={styles.scrollOuter} ref={outerRef}>
      <div className={styles.stage} style={{ height: `${fit.height * fit.scale}px` }}>
        <div className={styles.wrapper} ref={innerRef} style={{ transform: `scale(${fit.scale})` }}>
          {/* 背景聊天窗口：点输入框唤起浮层，点空白处失焦关闭 */}
        <div
          className={styles.chat}
          onClick={() => {
            if (overlayOpen) closeOverlay();
          }}
        >
          <div className={styles.chatTitleBar}>
            <span className={styles.chatTitle}>天才程序员（233）</span>
          </div>
          <div className={styles.chatMessages}>
            {messages.map((message) => (
              <div key={message.id} className={mergeClasses(styles.msgRow, message.self && styles.msgRowSelf)}>
                <span className={styles.avatar} style={{ backgroundColor: message.tint }}>
                  {message.avatar}
                </span>
                {message.sticker ? (
                  <span className={mergeClasses(styles.bubble, message.self && styles.bubbleSelf)}>
                    <img className={styles.msgSticker} src={message.sticker.img} alt="" draggable={false} />
                  </span>
                ) : (
                  <span className={mergeClasses(styles.bubble, message.self && styles.bubbleSelf)}>
                    {message.text}
                  </span>
                )}
              </div>
            ))}
          </div>
          {!overlayOpen && !draft && (
            <div className={styles.guideRow}>
              <span className={styles.guide}>点击下方输入框，体验唤起快捷搜索 ↓</span>
            </div>
          )}
          <div
            className={mergeClasses(styles.chatInputBar, overlayOpen && styles.inputBarActive)}
            onClick={(event) => {
              event.stopPropagation();
              if (!overlayOpen) openOverlay();
            }}
          >
            <span className={styles.chatInputText}>
              {draft ? (
                <>
                  <img className={styles.inputPreview} src={draft.img} alt="待发送贴纸" draggable={false} />
                  <span className={styles.caret} aria-hidden />
                </>
              ) : (
                "输入消息…"
              )}
            </span>
            <button
              type="button"
              className={styles.sendButton}
              aria-label="发送"
              title="发送"
              onClick={(event) => {
                event.stopPropagation();
                sendMessage();
              }}
            >
              <Send20Regular />
            </button>
          </div>
        </div>

        {/* 快捷搜索浮层：仅唤起后渲染，key 变化重播入场动画 */}
        {overlayOpen && (
          <div
            key={activationCount}
            className={styles.overlay}
            role="dialog"
            aria-label="快捷搜索浮层（可交互演示）"
            onKeyDown={handleOverlayKeyDown}
          >
            <div className={styles.titleBar}>
              <SearchSquare20Regular color={tokens.colorBrandForeground1} aria-hidden />
              <span className={styles.title}>快捷搜索</span>
              <span className={styles.shortcut}>Ctrl+Alt+Space</span>
              <Button appearance="subtle" aria-label="隐藏快捷搜索" icon={<Dismiss20Regular />} onClick={closeOverlay} />
            </div>
            <div className={styles.content}>
              <SearchBox
                className={styles.search}
                size="large"
                aria-label="快速搜索表情"
                contentBefore={<Search20Regular />}
                placeholder="搜索表情、标签或分组（组*标签）"
                value={query}
                autoFocus
                onChange={(_, data) => {
                  setQuery(data.value);
                  setSelectedIndex(0);
                  setDisplayed(PAGE_SIZE);
                }}
                onKeyDown={handleOverlayKeyDown}
              />
              <div className={styles.groupRow}>
                {CHIPS.map((candidate) => (
                  <Button
                    key={candidate.label}
                    size="small"
                    appearance={chip === candidate.group ? "primary" : "secondary"}
                    icon={candidate.icon}
                    onClick={() => {
                      setChip(candidate.group);
                      setSelectedIndex(0);
                      setDisplayed(PAGE_SIZE);
                    }}
                  >
                    {candidate.label}
                  </Button>
                ))}
              </div>
              <div className={styles.status}>{filtered.length > 0 ? statusText : null}</div>
              <div className={styles.results}>
                {visible.length === 0 ? (
                <div className={styles.empty}>
                  {trimmedQuery ? (
                    <span>没有找到匹配 {trimmedQuery} 的表情</span>
                  ) : (
                    <span>还没有表情，请先在主窗口导入图片或文件夹</span>
                  )}
                </div>
              ) : (
                <div className={styles.grid}>
                  {visible.map((result, index) => (
                    <div
                      key={`${result.name}-${index}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      tabIndex={-1}
                      className={mergeClasses(styles.item, index === selectedIndex && styles.itemSelected)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => pickItem(result)}
                    >
                      <span className={styles.frame}>
                        <StickerImage className={styles.frameEmoji} src={result.img} gif={result.gif} />
                      </span>
                      <span className={styles.fileName}>{result.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {hasMore && (
                <div className={styles.loadMoreWrap}>
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => setDisplayed((prev) => prev + PAGE_SIZE)}
                  >
                    加载更多（已显示 {visible.length}/{filtered.length}）
                  </Button>
                </div>
              )}
              </div>
            </div>
            <div className={styles.footer}>
              <span className={styles.footerItem}>
                <span className={styles.key}>↑↓</span> 选择
              </span>
              <span className={styles.footerItem}>
                <span className={styles.key}>Enter</span> 复制
              </span>
              <span className={styles.footerItem}>
                <span className={styles.key}>Esc</span> 关闭
              </span>
            </div>
          </div>
        )}

        {/* 浮层内 toast */}
        <div className={styles.toastLayer} aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={styles.toast}>
              {toast.title}
            </div>
          ))}
        </div>
      </div>
      </div>

      <div className={styles.caption}>
        以上是界面演示：点击输入框会唤起快捷搜索，点选表情会自动粘贴，点发送即可发出。
      </div>
    </div>
  );
}
