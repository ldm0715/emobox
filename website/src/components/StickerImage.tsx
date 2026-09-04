import { useEffect, useState } from "react";

/**
 * 贴纸缩略图：GIF 时先取首帧作静态封面，鼠标悬停才播放动画
 * （与真实应用「悬停播放」一致）。静态图直接渲染原图。
 */
export function StickerImage(props: {
  src: string;
  gif?: boolean;
  className?: string;
  alt?: string;
}) {
  const { src, gif } = props;
  // GIF 首帧的 dataURL 封面；null = 尚未截好
  const [poster, setPoster] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!gif) return;
    let cancelled = false;
    setPoster(null);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        if (!cancelled) setPoster(canvas.toDataURL("image/png"));
      } catch {
        /* 跨域/异常时放弃封面，直接显示 gif */
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, gif]);

  if (!gif) {
    return <img className={props.className} src={src} alt={props.alt ?? ""} draggable={false} loading="lazy" />;
  }

  // 悬停播放 gif；未悬停时显示首帧封面（封面截好前先隐藏，避免动图一闪）
  return (
    <img
      className={props.className}
      src={hover ? src : (poster ?? undefined)}
      alt={props.alt ?? ""}
      draggable={false}
      loading="lazy"
      style={{ visibility: hover || poster ? "visible" : "hidden" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
}
