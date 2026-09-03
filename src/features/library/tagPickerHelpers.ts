// TagPickerDialog（Phase 33 重设计）的纯函数：常用标签排序、搜索过滤、
// OCR 识别结果合并。抽出来便于 vitest 覆盖，组件只做渲染。

import type { OcrEngineKind } from "../../types";

export interface TagOption {
  id: number;
  name: string;
  count: number;
}

/** 搜索结果行数上限：超出时提示用户继续输入缩小范围。 */
export const TAG_SEARCH_RESULT_LIMIT = 50;

/** 空查询时的「常用标签」展示数量（按使用次数降序）。 */
export const POPULAR_TAGS_COUNT = 12;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** 常用标签：按 count 降序，同数按名称 NOCASE 升序（码元比较，跨 locale 确定性）。 */
export function sortPopularTags(tags: readonly TagOption[]): TagOption[] {
  return [...tags].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return 0;
  });
}

export interface TagSearchResult {
  items: TagOption[];
  /** 被上限截掉的数量（0 = 全部展示）。 */
  hiddenCount: number;
}

/** NOCASE 子串过滤 + 行数上限。空查询返回空结果（调用方改走常用标签）。 */
export function filterTagsByQuery(
  tags: readonly TagOption[],
  query: string,
  limit = TAG_SEARCH_RESULT_LIMIT,
): TagSearchResult {
  const normalized = normalizeName(query);
  if (normalized.length === 0) {
    return { items: [], hiddenCount: 0 };
  }
  const items: TagOption[] = [];
  let hiddenCount = 0;
  for (const tag of tags) {
    if (!tag.name.toLowerCase().includes(normalized)) continue;
    if (items.length >= limit) {
      hiddenCount += 1;
      continue;
    }
    items.push(tag);
  }
  return { items, hiddenCount };
}

/** NOCASE 精确查找（决定搜索词展示「创建」行、Enter 是选中还是新建）。 */
export function findExactTag(
  tags: readonly TagOption[],
  name: string,
): TagOption | undefined {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return undefined;
  return tags.find((tag) => tag.name.toLowerCase() === normalized);
}

/** 暂存新标签名前的 NOCASE 查重：与已有标签、已暂存的其他新名都不重复。 */
export function canStageNewTagName(
  newNames: readonly string[],
  tags: readonly TagOption[],
  name: string,
): boolean {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return false;
  if (findExactTag(tags, name) !== undefined) return false;
  return !newNames.some((existing) => existing.toLowerCase() === normalized);
}

/**
 * 手动识别批末合并：把各表情标签交集并入 selected。
 * 不复活用户已手动反选的标签：merged = selected ∪ (common − (initial − selected))。
 */
export function mergeOcrSelection(
  selected: ReadonlySet<number>,
  commonTagIds: readonly number[],
  initialTagIds: readonly number[],
): Set<number> {
  const initial = new Set(initialTagIds);
  const removed = new Set([...initial].filter((id) => !selected.has(id)));
  const next = new Set(selected);
  for (const id of commonTagIds) {
    if (!removed.has(id)) next.add(id);
  }
  return next;
}

/** 各表情 tagIds 的交集（手动识别后弹窗只把「所有目标表情都有」的标签并入选中集）。 */
export function intersectTagIds(rows: readonly { tagIds: number[] }[]): number[] {
  if (rows.length === 0) return [];
  const sets = rows.map((row) => new Set(row.tagIds));
  const common: number[] = [];
  for (const id of sets[0]) {
    if (sets.every((set) => set.has(id))) common.push(id);
  }
  return common;
}

/** 各表情 tagIds 的并集（左栏「当前标签」展示所有选中表情的标签全集）。 */
export function unionTagIds(rows: readonly { tagIds: number[] }[]): number[] {
  const seen = new Set<number>();
  for (const row of rows) {
    for (const id of row.tagIds) seen.add(id);
  }
  return [...seen];
}

/**
 * 全局删除标签后的选中集同步：从 selected 移除该 id，同时把它从 initial
 * 基准集剔除（标签已全局消失，无需再出现在 removedTagIds 里让后端 remove——
 * 行不存在，remove 是无操作；从基准剔除可避免 footer 误计入一个「−」）。
 */
export function removeDeletedTag(
  selected: ReadonlySet<number>,
  initialTagIds: readonly number[],
  deletedId: number,
): { selected: Set<number>; initialTagIds: number[] } {
  const nextSelected = new Set(selected);
  nextSelected.delete(deletedId);
  return {
    selected: nextSelected,
    initialTagIds: initialTagIds.filter((id) => id !== deletedId),
  };
}

/**
 * 行内重命名是否可提交：trim 非空、与原名不同（NOCASE 相同只是改大小写也
 * 允许——后端唯一约束是 NOCASE，改名本身合法），且不与暂存新名重复。
 */
export function canSubmitRename(
  currentName: string,
  inputName: string,
  newNames: readonly string[] = [],
): boolean {
  const trimmed = inputName.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === currentName.trim()) return false;
  return !newNames.some((name) => name.toLowerCase() === trimmed.toLowerCase());
}

/** 手动识别批次的累计统计（`ocr-tags-updated` payload 的相关字段）。 */
export interface OcrBatchStats {
  /** 已完成识别尝试的行数（= tagged + empty + failed）。 */
  processed: number;
  total: number;
  /** 识别成功且提取到至少一个标签的行数。 */
  tagged: number;
  /** 识别成功但未提取出任何标签的行数（无文字或文字被标签规则过滤）。 */
  empty: number;
  /** 识别失败的行数（云端错误中止整批时不计入）。 */
  failed: number;
}

export type OcrNoticeIntent = "info" | "warning" | "error";

export interface OcrNotice {
  intent: OcrNoticeIntent;
  text: string;
}

/**
 * 识别批末的提示文案。约定：
 * - 全部成功且有标签 → null（chips 出现即是反馈）；
 * - 全部成功但无标签 → info「识别成功，但未识别出可用文字」（Windows 引擎
 *   附切换 AI Studio 的建议、Tesseract 附检查语言包的建议——两者本地 OCR
 *   效果有限，语言包缺失是该场景的常见原因）；
 * - 全部失败 → error；部分失败 / 云端中止 → warning 汇总。
 */
export function buildOcrNotice(
  stats: OcrBatchStats,
  engine: OcrEngineKind,
): OcrNotice | null {
  const unfinished = stats.processed < stats.total;

  if (stats.processed === 0) {
    return {
      intent: "warning",
      text: "未能开始识别：图片无法读取或引擎不可用，请检查设置中的 OCR 引擎",
    };
  }

  if (stats.failed === 0 && !unfinished) {
    if (stats.tagged === 0) {
      const suffix =
        engine === "windows"
          ? "。Windows 本地 OCR 效果有限，可在设置中切换 AI Studio 引擎后重试"
          : engine === "tesseract"
            ? "。Tesseract 的识别效果依赖语言包，请确认已安装中文（chi_sim）与英文（eng）语言数据"
            : "";
      return { intent: "info", text: `识别成功，但未从图片中识别出可用的文字${suffix}` };
    }
    return null;
  }

  if (stats.failed > 0 && stats.tagged === 0 && stats.empty === 0 && !unfinished) {
    return {
      intent: "error",
      text: `识别失败：${stats.failed}/${stats.total} 张未能识别，请检查引擎设置后重试`,
    };
  }

  const parts: string[] = [];
  if (stats.tagged > 0) parts.push(`${stats.tagged} 张提取到标签`);
  if (stats.empty > 0) parts.push(`${stats.empty} 张未识别出文字`);
  if (stats.failed > 0) parts.push(`${stats.failed} 张失败`);
  if (unfinished) parts.push(`中止于 ${stats.processed}/${stats.total} 张`);
  const head = stats.failed > 0 ? "识别部分完成" : "识别提前中止";
  return { intent: "warning", text: `${head}：${parts.join("，")}，可检查引擎设置后重试` };
}
