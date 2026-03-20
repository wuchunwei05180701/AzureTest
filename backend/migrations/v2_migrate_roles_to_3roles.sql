-- =============================================================
-- v2 角色遷移：5角色 → 3角色
-- 執行前請先備份資料庫！
--
-- 角色對應：
--   super_admin                              → root
--   platform_admin / user_manager / library_manager → admin
--   user                                     → user（不變）
--
-- 執行順序：
--   1. 先在 Global DB 執行（user_route_map, agent_acl, global_library）
--   2. 再在每個國家的 Local DB 執行（local_library）
-- =============================================================


-- =============================================================
-- [GLOBAL DB] 在 Global PostgreSQL 執行以下區塊
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. user_route_map：遷移 role 欄位字串值
-- ---------------------------------------------------------------
UPDATE user_route_map
SET role = 'root'
WHERE role = 'super_admin';

UPDATE user_route_map
SET role = 'admin'
WHERE role IN ('platform_admin', 'user_manager', 'library_manager');

-- 驗證：確認沒有舊角色殘留
DO $$
DECLARE
  old_role_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO old_role_count
  FROM user_route_map
  WHERE role IN ('super_admin', 'platform_admin', 'user_manager', 'library_manager');

  IF old_role_count > 0 THEN
    RAISE EXCEPTION '遷移失敗：仍有 % 筆舊角色資料未轉換', old_role_count;
  END IF;
END $$;


-- ---------------------------------------------------------------
-- 2. agent_acl：遷移 allowed_users.authorized_roles JSONB 陣列
-- ---------------------------------------------------------------
UPDATE agent_acl
SET allowed_users = jsonb_set(
  allowed_users,
  '{authorized_roles}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE elem::text
          WHEN '"super_admin"'     THEN '"root"'::jsonb
          WHEN '"platform_admin"'  THEN '"admin"'::jsonb
          WHEN '"user_manager"'    THEN '"admin"'::jsonb
          WHEN '"library_manager"' THEN '"admin"'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(allowed_users->'authorized_roles') AS elem
    ),
    '[]'::jsonb
  )
)
WHERE allowed_users ? 'authorized_roles'
  AND jsonb_array_length(allowed_users->'authorized_roles') > 0;


-- ---------------------------------------------------------------
-- 3. global_library：遷移 auth_rules.authorized_roles JSONB 陣列
-- ---------------------------------------------------------------
UPDATE global_library
SET auth_rules = jsonb_set(
  auth_rules,
  '{authorized_roles}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE elem::text
          WHEN '"super_admin"'     THEN '"root"'::jsonb
          WHEN '"platform_admin"'  THEN '"admin"'::jsonb
          WHEN '"user_manager"'    THEN '"admin"'::jsonb
          WHEN '"library_manager"' THEN '"admin"'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(auth_rules->'authorized_roles') AS elem
    ),
    '[]'::jsonb
  )
)
WHERE auth_rules ? 'authorized_roles'
  AND jsonb_array_length(auth_rules->'authorized_roles') > 0;


-- ---------------------------------------------------------------
-- 4. 驗證結果（Global DB）
-- ---------------------------------------------------------------
-- SELECT role, COUNT(*) FROM user_route_map GROUP BY role ORDER BY role;
-- SELECT allowed_users->'authorized_roles' FROM agent_acl LIMIT 10;
-- SELECT auth_rules->'authorized_roles' FROM global_library LIMIT 10;

COMMIT;


-- =============================================================
-- [LOCAL DB] 在每個國家的 Local PostgreSQL 分別執行以下區塊
-- （TW / SG / JP / TH 各執行一次）
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 5. local_library：遷移 auth_rules.authorized_roles JSONB 陣列
-- ---------------------------------------------------------------
UPDATE local_library
SET auth_rules = jsonb_set(
  auth_rules,
  '{authorized_roles}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE elem::text
          WHEN '"super_admin"'     THEN '"root"'::jsonb
          WHEN '"platform_admin"'  THEN '"admin"'::jsonb
          WHEN '"user_manager"'    THEN '"admin"'::jsonb
          WHEN '"library_manager"' THEN '"admin"'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(auth_rules->'authorized_roles') AS elem
    ),
    '[]'::jsonb
  )
)
WHERE auth_rules ? 'authorized_roles'
  AND jsonb_array_length(auth_rules->'authorized_roles') > 0;

-- ---------------------------------------------------------------
-- 6. 驗證結果（Local DB）
-- ---------------------------------------------------------------
-- SELECT auth_rules->'authorized_roles' FROM local_library LIMIT 10;

COMMIT;
