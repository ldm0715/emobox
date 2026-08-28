import { useEffect, useState } from "react";
import { loadThumbnail } from "../../lib/tauri";

const resolvedCache = new Map<string, string>();
const pendingCache = new Map<string, Promise<string>>();

function requestThumbnail(emojiId: number, maxSize: number): Promise<string> {
  const key = `${emojiId}:${maxSize}`;
  const cached = resolvedCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingCache.get(key);
  if (pending) return pending;

  const request = loadThumbnail(emojiId, maxSize)
    .then((source) => {
      resolvedCache.set(key, source);
      pendingCache.delete(key);
      return source;
    })
    .catch((error) => {
      pendingCache.delete(key);
      throw error;
    });

  pendingCache.set(key, request);
  return request;
}

export function useThumbnail(emojiId: number, maxSize: number) {
  const cacheKey = `${emojiId}:${maxSize}`;
  const [source, setSource] = useState<string | null>(() => resolvedCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSource(resolvedCache.get(cacheKey) ?? null);
    setFailed(false);

    requestThumbnail(emojiId, maxSize)
      .then((value) => {
        if (!cancelled) setSource(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, maxSize, emojiId]);

  return { source, failed };
}
