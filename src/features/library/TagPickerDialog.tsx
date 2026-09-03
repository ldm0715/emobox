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
  InteractionTag,
  InteractionTagPrimary,
  InteractionTagSecondary,
  MessageBar,
  MessageBarBody,
  SearchBox,
  Spinner,
  TagGroup,
  makeStyles,
  tokens,
  type GriffelStyle,
} from "@fluentui/react-components";
import { Add16Regular, ScanText20Regular } from "@fluentui/react-icons";
import { FadeSnappy } from "@fluentui/react-motion-components-preview";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OcrTagsUpdatedPayload } from "../../types";
import {
  OCR_TAGS_UPDATED_EVENT,
  getEmojiTags,
  getErrorMessage,
  ocrRecognizeEmojis,
} from "../../lib/tauri";
import { useAppSettings } from "../../components/ThemeProvider";
import {
  POPULAR_TAGS_COUNT,
  buildOcrNotice,
  canStageNewTagName,
  filterTagsByQuery,
  findExactTag,
  intersectTagIds,
  mergeOcrSelection,
  sortPopularTags,
  type OcrBatchStats,
  type OcrNotice,
  type TagOption,
} from "./tagPickerHelpers";
import { pickerDialogStyles, type PickerDialogStyles } from "./pickerDialogStyles";

// 共享样式见 pickerDialogStyles.ts；Phase 33 重设计后本弹窗仍沿用
// surface/content/subtitle/listScroll/row/count，新增 chips、搜索框、
// OCR 卡片等独有区块。surface 加宽到 520px 容纳 chip 区。
const pickerStyles: PickerDialogStyles & {
  actions: GriffelStyle;
  rightActions: GriffelStyle;
  summary: GriffelStyle;
  chipGroup: GriffelStyle;
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
    width: "min(520px, calc(100vw - 48px))",
    maxHeight: "min(680px, calc(100vh - 48px))",
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
  chipGroup: {
    maxHeight: "76px",
    overflowY: "auto",
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
  initiallySelectedTagIds: number[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    addedTagIds: number[];
    removedTagIds: number[];
    newTagNames: string[];
  }) => Promise<void>;
}

/** 暂存新标签 chip 的 value 前缀（与已有标签的数字 id 区分）。 */
const NEW_NAME_VALUE_PREFIX = "new:";

export function TagPickerDialog({
  open,
  emojiCount,
  emojiIds,
  existingTags,
  initiallySelectedTagIds,
  busy = false,
  onOpenChange,
  onConfirm,
}: TagPickerDialogProps) {
  const styles = useStyles();
  const { ocrEngine } = useAppSettings();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newNames, setNewNames] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // OCR 手动批次进度：null = 空闲；批末 finished 事件后取表情标签交集并入
  // 选中集，并按 tagged/empty/failed 分布弹出「无结果 / 失败 / 中止」提示。
  const [ocrProgress, setOcrProgress] = useState<OcrBatchStats | null>(null);
  const [ocrNotice, setOcrNotice] = useState<OcrNotice | null>(null);
  // 常挂载弹窗：open 时快照 payload（关闭瞬间 App 置 null，退场动画期间计数不闪 0）。
  const [shownCount, setShownCount] = useState(emojiCount);
  const [emojiIdsSnapshot, setEmojiIdsSnapshot] = useState<number[]>([]);

  useEffect(() => {
    if (open) {
      setShownCount(emojiCount);
      setEmojiIdsSnapshot(emojiIds);
      setSelected(new Set(initiallySelectedTagIds));
      setNewNames([]);
      setQuery("");
      setError("");
      setOcrNotice(null);
      ocrProgressRef.current = null;
      setOcrProgress(null);
    }
  }, [open, emojiCount, emojiIds, initiallySelectedTagIds]);

  const trimmedQuery = query.trim();
  const canSubmit = !busy && !pending;
  const ocrRunning = ocrProgress !== null;

  // 计算 added/removed：相对 initialSelected
  const initial = useMemo(() => new Set(initiallySelectedTagIds), [initiallySelectedTagIds]);
  const addedTagIds = useMemo(
    () => Array.from(selected).filter((id) => !initial.has(id)),
    [selected, initial],
  );
  const removedTagIds = useMemo(
    () => initial.size === 0
      ? []
      : Array.from(initial).filter((id) => !selected.has(id)),
    [initial, selected],
  );
  const hasChanges =
    addedTagIds.length > 0 || removedTagIds.length > 0 || newNames.length > 0;

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
    trimmedQuery.length > 0 &&
    findExactTag(existingTags, trimmedQuery) === undefined &&
    canStageNewTagName(newNames, existingTags, trimmedQuery);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stageNewName(name: string) {
    if (!canStageNewTagName(newNames, existingTags, name)) return;
    setNewNames((prev) => [...prev, name.trim()]);
    setQuery("");
  }

  function dismissChip(value: string) {
    if (value.startsWith(NEW_NAME_VALUE_PREFIX)) {
      const name = value.slice(NEW_NAME_VALUE_PREFIX.length);
      setNewNames((prev) => prev.filter((existing) => existing !== name));
      return;
    }
    toggle(Number(value));
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    event.preventDefault();
    const exact = findExactTag(existingTags, trimmed);
    if (exact) {
      toggle(exact.id);
      setQuery("");
      return;
    }
    stageNewName(trimmed);
  }

  // ---- OCR 手动识别（对话框自持；先例：SettingsMenu 直调 tauri 包装）----

  async function finalizeOcrBatch(final: OcrBatchStats) {
    if (emojiIdsSnapshot.length > 0) {
      try {
        const rows = await getEmojiTags(emojiIdsSnapshot);
        const common = intersectTagIds(rows);
        // 只并入交集；mergeOcrSelection 保证不复活用户已手动反选的标签。
        setSelected((prev) => mergeOcrSelection(prev, common, initiallySelectedTagIds));
      } catch (e) {
        setError(getErrorMessage(e));
      }
    }
    // 有标签 → null（chips 即反馈）；无结果 / 失败 / 中止 → 分级提示。
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
    if (ocrRunning || pending || busy || ocrEngine === "off") return;
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

  async function handleConfirm() {
    if (!canSubmit) return;
    setError("");
    setPending(true);
    try {
      await onConfirm({
        addedTagIds,
        removedTagIds,
        newTagNames: newNames,
      });
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  const ocrCaption =
    ocrEngine === "off"
      ? "OCR 引擎未启用，请先在设置 → 存储 → 文字识别中选择引擎"
      : "从图片中的文字自动提取标签；已识别过的会重新识别并覆盖识别文字（标签只增不删）";

  const selectedIdsSorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!pending) onOpenChange(data.open);
      }}
      modalType="modal"
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle
            action={
              pending || ocrRunning ? <Spinner size="small" aria-label="处理中" /> : null
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

            {selected.size + newNames.length > 0 && (
              <TagGroup
                className={styles.chipGroup}
                dismissible
                onDismiss={(_, data) => dismissChip(String(data.value))}
              >
                {selectedIdsSorted.map((id) => (
                  <InteractionTag key={`tag-${id}`} value={String(id)}>
                    <InteractionTagPrimary title={tagById.get(id)?.name}>
                      {tagById.get(id)?.name ?? `#${id}`}
                    </InteractionTagPrimary>
                    <InteractionTagSecondary aria-label={`移除标签 ${tagById.get(id)?.name ?? id}`} />
                  </InteractionTag>
                ))}
                {newNames.map((name) => (
                  <InteractionTag
                    key={`new-${name}`}
                    value={`${NEW_NAME_VALUE_PREFIX}${name}`}
                  >
                    <InteractionTagPrimary icon={<Add16Regular />} title={name}>
                      {name}
                    </InteractionTagPrimary>
                    <InteractionTagSecondary aria-label={`移除新标签 ${name}`} />
                  </InteractionTag>
                ))}
              </TagGroup>
            )}

            <SearchBox
              className={styles.searchBox}
              placeholder="搜索或创建标签"
              value={query}
              onChange={(_, data) => setQuery(data.value)}
              onKeyDown={handleSearchKeyDown}
              disabled={pending}
              aria-label="搜索或创建标签"
            />

            <div className={styles.listScroll}>
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
                        checked={selected.has(tag.id)}
                        disabled={pending}
                        rowClass={styles.row}
                        countClass={styles.count}
                        onToggle={toggle}
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
                      checked={selected.has(tag.id)}
                      disabled={pending}
                      rowClass={styles.row}
                      countClass={styles.count}
                      onToggle={toggle}
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
                  disabled={pending}
                  onClick={() => stageNewName(trimmedQuery)}
                >
                  创建「{trimmedQuery}」
                </Button>
              )}
            </div>

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
                  disabled={pending || busy || ocrEngine === "off"}
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
              <span className={styles.summary}>
                {hasChanges
                  ? `+${addedTagIds.length + newNames.length} / -${removedTagIds.length}`
                  : "未做修改"}
              </span>
              <div className={styles.rightActions}>
                <DialogTrigger disableButtonEnhancement>
                  <Button appearance="subtle" disabled={pending}>取消</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  disabled={!canSubmit || !hasChanges}
                  onClick={() => void handleConfirm()}
                >
                  保存标签
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

interface TagRowProps {
  tag: TagOption;
  checked: boolean;
  disabled: boolean;
  rowClass: string;
  countClass: string;
  onToggle: (id: number) => void;
}

function TagRow({ tag, checked, disabled, rowClass, countClass, onToggle }: TagRowProps) {
  return (
    <label className={rowClass}>
      <Checkbox
        checked={checked}
        onChange={() => onToggle(tag.id)}
        label={tag.name}
        disabled={disabled}
      />
      <span className={countClass}>{tag.count} 张</span>
    </label>
  );
}
