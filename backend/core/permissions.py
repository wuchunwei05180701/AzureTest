"""
角色權限定義與檢查
"""
from enum import Enum
from functools import wraps
from typing import List

from fastapi import Depends, HTTPException, status

from core.security import get_current_user_payload


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    PLATFORM_ADMIN = "platform_admin"
    USER_MANAGER = "user_manager"
    LIBRARY_MANAGER = "library_manager"
    USER = "user"


ROLE_LABELS = {
    Role.SUPER_ADMIN: "台灣最高管理者",
    Role.PLATFORM_ADMIN: "平台管理者",
    Role.USER_MANAGER: "用戶管理者",
    Role.LIBRARY_MANAGER: "圖書館管理者",
    Role.USER: "一般使用者",
}

# 角色階層等級（數字越大權限越高）
ROLE_HIERARCHY = {
    Role.SUPER_ADMIN: 4,
    Role.PLATFORM_ADMIN: 3,
    Role.USER_MANAGER: 2,
    Role.LIBRARY_MANAGER: 2,
    Role.USER: 1,
}

ROLE_PERMISSIONS = {
    Role.SUPER_ADMIN: [
        "view_announcements", "use_agents", "view_library", "chat_history",
        "manage_users", "manage_library", "manage_announcements",
        "manage_agent_permissions", "access_all_agents", "access_all_docs",
        "cross_country_logs",
    ],
    Role.PLATFORM_ADMIN: [
        "view_announcements", "use_agents", "view_library", "chat_history",
        "manage_users", "manage_library", "manage_announcements",
        "manage_agent_permissions", "access_all_agents", "access_all_docs",
    ],
    Role.USER_MANAGER: [
        "view_announcements", "use_agents", "view_library", "chat_history",
        "manage_users",
    ],
    Role.LIBRARY_MANAGER: [
        "view_announcements", "use_agents", "view_library", "chat_history",
        "manage_library",
    ],
    Role.USER: [
        "view_announcements", "use_agents", "view_library", "chat_history",
    ],
}


def get_role_level(role: str) -> int:
    """取得角色的階層等級"""
    try:
        role_enum = Role(role)
    except ValueError:
        return 0
    return ROLE_HIERARCHY.get(role_enum, 0)


def validate_role_operation(
    operator_role: str,
    target_current_role: str,
    target_new_role: str = None,
    operator_email: str = None,
    target_email: str = None,
) -> None:
    """
    驗證角色操作的階層權限。違反規則時拋出 HTTPException。

    規則：
    1. 不能操作自己
    2. 不能操作等級 >= 自己的使用者
    3. 不能指派等級 >= 自己的角色

    Args:
        operator_role: 操作者的角色
        target_current_role: 目標使用者目前的角色
        target_new_role: 要指派的新角色（可選，僅角色變更時需要）
        operator_email: 操作者的 email
        target_email: 目標使用者的 email
    """
    # 規則 1：不能操作自己
    if operator_email and target_email and operator_email.lower() == target_email.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="不能修改自己的帳號設定，請聯繫上級管理者",
        )

    operator_level = get_role_level(operator_role)
    target_level = get_role_level(target_current_role)

    # 規則 2：不能操作等級 >= 自己的使用者
    if target_level >= operator_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"權限不足：無法操作 {ROLE_LABELS.get(Role(target_current_role), target_current_role)} 角色的使用者",
        )

    # 規則 3：不能指派等級 >= 自己的角色
    if target_new_role:
        try:
            Role(target_new_role)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"無效的角色: {target_new_role}",
            )
        new_role_level = get_role_level(target_new_role)
        if new_role_level >= operator_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"權限不足：無法指派 {ROLE_LABELS.get(Role(target_new_role), target_new_role)} 角色",
            )


def get_assignable_roles(operator_role: str) -> List[dict]:
    """
    取得操作者可指派的角色列表（等級 < 自己的角色）

    Returns:
        [{"value": "user", "label": "一般使用者", "level": 1}, ...]
    """
    operator_level = get_role_level(operator_role)
    assignable = []
    for role_enum, level in ROLE_HIERARCHY.items():
        if level < operator_level:
            assignable.append({
                "value": role_enum.value,
                "label": ROLE_LABELS.get(role_enum, role_enum.value),
                "level": level,
            })
    return sorted(assignable, key=lambda x: x["level"], reverse=True)


def has_permission(role: str, permission: str) -> bool:
    """檢查角色是否有特定權限"""
    try:
        role_enum = Role(role)
    except ValueError:
        return False
    return permission in ROLE_PERMISSIONS.get(role_enum, [])


def get_role_permissions(role: str) -> List[str]:
    """取得角色的所有權限"""
    try:
        role_enum = Role(role)
    except ValueError:
        return []
    return ROLE_PERMISSIONS.get(role_enum, [])


async def _get_fresh_role(email: str) -> str:
    """從 DB 讀取使用者最新角色（避免 JWT 快照過期問題）"""
    from sqlalchemy import select
    from core.database import GlobalSessionLocal
    from models.global_models import UserRouteMap

    async with GlobalSessionLocal() as session:
        result = await session.execute(
            select(UserRouteMap.role).where(UserRouteMap.email == email)
        )
        row = result.scalar_one_or_none()
        return row if row else "user"


def require_permission(permission: str):
    """
    權限檢查 Dependency 工廠（從 DB 讀取最新角色）
    用法：
        @router.get("/api/users")
        async def list_users(
            payload: dict = Depends(require_permission("manage_users"))
        ):
    """
    async def _check_permission(
        payload: dict = Depends(get_current_user_payload),
    ) -> dict:
        email = payload.get("sub", "")
        role = await _get_fresh_role(email)
        # 更新 payload 中的角色為最新值
        payload["role"] = role
        if not has_permission(role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"權限不足：需要 [{permission}] 權限",
            )
        return payload

    return _check_permission


def require_any_permission(*permissions: str):
    """
    多權限檢查（任一符合即可，從 DB 讀取最新角色）
    用法：
        @router.get("/api/audit/logs")
        async def get_logs(
            payload: dict = Depends(require_any_permission("manage_users", "cross_country_logs"))
        ):
    """
    async def _check_any_permission(
        payload: dict = Depends(get_current_user_payload),
    ) -> dict:
        email = payload.get("sub", "")
        role = await _get_fresh_role(email)
        # 更新 payload 中的角色為最新值
        payload["role"] = role
        for perm in permissions:
            if has_permission(role, perm):
                return payload
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"權限不足：需要以下任一權限 {list(permissions)}",
        )

    return _check_any_permission
