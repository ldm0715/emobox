import cow1 from "../static/抽象草地牛/100000002043.gif";
import cow2 from "../static/抽象草地牛/100000002072.gif";
import cow3 from "../static/抽象草地牛/100000637.jpg";
import cow4 from "../static/抽象草地牛/100000736.jpg";
import cow5 from "../static/抽象草地牛/100000802.jpg";
import cow6 from "../static/抽象草地牛/100000835.jpg";
import cow7 from "../static/抽象草地牛/100001297.jpg";
import cow8 from "../static/抽象草地牛/100002320.jpg";
import cow9 from "../static/抽象草地牛/100002419.png";

import fish1 from "../static/蓝色大肥鱼/100000039.jpg";
import fish2 from "../static/蓝色大肥鱼/100000105.png";
import fish3 from "../static/蓝色大肥鱼/100000174.jpg";
import fish4 from "../static/蓝色大肥鱼/100000240.webp";
import fish5 from "../static/蓝色大肥鱼/100000303.webp";
import fish6 from "../static/蓝色大肥鱼/100000369.png";
import fish7 from "../static/蓝色大肥鱼/100000405.png";
import fish8 from "../static/蓝色大肥鱼/100000468.png";
import fish9 from "../static/蓝色大肥鱼/100000666.webp";

/** 单个贴纸：src 是打包后的静态资源 URL，name 是素材库中显示的文件名。 */
export interface StickerRef {
  src: string;
  name: string;
  gif?: boolean;
}

const cowFiles = [
  { src: cow1, name: "100000002043.gif", gif: true },
  { src: cow2, name: "100000002072.gif", gif: true },
  { src: cow3, name: "100000637.jpg" },
  { src: cow4, name: "100000736.jpg" },
  { src: cow5, name: "100000802.jpg" },
  { src: cow6, name: "100000835.jpg" },
  { src: cow7, name: "100001297.jpg" },
  { src: cow8, name: "100002320.jpg" },
  { src: cow9, name: "100002419.png" },
];

const fishFiles = [
  { src: fish1, name: "100000039.jpg" },
  { src: fish2, name: "100000105.png" },
  { src: fish3, name: "100000174.jpg" },
  { src: fish4, name: "100000240.webp" },
  { src: fish5, name: "100000303.webp" },
  { src: fish6, name: "100000369.png" },
  { src: fish7, name: "100000405.png" },
  { src: fish8, name: "100000468.png" },
  { src: fish9, name: "100000666.webp" },
];

/** 贴纸分组标识与名称（演示 mock 里两个分组的唯一来源）。 */
export type StickerGroup = "cow" | "fish";
export const STICKER_GROUP_LABEL: Record<StickerGroup, string> = {
  cow: "抽象草地牛",
  fish: "蓝色大肥鱼",
};

/**
 * 简化搜索（主窗口 mock 与快捷搜索演示共用）：
 * 空格分隔的多个词全部命中即算；词可来自分组名 / 文件名 / 标签；`*`/`＊`/`:`/`：` 按空格对待。
 */
export function matchStickerQuery(
  raw: string,
  item: { name: string; tags: readonly string[]; groups: readonly StickerGroup[] },
): boolean {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const text = [
    item.name,
    ...item.groups.map((group) => STICKER_GROUP_LABEL[group]),
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .replace(/[＊*:：]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/** 「抽象草地牛」组贴纸。 */
export const COW_STICKERS: StickerRef[] = cowFiles;
/** 「蓝色大肥鱼」组贴纸。 */
export const FISH_STICKERS: StickerRef[] = fishFiles;
/** 全部贴纸（用于全部视图）。 */
export const ALL_STICKERS: StickerRef[] = [...cowFiles, ...fishFiles];
