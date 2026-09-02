-- Phase 32：OCR 识图自动打标签。
-- `ocr_text` 存 OCR 引擎识别出的原始文本（行以 \n 连接），幂等守卫用：
-- NULL = 未识别过（迁移存量 / 导入时引擎关闭 / 后台任务被中断），
-- ''（空串）= 已识别但图内无文字。识别结果可重新派生标签，不必重跑 OCR。
-- 不建索引：回填按 `ocr_text IS NULL` 全表扫描，表规模（万级）无压力，
-- 同迁移 0004 的 perceptual_hash 先例。
ALTER TABLE emojis ADD COLUMN ocr_text TEXT;
