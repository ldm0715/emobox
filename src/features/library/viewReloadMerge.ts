import type { IndexedEmoji } from "../../types";

/**
 * 同 key 重拉（标签操作 / OCR 批末 / viewReloadTick 触发的视图 effect 重拉）
 * 的落地合并：沿用 previous 的顺序与对象身份，只吸收数据变化。
 *
 * 为什么不是整组替换：后端每次返回全新对象，整组替换会让 viewItems /
 * tagsByPath 的 WeakMap 投影缓存全部 miss、整网格 React.memo 失效重渲染，
 * DOM 锚点在同一个 commit 里被换掉 —— 滚动锚定失效、网格「莫名下滑/跳位」
 * （2026-09 真机复现，标签弹窗每次写操作都触发）。真视图/搜索/排序切换
 * （landingKey 变化）仍走整组替换，不经此函数。
 *
 * 合并规则：
 * - previous 中 id 仍在 incoming：name / isFavorite / tagIds 未变 → 复用旧
 *   对象引用（缓存命中、memo 不失效）；有变 → 取 incoming 对象；
 * - previous 中 id 不在 incoming（被过滤/删除）→ 丢弃；
 * - incoming 中 previous 没有的 id（新匹配项）→ 追加到尾部。
 *
 * 注意有意取舍：保序意味着 modified-time 排序下「被编辑项跳到顶部」要等
 * 下一次真切换（landingKey 变化）才生效 —— 与「网格不跳」诉求一致。
 */
export function mergeReloadedItems(
  previous: IndexedEmoji[],
  incoming: IndexedEmoji[],
): IndexedEmoji[] {
  if (previous.length === 0) return incoming;
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged: IndexedEmoji[] = [];
  const reusedIds = new Set<number>();
  for (const oldItem of previous) {
    const freshItem = incomingById.get(oldItem.id);
    if (!freshItem) continue; // 已被过滤/删除：丢弃
    reusedIds.add(oldItem.id);
    merged.push(itemUnchanged(oldItem, freshItem) ? oldItem : freshItem);
  }
  for (const freshItem of incoming) {
    if (!reusedIds.has(freshItem.id)) merged.push(freshItem);
  }
  return merged;
}

/** 显示相关字段相等则视为未变化（其余字段不影响网格渲染与投影缓存）。 */
function itemUnchanged(oldItem: IndexedEmoji, freshItem: IndexedEmoji): boolean {
  return (
    oldItem === freshItem ||
    (oldItem.name === freshItem.name &&
      oldItem.isFavorite === freshItem.isFavorite &&
      arraysEqual(oldItem.tagIds, freshItem.tagIds))
  );
}

function arraysEqual(left: number[], right: number[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
