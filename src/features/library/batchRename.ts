/**
 * 表情重命名的纯函数辅助：扩展名处理、名称校验（Rust 侧
 * `EmojiRepository::validate_display_filename` 的前端镜像）与批量模板编号。
 * 显示名与磁盘文件（sha256.ext）解耦——这里只处理字符串，不碰文件。
 */

/** Windows 文件名非法字符（显示名不落盘，但按用户文件名预期校验）。 */
const INVALID_FILENAME_CHARS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

const MAX_FILENAME_LEN = 255;

/**
 * 剥掉最后一个扩展名段：`鲸鱼.abc123.png` → `鲸鱼.abc123`。
 * 无 `.` 或以 `.` 开头（点文件）→ 原样返回（`stripExtension("png")` 不会
 * 把扩展名误当主名剥掉）。
 */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return filename;
  return filename.slice(0, dot);
}

/** 规范化扩展名：去前导点、转小写（`PNG` / `.png` → `png`）。 */
export function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\.+/, "").toLowerCase();
}

/**
 * 校验重命名主名 / 批量模板。合法返回 null，非法返回中文错误消息。
 * 规则与 Rust `validate_display_filename` 一致（空名 / 非法字符 / 控制字符 /
 * 255 上限），Rust 侧兜底。
 */
export function validateRenameStem(stem: string): string | null {
  const trimmed = stem.trim();
  if (trimmed.length === 0) return "名称不能为空。";
  if (trimmed.length > MAX_FILENAME_LEN) {
    return `名称不能超过 ${MAX_FILENAME_LEN} 个字符。`;
  }
  for (const ch of trimmed) {
    if (INVALID_FILENAME_CHARS.includes(ch)) return `名称不能包含字符「${ch}」。`;
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) return "名称不能包含控制字符。";
  }
  return null;
}

/**
 * 批量模板编号：`模板1.ext`、`模板2.ext`…**全部编号、无裸名项**。
 * 顺序 = extensions 数组顺序（调用方保证 = 当前视图排序）。
 * 各项保留自己的扩展名；空扩展名不加 `.`。
 */
export function buildBatchFilenames(template: string, extensions: string[]): string[] {
  const base = template.trim();
  return extensions.map(
    (extension, index) =>
      `${base}${index + 1}${extension ? `.${normalizeExtension(extension)}` : ""}`,
  );
}
