//! 锁死 UpdateCheckResult 的 serde JSON 形状（与 src/types.ts 的 camelCase 契约）。
//! 背景：`rename_all` 对 internally-tagged enum 只作用于 variant 名，variant 内部
//! 字段曾序列化成 snake_case、前端读 camelCase 全是 undefined（「发现新版本
//! vundefined」真机事故）；修复用 `rename_all_fields = "camelCase"`，此测试防回归。
#[cfg(test)]
mod probe {
    use crate::updater::UpdateCheckResult;

    #[test]
    fn available_serialization_uses_camel_case_fields() {
        let result = UpdateCheckResult::Available {
            current_version: "0.1.0".to_string(),
            latest_version: "0.1.1".to_string(),
            notes: Some("n".to_string()),
            pub_date: None,
            size: Some(123),
            download_url: "u".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"status\":\"available\""));
        assert!(json.contains("\"currentVersion\""));
        assert!(json.contains("\"latestVersion\""));
        assert!(json.contains("\"downloadUrl\""));
        assert!(!json.contains("current_version"));
        assert!(!json.contains("latest_version"));
    }

    #[test]
    fn up_to_date_serialization_uses_camel_case_fields() {
        let json = serde_json::to_string(&UpdateCheckResult::UpToDate {
            current_version: "0.1.1".to_string(),
        })
        .unwrap();
        assert!(json.contains("\"status\":\"upToDate\""));
        assert!(json.contains("\"currentVersion\""));
    }
}
