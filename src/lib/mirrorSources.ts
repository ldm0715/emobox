/**
 * GitHub 加速镜像源（Phase 27）。
 *
 * 镜像是 gh-proxy 风格的前缀代理：拼接方式为 `镜像前缀 + 完整 GitHub 文件
 * URL`（如 `https://gh-proxy.com/https://github.com/.../releases/download/...`）。
 * 检查更新与下载安装包按用户列表顺序尝试，官方直连永远在末尾兜底（Rust 侧
 * `updater::candidate_urls` 负责）。列表持久化在 ThemeProvider 的
 * `emobox.settings`。
 */

/** 默认镜像源（首次使用时种子；用户可增删，可「恢复默认」）。 */
export const DEFAULT_UPDATE_MIRRORS = [
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
  "https://ghfast.top/",
];

/**
 * 规范化用户输入的镜像地址：去首尾空白、去掉多余的尾斜杠后统一补一个 `/`。
 * 须经 URL 解析且为 http(s)、有主机名（拒绝空壳 "https://"）；不合法返回
 * null（由调用方提示错误）。
 */
export function normalizeMirror(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname) return null;
  } catch {
    return null;
  }
  return `${trimmed.replace(/\/+$/, "")}/`;
}

/** 镜像列表的持久化校验：字符串数组且每项非空。 */
export function isMirrorList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

/** 展示用主机名（解析失败回退原文）。 */
export function mirrorHost(mirror: string): string {
  try {
    return new URL(mirror).host;
  } catch {
    return mirror;
  }
}
