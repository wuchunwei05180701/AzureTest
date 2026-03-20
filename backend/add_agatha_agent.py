#!/usr/bin/env python3
"""
一次性腳本：新增 Agatha AI 助理 Agent 到現有資料庫
執行方式：cd ~/wei/Azure/backend && python add_agatha_agent.py
"""
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from config import settings


def main():
    engine = create_engine(settings.GLOBAL_DB_URL_SYNC)

    agent_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    agent_config = '{"model": "agatha", "agatha_enabled": true}'

    with engine.begin() as conn:
        # 檢查是否已存在同名 Agent
        result = conn.execute(
            text("SELECT agent_id FROM agent_master WHERE name = :name"),
            {"name": "Agatha AI 助理"},
        )
        existing = result.fetchone()
        if existing:
            print(f"⚠️  Agent 'Agatha AI 助理' 已存在 (id={existing[0]})，跳過插入")
            return

        # 插入 Agent
        conn.execute(
            text("""
                INSERT INTO agent_master (agent_id, name, icon, color, description, is_published, model_config, created_at, updated_at)
                VALUES (:agent_id, :name, :icon, :color, :description, :is_published, CAST(:model_config AS jsonb), :created_at, :updated_at)
            """),
            {
                "agent_id": agent_id,
                "name": "Agatha AI 助理",
                "icon": "🧠",
                "color": "#7C4DFF",
                "description": "由 Agatha 平台驅動的智慧 AI 助理，支援多輪對話與即時串流回覆。",
                "is_published": True,
                "model_config": agent_config,
                "created_at": now,
                "updated_at": now,
            },
        )
        print(f"✅ Agent 已插入: {agent_id} (Agatha AI 助理)")

        # 插入 ACL（所有角色皆可使用）
        all_roles = ["user", "admin", "root"]
        import json
        acl_json = json.dumps({
            "authorized_roles": all_roles,
            "authorized_users": [],
            "exception_list": [],
        })

        conn.execute(
            text("""
                INSERT INTO agent_acl (agent_id, allowed_users)
                VALUES (:agent_id, CAST(:allowed_users AS jsonb))
                ON CONFLICT (agent_id) DO UPDATE SET allowed_users = EXCLUDED.allowed_users
            """),
            {
                "agent_id": agent_id,
                "allowed_users": acl_json,
            },
        )
        print(f"✅ ACL 已插入: agent_id={agent_id}")

    print("\n🎉 完成！新 Agent 已加入資料庫。")
    print(f"   Agent ID: {agent_id}")
    print(f"   名稱: Agatha AI 助理")
    print(f"   Config: {agent_config}")


if __name__ == "__main__":
    main()
