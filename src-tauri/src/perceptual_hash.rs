//! 感知哈希：dHash（差异哈希），用于跨格式/分辨率的内容去重。
//!
//! dHash 把图像缩放到 9×8 灰度，比较每行相邻像素的明暗，产出 64 bit。
//! 两图 Hamming 距离越小越相似。这里的用途是识别"内容相同的副本"
//! （同一图的不同格式 / 分辨率 / 元数据），而不是相似度排序，因此阈值取
//! 保守的 [`PERCEPTUAL_HASH_THRESHOLD`]。
//!
//! 注意：dHash 是感知哈希，视觉相似但业务不同的图（加字、变色、裁剪等）
//! **可能**被判接近。这不构成缺陷——调用方（`ImportService`）把感知命中
//! 当作"疑似重复"处理，保留候选信息供用户强制导入（见
//! `ImportOneOutcome::PerceptualDuplicate` 与 `skip_perceptual_dedup`）。

use image::DynamicImage;

/// 感知重复阈值：dHash 64 bit 中 Hamming 距离 ≤ 4 视为疑似同图。
///
/// 保守设定：真实副本（跨格式/分辨率/EXIF）通常在 0–3；视觉相似但不同
/// 的图可能落在 0–4 区间，因此命中被标记为"疑似"而非直接吞掉。
pub const PERCEPTUAL_HASH_THRESHOLD: u32 = 4;

/// 计算一张已解码图像的 64-bit dHash。
///
/// 输入应是"业务上正确的朝向"（EXIF 已应用、动画取首帧）的解码结果，
/// 与 `AssetService::decode_for_import` 保持一致，保证跨格式/分辨率稳定。
pub fn dhash(image: &DynamicImage) -> u64 {
    // resize_exact 强制 9×8（resize 会保宽高比，非方图可能得到 9×6 之类，
    // 导致相邻比较越界）。dHash 比较空间固定为 9×8 才能跨格式/分辨率一致。
    let small = image.resize_exact(9, 8, image::imageops::FilterType::Lanczos3);
    let gray = small.to_luma8();
    let mut hash = 0u64;
    let mut bit = 0u32;
    for y in 0..8 {
        for x in 0..8 {
            let left = gray.get_pixel(x, y).0[0];
            let right = gray.get_pixel(x + 1, y).0[0];
            if left > right {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    hash
}

/// 两个 64-bit dHash 的 Hamming 距离（不同 bit 数量）。
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// u64 → i64 **位保持**转换，用于把 dHash 存进 SQLite INTEGER。
///
/// 不做 `as` 数值转换，避免语义歧义；用字节重解释保证往返一致。
pub fn to_db(hash: u64) -> i64 {
    i64::from_ne_bytes(hash.to_ne_bytes())
}

/// i64 → u64 **位保持**转换，从 SQLite INTEGER 读回 dHash。
pub fn from_db(value: i64) -> u64 {
    u64::from_ne_bytes(value.to_ne_bytes())
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgba, RgbaImage};

    use super::{PERCEPTUAL_HASH_THRESHOLD, dhash, from_db, hamming_distance, to_db};

    /// 生成确定性测试图：带棋盘格结构的 RGBA。
    fn pattern(width: u32, height: u32, cell: u32, base: u8) -> DynamicImage {
        let mut img = RgbaImage::new(width, height);
        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let checker = ((x / cell + y / cell) % 2) as u8;
            *pixel = Rgba([
                (base as u16 + u16::from(checker) * 60).min(255) as u8,
                (base as u16 + u16::from((x % 2) as u8) * 30).min(255) as u8,
                200,
                255,
            ]);
        }
        DynamicImage::ImageRgba8(img)
    }

    /// 构造纯随机纹理（固定种子，确定性）。
    fn noise(width: u32, height: u32, seed: u32) -> DynamicImage {
        let mut state = seed.wrapping_mul(2654435761).wrapping_add(1);
        let mut img = RgbaImage::new(width, height);
        for (_, _, pixel) in img.enumerate_pixels_mut() {
            state = state
                .wrapping_mul(1103515245)
                .wrapping_add(12345);
            let v = (state >> 16) as u8;
            *pixel = Rgba([v, v ^ 0x55, v ^ 0xaa, 255]);
        }
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn dhash_is_deterministic() {
        let img = pattern(64, 64, 8, 40);
        assert_eq!(dhash(&img), dhash(&img));
    }

    #[test]
    fn must_match_same_content_cross_resolution() {
        // 相同图案在不同分辨率下，dHash 应 ≤ 阈值（"必须命中"样本）。
        let small = pattern(64, 64, 8, 40);
        let large = pattern(512, 512, 64, 40);
        let distance = hamming_distance(dhash(&small), dhash(&large));
        assert!(
            distance <= PERCEPTUAL_HASH_THRESHOLD,
            "同内容跨分辨率距离应为 {distance} ≤ {PERCEPTUAL_HASH_THRESHOLD}"
        );
    }

    #[test]
    fn must_distinguish_clearly_different() {
        // 两张完全不同的纹理，dHash 应明显远离（"必须区分"样本）。
        let a = noise(128, 128, 1);
        let b = noise(128, 128, 2);
        let distance = hamming_distance(dhash(&a), dhash(&b));
        assert!(
            distance > PERCEPTUAL_HASH_THRESHOLD,
            "明显不同图距离应为 {distance} > {PERCEPTUAL_HASH_THRESHOLD}"
        );
    }

    #[test]
    fn record_only_similar_but_different() {
        // "相似但业务可能不同"的样本：不断言，仅打印距离供阈值调整。
        // 加文字 / 变色 / 背景替换 / 轻微裁剪 在此统一用 取色带差异 近似。
        let base = pattern(128, 128, 16, 40);
        let recolored = pattern(128, 128, 16, 200); // 变色
        let cropped = pattern(96, 96, 16, 40); // 轻微裁剪（同一图案缩尺寸）
        let distance_color = hamming_distance(dhash(&base), dhash(&recolored));
        let distance_crop = hamming_distance(dhash(&base), dhash(&cropped));
        println!(
            "[record-only] recolored distance={distance_color}, cropped distance={distance_crop}"
        );
    }

    #[test]
    fn hamming_distance_basics() {
        assert_eq!(hamming_distance(0xff00, 0xff00), 0);
        assert_eq!(hamming_distance(0xff, 0x00), 8);
        assert_eq!(hamming_distance(0, u64::MAX), 64);
    }

    #[test]
    fn u64_i64_high_bit_round_trip() {
        // 最高位为 1 的哈希，位保持往返必须相等（不能被 `as` 数值转换破坏）。
        let hash = 0x8000_0000_0000_0001u64;
        assert_eq!(from_db(to_db(hash)), hash);
        assert_eq!(to_db(u64::from_ne_bytes((-1i64).to_ne_bytes())), -1);
    }
}
