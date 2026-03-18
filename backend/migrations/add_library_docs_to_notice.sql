-- Migration: 為 local_notice 新增 library_docs 欄位
-- 用途：公告可關聯圖書館上傳的文件
-- 格式：[{"doc_id": "xxx", "name": "文件名", "library_name": "館名"}]

ALTER TABLE local_notice
ADD COLUMN IF NOT EXISTS library_docs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN local_notice.library_docs IS '關聯的圖書館文件列表 [{doc_id, name, library_name}]';
