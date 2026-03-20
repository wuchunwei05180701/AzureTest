-- ============================================================
-- 遷移：擴充 global_audit_log 表
-- 新增欄位：ip_address, result, error_message, details, user_agent, response_time_ms
-- 執行方式：psql -U <user> -d azuretestDB -f add_audit_log_fields.sql
-- ============================================================

ALTER TABLE global_audit_log
    ADD COLUMN IF NOT EXISTS ip_address      VARCHAR(45),
    ADD COLUMN IF NOT EXISTS result          VARCHAR(20) DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS error_message   TEXT,
    ADD COLUMN IF NOT EXISTS details         JSONB,
    ADD COLUMN IF NOT EXISTS user_agent      TEXT,
    ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

-- 建立常用查詢索引
CREATE INDEX IF NOT EXISTS idx_audit_log_email_time
    ON global_audit_log (user_email, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_time
    ON global_audit_log (action, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_country_time
    ON global_audit_log (country_code, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_result
    ON global_audit_log (result, timestamp DESC);

COMMENT ON COLUMN global_audit_log.ip_address       IS '操作者 IP 位址';
COMMENT ON COLUMN global_audit_log.result           IS '操作結果：success / failure';
COMMENT ON COLUMN global_audit_log.error_message    IS '失敗原因（result=failure 時填入）';
COMMENT ON COLUMN global_audit_log.details          IS '操作補充資訊（JSON），例如角色變更前後的值';
COMMENT ON COLUMN global_audit_log.user_agent       IS '操作者瀏覽器 User-Agent';
COMMENT ON COLUMN global_audit_log.response_time_ms IS '操作耗時（毫秒）';
