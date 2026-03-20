-- Migration: 新增 avatar_url 欄位到 user_route_map 表
-- 執行時間: 2026-03-20
-- 說明: 儲存使用者頭貼的相對路徑

ALTER TABLE user_route_map
ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

COMMENT ON COLUMN user_route_map.avatar_url IS '使用者頭貼相對路徑（uploads/avatars/...）';
