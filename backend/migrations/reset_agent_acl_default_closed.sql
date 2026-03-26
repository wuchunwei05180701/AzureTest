-- Migration: 將所有 Agent ACL 的 authorized_roles 預設改為全關（空陣列）
-- 用途：將現有已全開的 Agent ACL 重設為預設全關
-- 執行方式：psql -h <host> -U <user> -d <db> -f reset_agent_acl_default_closed.sql

-- 將所有 agent_acl 的 authorized_roles 設為空陣列
UPDATE agent_acl
SET allowed_users = jsonb_set(
    allowed_users,
    '{authorized_roles}',
    '[]'::jsonb
)
WHERE allowed_users->>'authorized_roles' IS NOT NULL
  AND allowed_users->'authorized_roles' != '[]'::jsonb;

-- 確認結果
SELECT agent_id, allowed_users FROM agent_acl;
