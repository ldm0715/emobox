import { useEffect, useState } from "react";
import type { IndexedImage } from "../../types";
import { emojiAssetUrl } from "../../lib/tauri";

/** 扩展名是否为 GIF（大小写不敏感）。后端 `animation_status` 对 gif 恒为 Animated。 */
export function isGifExtension(extension: string): boolean {
  return extension.trim().toLowerCase() === "gif";
}

/**
 * 悬停/选中播放 GIF：active 时把 `<img>` 的 src 切到受管原始文件的 asset URL，
 * 失位回落静态缩略图。加载失败置 failed 后本实例内不再重试（避免反复失败请求）。
 */
export function useGifPreview(
  item: Pick<IndexedImage, "path" | "extension">,
  active: boolean,
) {
  const isGif = isGifExtension(item.extension);
  const [failed, setFailed] = useState(false);

  // 换 item（path 变化）时重置失败标记。
  useEffect(() => {
    setFailed(false);
  }, [item.path]);

  const gifSrc = isGif && active && !failed ? emojiAssetUrl(item.path) : null;

  return { gifSrc, handleGifError: () => setFailed(true) };
}
