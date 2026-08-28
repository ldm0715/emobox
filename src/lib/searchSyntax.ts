/**
 * 与 Rust 侧 `EmojiRepository::parse_exact_query` / `list_indexed` 语义一致的
 * 精确搜索语法解析，以及据此过滤最近使用列表的客户端辅助。
 *
 * recent 视图是 ≤50 条的客户端过滤（`recentItems` 是内存事实源），主搜索走后端
 * `search_emojis`；这里只在 recent 视图模拟同样的语法，避免 `组*标签` 在该视图落空。
 */

export interface NamedRow {
  id: number;
  name: string;
}

/** `组名*标签名` 为主（全角 `＊` 归一化），`:` / `：` 保留为别名。 */
export function parseExactQuery(
  query: string,
): { group: string | null; tag: string | null } | null {
  const normalized = query.replace(/：/g, ":").replace(/＊/g, "*");
  const sep = firstSeparator(normalized);
  if (sep === -1) return null;
  const left = normalized.slice(0, sep).trim();
  const right = normalized.slice(sep + 1).trim();
  if (left === "" && right === "") return null;
  return { group: left === "" ? null : left, tag: right === "" ? null : right };
}

interface FilterableItem {
  name: string;
  groupIds: number[];
  tagIds: number[];
}

/**
 * 按查询串过滤，模拟后端 `list_indexed` 的回退阶梯：
 * 精确（组名/标签名 NOCASE 精确）→ 宽松（组精确 + 标签子串）→
 * 模糊组名（组名子串命中 文件名/分组名/标签名 任一 + 标签子串）→ 普通整串子串。
 * 无分隔符时直接走普通子串。返回过滤后的列表。
 */
export function filterItemsByQuery<T extends FilterableItem>(
  items: T[],
  query: string,
  groups: NamedRow[],
  tags: NamedRow[],
): T[] {
  const trimmed = query.trim();
  const parsed = parseExactQuery(trimmed);
  if (!parsed) {
    return trimmed === "" ? items : substringBy(items, trimmed);
  }

  const groupId = parsed.group === null ? null : nameToId(groups, parsed.group);
  const tagId = parsed.tag === null ? null : nameToId(tags, parsed.tag);

  // 精确层：组名/标签名必须存在且 NOCASE 精确匹配。
  if (
    (parsed.group !== null && groupId === null) ||
    (parsed.tag !== null && tagId === null)
  ) {
    return fallthrough(items, parsed, trimmed, groups, tags);
  }
  const exact = items.filter(
    (it) =>
      (groupId === null || it.groupIds.includes(groupId)) &&
      (tagId === null || it.tagIds.includes(tagId)),
  );
  if (exact.length > 0) return exact;

  return fallthrough(items, parsed, trimmed, groups, tags);
}

function fallthrough<T extends FilterableItem>(
  items: T[],
  parsed: { group: string | null; tag: string | null },
  trimmed: string,
  groups: NamedRow[],
  tags: NamedRow[],
): T[] {
  const groupId = parsed.group === null ? null : nameToId(groups, parsed.group);
  // 组名在查询里但库里不存在 → 组精确约束不可满足（与后端一致）。
  const groupUnsatisfiable = parsed.group !== null && groupId === null;
  // 宽松层：组精确 + 标签子串（仅当标签部分存在且组约束可满足）。
  if (parsed.tag !== null && !groupUnsatisfiable) {
    const lenient = items.filter((it) => {
      if (groupId !== null && !it.groupIds.includes(groupId)) return false;
      return itemHasTagContaining(it, tags, parsed.tag!);
    });
    if (lenient.length > 0) return lenient;
  }
  // FuzzyGroup 层：组名子串命中 文件名/分组名/标签名 任一，再叠加标签子串。
  if (parsed.group !== null) {
    const fuzzy = items.filter((it) => {
      if (!itemMatchesGroupTerm(it, groups, tags, parsed.group!)) return false;
      if (parsed.tag !== null && !itemHasTagContaining(it, tags, parsed.tag!)) return false;
      return true;
    });
    if (fuzzy.length > 0) return fuzzy;
  }
  // 最终层：普通整串子串（与后端 PlainLike 一致）。
  return substringBy(items, trimmed);
}

function itemMatchesGroupTerm<T extends FilterableItem>(
  item: T,
  groups: NamedRow[],
  tags: NamedRow[],
  term: string,
): boolean {
  const lower = term.toLocaleLowerCase();
  if (item.name.toLocaleLowerCase().includes(lower)) return true;
  const groupHit = item.groupIds.some((id) => {
    const row = groups.find((g) => g.id === id);
    return row !== undefined && row.name.toLocaleLowerCase().includes(lower);
  });
  if (groupHit) return true;
  return item.tagIds.some((id) => {
    const row = tags.find((t) => t.id === id);
    return row !== undefined && row.name.toLocaleLowerCase().includes(lower);
  });
}

function firstSeparator(normalized: string): number {
  const star = normalized.indexOf("*");
  const colon = normalized.indexOf(":");
  if (star === -1) return colon;
  if (colon === -1) return star;
  return Math.min(star, colon);
}

function nameToId(rows: NamedRow[], name: string): number | null {
  const lower = name.toLocaleLowerCase();
  return rows.find((row) => row.name.toLocaleLowerCase() === lower)?.id ?? null;
}

function itemHasTagContaining<T extends FilterableItem>(
  item: T,
  tags: NamedRow[],
  fragment: string,
): boolean {
  const lower = fragment.toLocaleLowerCase();
  return item.tagIds.some((id) => {
    const row = tags.find((tag) => tag.id === id);
    return row !== undefined && row.name.toLocaleLowerCase().includes(lower);
  });
}

function substringBy<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.toLocaleLowerCase();
  return items.filter((it) => it.name.toLocaleLowerCase().includes(q));
}
