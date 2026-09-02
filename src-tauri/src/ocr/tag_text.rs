//! 从 OCR 识别文本提取候选标签的纯函数（Phase 32）。
//!
//! 表情包图内文字通常是一行短句（"开心" / "哈哈哈哈哈"），没有分词器就
//! 不切词——一行文本整体作为一个标签。规则刻意保守：宁缺勿滥，脏标签
//! 会污染侧栏标签列表和精确搜索语法 `组*标签`。文件名标签（兜底）与此
//! 逻辑无关，仍在导入链路单独打。

/// 单个标签的最大字符数（chars 计，CJK 安全）。更长的行截断保留前缀——
/// 截断后的标签仍能被子串回退搜索（标签 LIKE）命中。
const MAX_TAG_CHARS: usize = 24;

/// 每张表情最多打多少个 OCR 标签。
const MAX_TAGS: usize = 5;

/// 单个字符标签太泛（搜索会命中整库），丢弃。
const MIN_TAG_CHARS: usize = 2;

/// 常见 CJK 标点/装饰符号（用于掐头去尾与"纯符号"判定）。
const CJK_PUNCTUATION: &str =
    "。，、；：？！…—～·ˉ¨´‘’“”「」『』（）〈〉《》【】〔〕｛｝［］＜＞※§℃℉°′″♪♫♡♥★☆→←↑↓◆◇○●□■△▲";

fn is_punctuation_or_space(c: char) -> bool {
    c.is_whitespace() || c.is_ascii_punctuation() || CJK_PUNCTUATION.contains(c)
}

fn is_url(line: &str) -> bool {
    let lowered = line.to_lowercase();
    lowered.starts_with("http://") || lowered.starts_with("https://") || lowered.starts_with("www.")
}

fn is_all_symbols(line: &str) -> bool {
    !line.is_empty() && line.chars().all(is_punctuation_or_space_or_numeric)
}

fn is_punctuation_or_space_or_numeric(c: char) -> bool {
    is_punctuation_or_space(c) || c.is_numeric()
}

/// 从 OCR 文本行提取候选标签：trim → 掐掉首尾标点 → 过滤（URL / 纯数字符号 /
/// 长度下限）→ 超长截断 → NOCASE 去重 → 最多 [`MAX_TAGS`] 个。
pub fn extract_tags(lines: &[String]) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for line in lines {
        let candidate = line.trim().trim_matches(is_punctuation_or_space);
        if candidate.chars().count() < MIN_TAG_CHARS
            || is_url(candidate)
            || is_all_symbols(candidate)
        {
            continue;
        }
        let truncated: String = candidate.chars().take(MAX_TAG_CHARS).collect();
        let truncated = truncated.trim_end().to_string();
        if truncated.is_empty() {
            continue;
        }
        let duplicated = tags
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&truncated));
        if !duplicated {
            tags.push(truncated);
        }
        if tags.len() >= MAX_TAGS {
            break;
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::extract_tags;

    #[test]
    fn keeps_short_chinese_line_whole() {
        assert_eq!(
            extract_tags(&["哈哈哈哈哈".to_string()]),
            vec!["哈哈哈哈哈"]
        );
        assert_eq!(
            extract_tags(&["我不管我要抱抱".to_string()]),
            vec!["我不管我要抱抱"]
        );
    }

    #[test]
    fn strips_surrounding_punctuation_and_quotes() {
        assert_eq!(extract_tags(&["「开心！」".to_string()]), vec!["开心"]);
        assert_eq!(extract_tags(&["--求抱抱--".to_string()]), vec!["求抱抱"]);
        assert_eq!(extract_tags(&["★生气★".to_string()]), vec!["生气"]);
    }

    #[test]
    fn drops_single_char_tags() {
        assert!(extract_tags(&["好".to_string()]).is_empty());
    }

    #[test]
    fn drops_pure_numbers_and_symbols() {
        assert!(extract_tags(&["2026".to_string()]).is_empty());
        assert!(extract_tags(&["！！！".to_string()]).is_empty());
        assert!(extract_tags(&["6.6".to_string()]).is_empty());
    }

    #[test]
    fn drops_urls() {
        assert!(extract_tags(&["https://example.com/a.png".to_string()]).is_empty());
        assert!(extract_tags(&["WWW.EXAMPLE.COM".to_string()]).is_empty());
    }

    #[test]
    fn dedups_case_insensitively_keeping_first_form() {
        assert_eq!(
            extract_tags(
                &["Happy".to_string(), "happy".to_string(),]
                    .iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
            ),
            vec!["Happy"]
        );
    }

    #[test]
    fn caps_tag_count() {
        let lines: Vec<String> = ["-alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let tags = extract_tags(&lines);
        assert_eq!(tags.len(), 5);
        assert_eq!(tags.last().unwrap(), "epsilon");
    }

    #[test]
    fn truncates_overlong_lines() {
        let long =
            "这是一条特别特别长的句子用来验证标签截断行为是否正确还没有结束继续凑长度".to_string();
        let tags = extract_tags(&[long]);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].chars().count(), 24);
    }

    #[test]
    fn keeps_internal_spaces_and_numbers() {
        assert_eq!(
            extract_tags(&["good morning friend".to_string()]),
            vec!["good morning friend"]
        );
        assert_eq!(extract_tags(&["上班第3年".to_string()]), vec!["上班第3年"]);
    }

    #[test]
    fn empty_and_blank_input_yield_no_tags() {
        assert!(extract_tags(&[]).is_empty());
        assert!(extract_tags(&["   ".to_string(), "".to_string()]).is_empty());
    }
}
