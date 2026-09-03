import {
  Body1,
  Button,
  Caption1,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Divider,
  Input,
  MessageBar,
  MessageBarBody,
  SearchBox,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
  type GriffelStyle,
} from "@fluentui/react-components";
import { Add16Regular, Checkmark16Regular, Edit16Regular, Delete16Regular, ScanText20Regular } from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OcrTagsUpdatedPayload } from "../../types";
import {
  OCR_TAGS_UPDATED_EVENT,
  addTagsToEmojis,
  createTag,
  deleteTag,
  getEmojiTags,
  getErrorMessage,
  ocrRecognizeEmojis,
  removeTagsFromEmojis,
  renameTag,
} from "../../lib/tauri";
import { useAppSettings } from "../../components/ThemeProvider";
import {
  POPULAR_TAGS_COUNT,
  buildOcrNotice,
  canSubmitRename,
  filterTagsByQuery,
  findExactTag,
  sortPopularTags,
  unionTagIds,
  type OcrBatchStats,
  type OcrNotice,
  type TagOption,
} from "./tagPickerHelpers";
import { ConfirmDialog } from "./ConfirmDialog";
import { pickerDialogStyles, type PickerDialogStyles } from "./pickerDialogStyles";

// 双栏布局（2026-09 重设计）：左栏「当前标签」完整列出所选表情的全部标签
// （多选取并集），右栏「标签库」搜索/勾选/新建。共享行样式沿用
// pickerDialogStyles 的 row/count 范式，扩展「带 hover 操作按钮」的行
// （grid 1fr auto auto：名称 | 操作 | 计数）。重命名/全局删除即时落库
// （区别于勾选的暂存语义），经 onTagsMutated 通知 App 刷新。
const pickerStyles: PickerDialogStyles & {
  surface: GriffelStyle;
  panes: GriffelStyle;
  pane: GriffelStyle;
  paneHead: GriffelStyle;
  paneScroll: GriffelStyle;
  paneSearch: GriffelStyle;
  batchBar: GriffelStyle;
  batchBarText: GriffelStyle;
  actionRow: GriffelStyle;
  rowAddSlot: GriffelStyle;
  rowActions: GriffelStyle;
  rowActionsVisible: GriffelStyle;
  rowActionButton: GriffelStyle;
  renameInput: GriffelStyle;
  paneDivider: GriffelStyle;
  actions: GriffelStyle;
  rightActions: GriffelStyle;
  summary: GriffelStyle;
  searchBox: GriffelStyle;
  sectionLabel: GriffelStyle;
  createRow: GriffelStyle;
  ocrCard: GriffelStyle;
  ocrIcon: GriffelStyle;
  ocrBody: GriffelStyle;
  ocrTitle: GriffelStyle;
  ocrCaption: GriffelStyle;
  ocrProgress: GriffelStyle;
} = {
  ...pickerDialogStyles,
  surface: {
    width: "min(760px, calc(100vw - 48px))",
    maxHeight: "min(680px, calc(100vh - 48px))",
  },
  content: {
    ...pickerDialogStyles.content,
    // MessageBar 出现在 flex 容器里安全；若改 grid 记得 minmax(0,1fr)（坑见 phase29）。
  },
  panes: {
    display: "flex",
    alignItems: "stretch",
    columnGap: tokens.spacingHorizontalM,
  },
  pane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
    // 两栏定高：右栏因多一个 SearchBox 会让「各自 maxHeight 上限」的滚动区
    // 比左栏矮一截（左右大小不一的根因）。统一定总高、滚动区 flex:1 撑满
    // 剩余空间，两栏滚动区底边自然对齐。
    height: "400px",
    maxHeight: "calc(100vh - 320px)",
  },
  paneHead: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    flexShrink: 0,
  },
  paneScroll: {
    flex: 1,
    minHeight: "120px",
    overflowY: "auto",
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingVerticalXS,
  },
  // 右栏搜索框与左栏 paneHead 高度带同处一行（右栏多了它，定高 pane 已兜底对齐）。
  paneSearch: {
    flexShrink: 0,
    marginBottom: tokens.spacingVerticalXS,
  },
  // 左栏批量移除条：选中 ≥1 时浮出（固定在滚动区下方，不占滚动高度）。
  batchBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
    flexShrink: 0,
    paddingTop: tokens.spacingVerticalXS,
  },
  batchBarText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 行模板（含 hover 操作按钮）：grid auto minmax(0,1fr) auto auto =
  // ［＋添加（右栏专用）］｜名称 | ✏️🗑 | 计数。右栏行有 4 个子元素；左栏行
  // 不渲染 ＋ 时由 TagRow 渲染同宽占位——grid 列数固定，缺位会让后续子元素
  // 全部错列（「右侧模板样式不全」的根因）。操作按钮可见性走行级 hovered
  // state（rowActionsVisible 切换）——Griffel 不支持 ":hover .literal-class"
  // 后代选择器（产物里该规则不生成，按钮永远 hidden）；visibility 占位防抖动。
  actionRow: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  // 左栏行 ＋ 列的占位（与右栏 24px 加号按钮同宽，两栏列对齐）。
  rowAddSlot: {
    width: "24px",
    flexShrink: 0,
  },
  rowActions: {
    display: "flex",
    columnGap: "2px",
    visibility: "hidden",
  },
  rowActionsVisible: {
    visibility: "visible",
  },
  rowActionButton: {
    minWidth: "24px",
    minHeight: "24px",
    maxWidth: "24px",
    maxHeight: "24px",
    padding: "0",
  },
  renameInput: {
    minWidth: 0,
  },
  // 长标签名截断样式不在主 styles 里：TagRow / NewTagRow 定义在主组件外，
  // 用模块级 tagNameStyles（tagName / checkboxTruncate 两键）共享。
  // 双栏之间的竖向分隔线（Divider 默认 flex-grow:1 会在 flex 容器里平分
  // 高度——Phase 14 陷阱；这里 stretch 但不生长）。
  paneDivider: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "stretch",
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  rightActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  summary: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  searchBox: {
    // Fluent SearchBox 根元素 inline-flex 且自带 max-width: 468px，
    // 要真正撑满必须同时覆盖两项（侧栏 / 浮层都踩过的坑）。
    width: "100%",
    maxWidth: "none",
  },
  sectionLabel: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  createRow: {
    width: "100%",
    justifyContent: "flex-start",
  },
  ocrCard: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  ocrIcon: {
    flexShrink: 0,
    fontSize: "20px",
    color: tokens.colorBrandForeground1,
  },
  ocrBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
    minWidth: 0,
  },
  ocrTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  ocrCaption: {
    color: tokens.colorNeutralForeground3,
  },
  ocrProgress: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
};
const useStyles = makeStyles(pickerStyles);

interface TagPickerDialogProps {
  open: boolean;
  emojiCount: number;
  emojiIds: number[];
  existingTags: TagOption[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  /** 所有标签操作即时落库后的刷新通道（App 实现 = refreshSidebar +
      currentEmojis/recentItems 补丁；fullReload = 全局删除后重拉视图）。 */
  onTagsMutated: (payload: {
    addedTagIds: number[];
    removedTagIds: number[];
    fullReload?: boolean;
  }) => Promise<void>;
}

export function TagPickerDialog({
  open,
  emojiCount,
  emojiIds,
  existingTags,
  busy = false,
  onOpenChange,
  onTagsMutated,
}: TagPickerDialogProps) {
  const styles = useStyles();
  const { ocrEngine } = useAppSettings();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  // OCR 手动批次进度：null = 空闲；批末 finished 事件后重算左栏并集，
  // 并按 tagged/empty/failed 分布弹出「无结果 / 失败 / 中止」提示。
  const [ocrProgress, setOcrProgress] = useState<OcrBatchStats | null>(null);
  const [ocrNotice, setOcrNotice] = useState<OcrNotice | null>(null);
  // 常挂载弹窗：open 时快照 payload（关闭瞬间 App 置 null，退场动画期间计数不闪 0）。
  const [shownCount, setShownCount] = useState(emojiCount);
  const [emojiIdsSnapshot, setEmojiIdsSnapshot] = useState<number[]>([]);

  // 左栏「当前标签」：所选表情 tagIds 的并集（open 时自取，OCR 批末复用刷新；
  // 即时生效模式下所有操作直接改这个集合并写库——它是唯一的展示真源）。
  const [currentTagIds, setCurrentTagIds] = useState<number[]>([]);
  // 行内重命名：正在编辑的标签 id + 该行 busy。
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null);
  const [renamingBusy, setRenamingBusy] = useState(false);
  // 写操作串行锁（勾选/移除/重命名/全局删除都是即时写库，防止并发乱序）。
  const [mutating, setMutating] = useState(false);
  // 确认弹窗目标：removeTarget = 左栏移除（从所选表情）；deleteTarget = 右栏全局删除。
  const [removeTarget, setRemoveTarget] = useState<TagOption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagOption | null>(null);
  // 左栏多选批量移除：选中的标签 id 集；批移确认目标（null = 批量条未触发）。
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<number>>(new Set());
  const [batchRemoveConfirmOpen, setBatchRemoveConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setShownCount(emojiCount);
      setEmojiIdsSnapshot(emojiIds);
      setQuery("");
      setError("");
      setOcrNotice(null);
      ocrProgressRef.current = null;
      setOcrProgress(null);
      setCurrentTagIds([]);
      setRenamingTagId(null);
      setRenamingBusy(false);
      setMutating(false);
      setRemoveTarget(null);
      setDeleteTarget(null);
      setSelectedForRemoval(new Set());
      setBatchRemoveConfirmOpen(false);
      if (emojiIds.length > 0) {
        void getEmojiTags(emojiIds)
          .then((rows) => setCurrentTagIds(unionTagIds(rows)))
          .catch((e) => setError(getErrorMessage(e)));
      }
    }
    // emojiIds 由 App 快照传入，open 时已定，无需追踪。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedQuery = query.trim();
  const ocrRunning = ocrProgress !== null;

  const tagById = useMemo(
    () => new Map(existingTags.map((tag) => [tag.id, tag])),
    [existingTags],
  );

  const searchResult = useMemo(
    () => filterTagsByQuery(existingTags, trimmedQuery),
    [existingTags, trimmedQuery],
  );
  const popularTags = useMemo(
    () => sortPopularTags(existingTags).slice(0, POPULAR_TAGS_COUNT),
    [existingTags],
  );
  const listRows = trimmedQuery.length > 0 ? searchResult.items : popularTags;
  const canCreateStaged =
    trimmedQuery.length > 0 && findExactTag(existingTags, trimmedQuery) === undefined;

  // 左栏行：并集 id → 标签行数据（existingTags 映射；重命名后名字由
  // onTagsMutated 刷新 App 的 tags prop 回流，无需本地覆盖）。
  const currentRows = useMemo(
    () =>
      currentTagIds
        .map((id) => tagById.get(id))
        .filter((tag): tag is TagOption => !!tag),
    [currentTagIds, tagById],
  );

  // ---- 即时生效写操作（所见即所得，全部直接落库 + onTagsMutated 刷新 App）----

  /** 即时把标签加到所选表情（右栏勾选 / Enter 选中 / 搜索创建即调）。 */
  async function applyAddTag(id: number) {
    if (emojiIdsSnapshot.length === 0 || mutating) return;
    setMutating(true);
    setError("");
    try {
      await addTagsToEmojis([id], emojiIdsSnapshot);
      setCurrentTagIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      await onTagsMutated({ addedTagIds: [id], removedTagIds: [] });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setMutating(false);
    }
  }

  /** 即时从所选表情移除标签（左栏 🗑 确认后 / 右栏取消勾选即调）。 */
  async function applyRemoveTag(id: number) {
    if (emojiIdsSnapshot.length === 0 || mutating) return;
    setMutating(true);
    setError("");
    try {
      await removeTagsFromEmojis([id], emojiIdsSnapshot);
      setCurrentTagIds((prev) => prev.filter((tagId) => tagId !== id));
      // 行消失后同步剔除选中集里的该 id（防悬空勾选）。
      setSelectedForRemoval((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await onTagsMutated({ addedTagIds: [], removedTagIds: [id] });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setMutating(false);
    }
  }

  /** 左栏多选批量移除：一次命令移除全部选中标签（后端矩阵写，单事务）。 */
  async function applyRemoveSelected(ids: number[]) {
    if (emojiIdsSnapshot.length === 0 || ids.length === 0 || mutating) return;
    setMutating(true);
    setError("");
    try {
      await removeTagsFromEmojis(ids, emojiIdsSnapshot);
      const removed = new Set(ids);
      setCurrentTagIds((prev) => prev.filter((tagId) => !removed.has(tagId)));
      // 单行/批量移除后行会消失——选中集同步清空防悬空 id。
      setSelectedForRemoval(new Set());
      await onTagsMutated({ addedTagIds: [], removedTagIds: ids });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setMutating(false);
    }
  }

  function toggleRemovalSelection(id: number) {
    setSelectedForRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 搜索无匹配时的「创建」：即时建标签并加到所选表情（不再暂存）。 */
  async function applyCreateTag(name: string) {
    if (mutating) return;
    setMutating(true);
    setError("");
    try {
      const created = await createTag(name);
      await addTagsToEmojis([created.id], emojiIdsSnapshot);
      setCurrentTagIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setQuery("");
      await onTagsMutated({ addedTagIds: [created.id], removedTagIds: [] });
    } catch (e) {
      // createTag 的 NOCASE 冲突会抛「已存在同名标签」——若此刻库里刚建过
      // 同名（另一入口），提示用户改用勾选。
      setError(getErrorMessage(e));
    } finally {
      setMutating(false);
    }
  }

  // ---- 行内重命名（即时落库）----

  async function commitRename(id: number, currentName: string, inputName: string) {
    if (!canSubmitRename(currentName, inputName)) {
      setRenamingTagId(null);
      return;
    }
    setRenamingBusy(true);
    setError("");
    try {
      await renameTag(id, inputName.trim());
      // 重命名不改关联——只刷侧栏标签名。
      await onTagsMutated({ addedTagIds: [], removedTagIds: [] });
    } catch (e) {
      // 后端 NOCASE 唯一冲突等错误统一弹在弹窗级 MessageBar（行内不留错误位，
      // 避免行高跳动）。
      setError(getErrorMessage(e));
    } finally {
      setRenamingBusy(false);
      setRenamingTagId(null);
    }
  }

  // ---- 全局删除（即时落库，ConfirmDialog 确认）----

  async function commitDelete(id: number) {
    setError("");
    try {
      await deleteTag(id);
      // 标签全局消失：左栏行剔除（currentTagIds 是唯一展示真源）。
      setCurrentTagIds((prev) => prev.filter((tagId) => tagId !== id));
      // 全局删除影响库中全部表情的 tagIds（CASCADE），App 侧不能只做
      // 所选表情的乐观补丁——传 fullReload 让 App 重拉视图。
      await onTagsMutated({ addedTagIds: [], removedTagIds: [], fullReload: true });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  // ---- OCR 手动识别（对话框自持；先例：SettingsMenu 直调 tauri 包装）----

  async function finalizeOcrBatch(final: OcrBatchStats) {
    if (emojiIdsSnapshot.length > 0) {
      try {
        const rows = await getEmojiTags(emojiIdsSnapshot);
        // OCR 识别结果已由后台直接落库（add_tags 追加），左栏并集重算即反映；
        // 即时生效模式下无需维护选中集。
        setCurrentTagIds(unionTagIds(rows));
      } catch (e) {
        setError(getErrorMessage(e));
      }
    }
    // 有标签 → null（左栏即反馈）；无结果 / 失败 / 中止 → 分级提示。
    setOcrNotice(buildOcrNotice(final, ocrEngine));
  }

  // ocr-tags-updated 的 payload 不带 id，监听只注册一次，latest-ref 转发
  // 拿最新快照（App.tsx 同模式）；以 ocrProgressRef 为门——只响应本弹窗
  // 启动的 manual 批次，已结束 / 未开始的事件一律忽略。
  const ocrProgressRef = useRef<OcrBatchStats | null>(null);
  const manualEventHandlerRef = useRef<(payload: OcrTagsUpdatedPayload) => void>(() => {});
  manualEventHandlerRef.current = (payload) => {
    const current = ocrProgressRef.current;
    if (!current) return;
    const next: OcrBatchStats = {
      processed: Math.max(current.processed, payload.processed),
      total: Math.max(current.total, payload.total),
      tagged: Math.max(current.tagged, payload.tagged),
      empty: Math.max(current.empty, payload.empty),
      failed: Math.max(current.failed, payload.failed),
    };
    ocrProgressRef.current = next;
    setOcrProgress(next);
    if (payload.finished) {
      ocrProgressRef.current = null;
      setOcrProgress(null);
      void finalizeOcrBatch(next);
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<OcrTagsUpdatedPayload>(OCR_TAGS_UPDATED_EVENT, (event) => {
      if (event.payload.phase !== "manual") return;
      manualEventHandlerRef.current(event.payload);
    })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((listenError) => {
        console.error("无法监听 OCR 手动识别进度事件", listenError);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function handleOcrRecognize() {
    if (ocrRunning || mutating || busy || ocrEngine === "off") return;
    if (emojiIdsSnapshot.length === 0) return;
    setError("");
    setOcrNotice(null);
    try {
      const queued = await ocrRecognizeEmojis(emojiIdsSnapshot);
      if (queued <= 0) {
        setOcrNotice({
          intent: "warning",
          text: "所选表情均不存在或已在回收站，未启动识别",
        });
        return;
      }
      const progress: OcrBatchStats = {
        processed: 0,
        total: queued,
        tagged: 0,
        empty: 0,
        failed: 0,
      };
      ocrProgressRef.current = progress;
      setOcrProgress(progress);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const ocrCaption =
    ocrEngine === "off"
      ? "OCR 引擎未启用，请先在设置 → 存储 → 文字识别中选择引擎"
      : ocrEngine === "tesseract"
        ? "从图片中的文字自动提取标签；已识别过的会重新识别并覆盖识别文字（标签只增不删）。Tesseract 为本机安装的外部引擎，需已安装并配置中文（chi_sim）/英文（eng）语言包"
        : "从图片中的文字自动提取标签；已识别过的会重新识别并覆盖识别文字（标签只增不删）";

  return (
    // 两个 Dialog 是兄弟节点（Fragment 包裹）——Fluent Dialog 的 children 只能是
    // 「单独 surface」或「trigger + surface 对」，把 ConfirmDialog 塞进主 Dialog
    // 会被当 trigger 无条件渲染、破坏打开/关闭状态机（Phase 31 踩过同款坑）。
    <>
      <Dialog
        open={open}
        onOpenChange={(_, data) => {
          // OCR 批次 / 行内重命名 / 写操作进行中不允许意外关闭（lightbox 外点
          // Esc/遮罩会走这里）。
          if (!mutating && !ocrRunning && renamingTagId === null) onOpenChange(data.open);
        }}
        modalType="modal"
      >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={
              mutating || ocrRunning || renamingBusy ? <Spinner size="small" aria-label="处理中" /> : null
            }
          >
            管理标签
          </DialogTitle>
          <DialogContent className={styles.content}>
            <Body1 className={styles.subtitle}>
              {shownCount > 1
                ? `为 ${shownCount} 个表情选择标签`
                : "为 1 个表情选择标签"}
            </Body1>

            <div className={styles.panes}>
              {/* 左栏：当前标签（行即标签 + 多选批量移除 + 行内改名/单个移除） */}
              <div className={styles.pane}>
                <div className={styles.paneHead}>
                  当前标签（{currentRows.length}）
                </div>
                <div className={styles.paneScroll}>
                  {currentRows.length === 0 ? (
                    <div className={styles.listEmpty}>
                      {emojiIdsSnapshot.length > 1
                        ? "所选表情还没有标签"
                        : "这个表情还没有标签"}
                    </div>
                  ) : (
                    currentRows.map((tag) => (
                      <TagRow
                        key={tag.id}
                        tag={tag}
                        disabled={mutating}
                        editing={renamingTagId === tag.id}
                        editBusy={renamingBusy}
                        rowClass={styles.actionRow}
                        countClass={styles.count}
                        actionsClass={styles.rowActions}
                        actionsVisibleClass={styles.rowActionsVisible}
                        buttonClass={styles.rowActionButton}
                        inputClass={styles.renameInput}
                        rowAddSlotClass={styles.rowAddSlot}
                        selection={{
                          checked: selectedForRemoval.has(tag.id),
                          onToggle: toggleRemovalSelection,
                        }}
                        onStartRename={setRenamingTagId}
                        onSubmitRename={(name) =>
                          void commitRename(tag.id, tag.name, name)
                        }
                        onCancelRename={() => setRenamingTagId(null)}
                        // 左栏 🗑 = 从所选表情移除该标签（即时写库，ConfirmDialog
                        // 确认——不可逆操作要有可见门槛）。
                        onDeleteRequest={() => setRemoveTarget(tag)}
                        deleteTitle="从所选表情移除标签（标签本身保留）"
                      />
                    ))
                  )}
                </div>
                {/* 批量移除条：选中 ≥1 浮出（多选删除一个一个点太慢——用户反馈）。 */}
                {selectedForRemoval.size > 0 && (
                  <div className={styles.batchBar}>
                    <span className={styles.batchBarText}>
                      已选 {selectedForRemoval.size} 个标签
                    </span>
                    <div className={styles.rightActions}>
                      <Button
                        appearance="subtle"
                        size="small"
                        disabled={mutating}
                        onClick={() => setSelectedForRemoval(new Set())}
                      >
                        取消选择
                      </Button>
                      <Button
                        appearance="primary"
                        size="small"
                        icon={<Delete16Regular />}
                        disabled={mutating}
                        onClick={() => setBatchRemoveConfirmOpen(true)}
                      >
                        移除所选
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <Divider vertical className={styles.paneDivider} />
              {/* 右栏：标签库（搜索/勾选/新建 + 行内改名/删除） */}
              <div className={styles.pane}>
                <div className={styles.paneHead}>标签库</div>
                <SearchBox
                  className={mergeClasses(styles.searchBox, styles.paneSearch)}
                  placeholder="搜索或创建标签"
                  value={query}
                  onChange={(_, data) => setQuery(data.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const trimmed = query.trim();
                    if (trimmed.length === 0) return;
                    event.preventDefault();
                    const exact = findExactTag(existingTags, trimmed);
                    if (exact) {
                      // 已有同名标签：直接添加（已在则 applyAddTag 内部幂等跳过写）。
                      void applyAddTag(exact.id);
                      setQuery("");
                      return;
                    }
                    void applyCreateTag(trimmed);
                  }}
                  disabled={mutating}
                  aria-label="搜索或创建标签"
                />
                <div className={styles.paneScroll}>
                  {trimmedQuery.length === 0 ? (
                    existingTags.length === 0 ? (
                      <div className={styles.listEmpty}>
                        还没有标签：输入名称创建，或用下方 OCR 从图片识别
                      </div>
                    ) : (
                      <>
                        <div className={styles.sectionLabel}>常用标签</div>
                        {popularTags.map((tag) => (
                          <TagRow
                            key={tag.id}
                            tag={tag}
                            disabled={mutating}
                            editing={renamingTagId === tag.id}
                            editBusy={renamingBusy}
                            rowClass={styles.actionRow}
                            countClass={styles.count}
                            actionsClass={styles.rowActions}
                            actionsVisibleClass={styles.rowActionsVisible}
                            buttonClass={styles.rowActionButton}
                            inputClass={styles.renameInput}
                            rowAddSlotClass={styles.rowAddSlot}
                            onAdd={(id) => void applyAddTag(id)}
                            added={currentTagIds.includes(tag.id)}
                            onStartRename={setRenamingTagId}
                            onSubmitRename={(name) =>
                              void commitRename(tag.id, tag.name, name)
                            }
                            onCancelRename={() => setRenamingTagId(null)}
                            onDeleteRequest={() => setDeleteTarget(tag)}
                            deleteTitle="删除标签（库中所有表情都会失去它）"
                          />
                        ))}
                      </>
                    )
                  ) : (
                    <>
                      <div className={styles.sectionLabel}>
                        搜索结果（{searchResult.items.length}
                        {searchResult.hiddenCount > 0
                          ? `，还有 ${searchResult.hiddenCount} 个未显示`
                          : ""}
                        ）
                      </div>
                      {listRows.map((tag) => (
                        <TagRow
                          key={tag.id}
                          tag={tag}
                          disabled={mutating}
                          editing={renamingTagId === tag.id}
                          editBusy={renamingBusy}
                          rowClass={styles.actionRow}
                          countClass={styles.count}
                          actionsClass={styles.rowActions}
                          actionsVisibleClass={styles.rowActionsVisible}
                          buttonClass={styles.rowActionButton}
                          inputClass={styles.renameInput}
                          rowAddSlotClass={styles.rowAddSlot}
                          onAdd={(id) => void applyAddTag(id)}
                          added={currentTagIds.includes(tag.id)}
                          onStartRename={setRenamingTagId}
                          onSubmitRename={(name) =>
                            void commitRename(tag.id, tag.name, name)
                          }
                          onCancelRename={() => setRenamingTagId(null)}
                          onDeleteRequest={() => setDeleteTarget(tag)}
                          deleteTitle="删除标签（库中所有表情都会失去它）"
                        />
                      ))}
                    </>
                  )}
                  {canCreateStaged && (
                    <Button
                      className={styles.createRow}
                      appearance="transparent"
                      size="small"
                      icon={<Add16Regular />}
                      disabled={mutating}
                      onClick={() => void applyCreateTag(trimmedQuery)}
                    >
                      创建「{trimmedQuery}」并添加
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* 暂存新建标签在左栏底部展示（chips 行已删——左栏承担全部展示职责） */}

            <div className={styles.ocrCard}>
              <ScanText20Regular className={styles.ocrIcon} />
              <div className={styles.ocrBody}>
                <span className={styles.ocrTitle}>OCR 识别标签</span>
                <Caption1 className={styles.ocrCaption}>{ocrCaption}</Caption1>
              </div>
              {ocrProgress ? (
                <span className={styles.ocrProgress}>
                  <Spinner size="extra-tiny" aria-label="识别中" />
                  正在识别 {ocrProgress.processed}/{ocrProgress.total}…
                </span>
              ) : (
                <Button
                  size="small"
                  appearance="secondary"
                  disabled={mutating || busy || ocrEngine === "off"}
                  onClick={() => void handleOcrRecognize()}
                >
                  开始识别
                </Button>
              )}
            </div>

            {error && (
              <FadeSnappy visible appear>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              </FadeSnappy>
            )}
            {ocrNotice && (
              <FadeSnappy visible appear>
                <MessageBar intent={ocrNotice.intent}>
                  <MessageBarBody>{ocrNotice.text}</MessageBarBody>
                </MessageBar>
              </FadeSnappy>
            )}

            <div className={styles.actions}>
              <span className={styles.summary}>修改即时生效，无需手动保存</span>
              <div className={styles.rightActions}>
                <DialogTrigger disableButtonEnhancement>
                  <Button appearance="subtle" disabled={mutating || ocrRunning || renamingBusy}>关闭</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  disabled={mutating || ocrRunning || renamingBusy}
                  onClick={() => onOpenChange(false)}
                >
                  完成
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
      </Dialog>

      {/* 左栏移除确认（从所选表情移除该标签，即时写库、即时不可逆——
          用户要求移除要有提示框）。两个确认弹窗与主 Dialog 平级（Fragment
          兄弟节点——塞进主 Dialog children 会被 Fluent 当 trigger 无条件
          渲染、弹窗自己蹦出来关不掉，Phase 31 同款坑）。 */}
      <ConfirmDialog
        open={removeTarget !== null}
        title="移除标签"
        message={
          removeTarget
            ? `将把标签「${removeTarget.name}」从${shownCount > 1 ? ` ${shownCount} 个所选表情` : "这个表情"}上移除。\n标签本身保留，之后仍可在右侧标签库重新添加。`
            : ""
        }
        confirmText="移除"
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoveTarget(null);
        }}
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void applyRemoveTag(target.id);
        }}
      />

      {/* 左栏批量移除确认（汇总数量；列名空间有限，靠数量 + 左栏可见选中态传达）。 */}
      <ConfirmDialog
        open={batchRemoveConfirmOpen}
        title="批量移除标签"
        message={
          `将把 ${selectedForRemoval.size} 个标签从${shownCount > 1 ? ` ${shownCount} 个所选表情` : "这个表情"}上移除。\n标签本身保留，之后仍可在右侧标签库重新添加。`
        }
        confirmText="移除"
        onOpenChange={(isOpen) => {
          if (!isOpen) setBatchRemoveConfirmOpen(false);
        }}
        onConfirm={() => {
          setBatchRemoveConfirmOpen(false);
          void applyRemoveSelected([...selectedForRemoval]);
        }}
      />

      {/* 右栏全局删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除标签"
        message={
          deleteTarget
            ? `将删除标签「${deleteTarget.name}」，库中所有表情都会失去这个标签。`
            : ""
        }
        confirmText="删除"
        destructive
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleteTarget(null);
        }}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void commitDelete(target.id);
        }}
      />
    </>
  );
}

const tagNameStyles = makeStyles({
  tagName: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 右栏「＋添加」行的名称收缩覆盖（与行首加号按钮同一 flex 行内）。
  checkboxTruncate: {
    minWidth: 0,
    overflow: "hidden",
  },
});
const useTagNameStyles = tagNameStyles;

interface TagRowProps {
  tag: TagOption;
  disabled: boolean;
  /** 该行处于行内重命名态（label 位换 Input）。 */
  editing: boolean;
  /** 重命名请求进行中（行禁用 + Spinner）。 */
  editBusy: boolean;
  rowClass: string;
  countClass: string;
  actionsClass: string;
  actionsVisibleClass: string;
  buttonClass: string;
  inputClass: string;
  /** 左栏行 ＋ 列占位样式类（主 styles.rowAddSlot）。 */
  rowAddSlotClass: string;
  /** 左栏多选模式：提供时行首是 Checkbox（批量移除选中态）。 */
  selection?: {
    checked: boolean;
    onToggle: (id: number) => void;
  };
  /** 右栏「＋添加」模式：提供时行首是加号按钮（点击加到所选表情），
      该标签已在所选表情上时显示「已添加」态。左栏不传（行即标签）。 */
  onAdd?: (id: number) => void;
  /** 右栏 onAdd 模式下：该标签是否已在所选表情上（已添加态）。 */
  added?: boolean;
  onStartRename: (id: number) => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  /** 🗑 点击（语义由调用方决定：左栏=从所选表情移除，右栏=全局删除）。 */
  onDeleteRequest: () => void;
  /** 🗑 的原生 title 文案（两栏语义不同）。 */
  deleteTitle: string;
}

function TagRow({
  tag,
  disabled,
  editing,
  editBusy,
  rowClass,
  countClass,
  actionsClass,
  actionsVisibleClass,
  buttonClass,
  inputClass,
  rowAddSlotClass,
  selection,
  onAdd,
  added = false,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onDeleteRequest,
  deleteTitle,
}: TagRowProps) {
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const truncateStyles = useTagNameStyles();

  useEffect(() => {
    if (editing) {
      setDraft(tag.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // 仅在进入编辑态时初始化草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (editing) {
    return (
      <div className={rowClass}>
        <Input
          ref={inputRef}
          className={inputClass}
          appearance="underline"
          value={draft}
          disabled={editBusy}
          onChange={(_, data) => setDraft(data.value)}
          onKeyDown={(event) => {
            if (editBusy) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmitRename(draft);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
          onBlur={() => {
            if (!editBusy) onSubmitRename(draft);
          }}
          contentAfter={
            editBusy ? <Spinner size="extra-tiny" aria-label="保存中" /> : undefined
          }
        />
        <div className={mergeClasses(actionsClass, editing && actionsVisibleClass)}>
          <Button
            className={buttonClass}
            appearance="transparent"
            size="small"
            icon={<Edit16Regular />}
            title="重命名标签"
            disabled={editBusy}
            onClick={() => onSubmitRename(draft)}
          />
        </div>
        <span className={countClass}>{tag.count} 张</span>
      </div>
    );
  }

  return (
    <div
      className={rowClass}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {onAdd ? (
        // 右栏「＋添加」模式：加号按钮即时把标签加到所选表情；已添加态换
        // 对勾禁用按钮（移除入口在左栏，语义各归其位）。
        <Button
          className={buttonClass}
          appearance="transparent"
          size="small"
          icon={added ? <Checkmark16Regular /> : <Add16Regular />}
          title={added ? "已添加到所选表情" : "添加到所选表情"}
          disabled={disabled || added}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAdd(tag.id);
          }}
        />
      ) : selection ? (
        // 左栏多选模式：行首 Checkbox 占 ＋ 列（列结构不变），勾选进入
        // 批量移除选中集。
        <Checkbox
          checked={selection.checked}
          onChange={() => selection.onToggle(tag.id)}
          aria-label={`选择标签 ${tag.name}`}
          disabled={disabled}
        />
      ) : (
        // 兜底占位：与右栏加号按钮同宽（24px），两栏列对齐。
        <span className={rowAddSlotClass} aria-hidden="true" />
      )}
      <span
        title={tag.name}
        // 名称统一块级截断（tagName 自带 display:block + 三件套），
        // 左右两栏同一模板，字号/行高一致。
        className={truncateStyles.tagName}
      >
        {tag.name}
      </span>
      <div className={mergeClasses(actionsClass, (hovered || editing) && actionsVisibleClass)}>
        <Button
          className={buttonClass}
          appearance="transparent"
          size="small"
          icon={<Edit16Regular />}
          title="重命名标签"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartRename(tag.id);
          }}
        />
        <Button
          className={buttonClass}
          appearance="transparent"
          size="small"
          icon={<Delete16Regular />}
          title={deleteTitle}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDeleteRequest();
          }}
        />
      </div>
      <span className={countClass}>{tag.count} 张</span>
    </div>
  );
}
