import { useEffect, useState } from "react";

const RELEASE_API = "https://api.github.com/repos/ldm0715/emobox/releases/latest";
// GitHub API 不可达时的回退版本号（发布新版本时与 website/package.json 同步更新）。
const FALLBACK_VERSION = "0.1.2";

export interface ReleaseInfo {
  version: string;
  setupName: string;
  zipName: string;
  setupUrl: string;
  zipUrl: string;
}

/** GitHub API 不可达时的回退：用本地版本号按固定命名规则拼直链。 */
function fallbackRelease(): ReleaseInfo {
  const base = `https://github.com/ldm0715/emobox/releases/download/v${FALLBACK_VERSION}`;
  return {
    version: FALLBACK_VERSION,
    setupName: `EmoBox_${FALLBACK_VERSION}_x64-setup.exe`,
    zipName: `EmoBox_${FALLBACK_VERSION}_x64.zip`,
    setupUrl: `${base}/EmoBox_${FALLBACK_VERSION}_x64-setup.exe`,
    zipUrl: `${base}/EmoBox_${FALLBACK_VERSION}_x64.zip`,
  };
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: {
    tag_name?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  } = await res.json();
  const version = (data.tag_name ?? "").replace(/^v/, "");
  const assets = (data.assets ?? []).filter(
    (asset): asset is { name: string; browser_download_url: string } =>
      typeof asset.name === "string" && typeof asset.browser_download_url === "string",
  );
  const setup =
    assets.find((asset) => asset.name.endsWith("x64-setup.exe")) ??
    assets.find((asset) => asset.name.endsWith(".exe"));
  const zip =
    assets.find((asset) => asset.name.endsWith("x64.zip")) ??
    assets.find((asset) => asset.name.endsWith(".zip"));
  if (!version || (!setup && !zip)) throw new Error("release assets missing");
  return {
    version,
    setupName: setup?.name ?? `EmoBox_${version}_x64-setup.exe`,
    zipName: zip?.name ?? `EmoBox_${version}_x64.zip`,
    setupUrl:
      setup?.browser_download_url ??
      `https://github.com/ldm0715/emobox/releases/download/v${version}/EmoBox_${version}_x64-setup.exe`,
    zipUrl:
      zip?.browser_download_url ??
      `https://github.com/ldm0715/emobox/releases/download/v${version}/EmoBox_${version}_x64.zip`,
  };
}

// 模块级缓存：页面多个组件（顶部导航、下载区）共享同一次请求。
let cachedRelease: ReleaseInfo | null = null;
let inflight: Promise<ReleaseInfo> | null = null;

function getLatestRelease(): Promise<ReleaseInfo> {
  if (cachedRelease) return Promise.resolve(cachedRelease);
  inflight ??= fetchLatestRelease()
    .then((release) => {
      cachedRelease = release;
      return release;
    })
    .catch(() => fallbackRelease());
  return inflight;
}

/** 最新版本信息：初始为本地回退值，GitHub API 拉取成功后静默更新。 */
export function useLatestRelease(): ReleaseInfo {
  const [release, setRelease] = useState<ReleaseInfo>(() => cachedRelease ?? fallbackRelease());

  useEffect(() => {
    if (cachedRelease) return;
    let cancelled = false;
    getLatestRelease().then((release) => {
      if (!cancelled) setRelease(release);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return release;
}
