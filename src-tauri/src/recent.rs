use std::{
    cmp::Reverse,
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::scanner;

const RECENT_IMAGE_LIMIT: usize = 50;
const RECENT_IMAGES_FILE_NAME: &str = "recent-images.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentImageRecord {
    pub item: scanner::IndexedImage,
    pub last_used_at: u64,
    pub use_count: u64,
    #[serde(default)]
    pub group_ids: Vec<i64>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

pub struct RecentImagesState {
    storage_path: PathBuf,
    records: RwLock<Vec<RecentImageRecord>>,
}

impl RecentImagesState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let storage_path = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位应用数据目录：{error}"))?
            .join(RECENT_IMAGES_FILE_NAME);
        let records = load_records(&storage_path);

        Ok(Self {
            storage_path,
            records: RwLock::new(records),
        })
    }

    pub fn records(&self) -> Result<Vec<RecentImageRecord>, String> {
        self.records
            .read()
            .map(|records| records.clone())
            .map_err(|_| "最近使用记录暂时不可用，请重启应用后重试。".to_string())
    }

    pub fn find_item(&self, path: &str) -> Result<Option<scanner::IndexedImage>, String> {
        self.records
            .read()
            .map(|records| {
                records
                    .iter()
                    .find(|record| record.item.path == path)
                    .map(|record| record.item.clone())
            })
            .map_err(|_| "最近使用记录暂时不可用，请重启应用后重试。".to_string())
    }

    pub fn record(&self, item: scanner::IndexedImage) -> Result<RecentImageRecord, String> {
        let mut records = self
            .records
            .write()
            .map_err(|_| "图片已复制，但最近使用记录暂时不可用。".to_string())?;
        let next_records = record_recent_image(records.clone(), item, unix_time_millis());
        persist_records(&self.storage_path, &next_records)?;
        let newest = next_records
            .first()
            .cloned()
            .ok_or_else(|| "图片已复制，但最近使用记录更新失败。".to_string())?;
        *records = next_records;
        Ok(newest)
    }
}

fn load_records(path: &Path) -> Vec<RecentImageRecord> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            log::warn!("无法读取最近使用记录 {}：{error}", path.display());
            return Vec::new();
        }
    };

    let mut records = match serde_json::from_slice::<Vec<RecentImageRecord>>(&bytes) {
        Ok(records) => records,
        Err(error) => {
            log::warn!("最近使用记录格式无效 {}：{error}", path.display());
            return Vec::new();
        }
    };

    records.sort_by_key(|record| Reverse(record.last_used_at));
    records.dedup_by(|left, right| left.item.path == right.item.path);
    records.truncate(RECENT_IMAGE_LIMIT);
    records
}

fn persist_records(path: &Path, records: &[RecentImageRecord]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "最近使用记录路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建最近使用记录目录：{error}"))?;
    let bytes = serde_json::to_vec_pretty(records)
        .map_err(|error| format!("无法序列化最近使用记录：{error}"))?;
    fs::write(path, bytes).map_err(|error| format!("无法保存最近使用记录：{error}"))
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn record_recent_image(
    mut records: Vec<RecentImageRecord>,
    item: scanner::IndexedImage,
    used_at: u64,
) -> Vec<RecentImageRecord> {
    let use_count = records
        .iter()
        .find(|record| record.item.path == item.path)
        .map(|record| record.use_count.saturating_add(1))
        .unwrap_or(1);

    records.retain(|record| record.item.path != item.path);
    records.insert(
        0,
        RecentImageRecord {
            item,
            last_used_at: used_at,
            use_count,
            group_ids: Vec::new(),
            tag_ids: Vec::new(),
        },
    );
    records.truncate(RECENT_IMAGE_LIMIT);
    records
}

#[cfg(test)]
mod tests {
    use super::{RECENT_IMAGE_LIMIT, RecentImageRecord, record_recent_image};
    use crate::scanner::IndexedImage;

    fn image(path: &str) -> IndexedImage {
        IndexedImage {
            name: format!("{path}.png"),
            path: path.to_string(),
            extension: "png".to_string(),
            width: 64,
            height: 64,
            size_bytes: 128,
        }
    }

    #[test]
    fn repeated_use_moves_item_to_front_and_increments_count() {
        let records = record_recent_image(Vec::new(), image("first"), 10);
        let records = record_recent_image(records, image("second"), 20);
        let records = record_recent_image(records, image("first"), 30);

        assert_eq!(records[0].item.path, "first");
        assert_eq!(records[0].last_used_at, 30);
        assert_eq!(records[0].use_count, 2);
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn recent_records_are_limited() {
        let mut records = Vec::new();
        for index in 0..=RECENT_IMAGE_LIMIT {
            records = record_recent_image(records, image(&format!("image-{index}")), index as u64);
        }

        assert_eq!(records.len(), RECENT_IMAGE_LIMIT);
        assert_eq!(records[0].item.path, format!("image-{RECENT_IMAGE_LIMIT}"));
    }

    #[test]
    fn recent_record_json_preserves_path_time_and_count() {
        let record = RecentImageRecord {
            item: image("persisted"),
            last_used_at: 1_725_000_000_000,
            use_count: 7,
            group_ids: Vec::new(),
            tag_ids: Vec::new(),
        };

        let json = serde_json::to_string(&record).expect("serialize recent record");
        let restored: RecentImageRecord =
            serde_json::from_str(&json).expect("deserialize recent record");

        assert_eq!(restored, record);
    }
}
