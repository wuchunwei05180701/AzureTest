#!/usr/bin/env python3
"""
CTBC AI Portal - DB Seed Script
初始化 Global DB + 各國 Local DB schema 並插入測試資料

使用方式：
  cd Azure/backend && python seed_data.py          # 建立表 + 插入資料
  cd Azure/backend && python seed_data.py --drop    # 先 DROP 所有表再重建
"""
import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from config import settings


def get_global_engine():
    """建立 Global DB 同步 engine"""
    url = settings.GLOBAL_DB_URL_SYNC
    print(f"📡 連線到 Global DB: {settings.GLOBAL_DB_HOST}:{settings.GLOBAL_DB_PORT}/{settings.GLOBAL_DB_NAME}")
    return create_engine(url, echo=False)


def get_local_engine(country_code: str):
    """建立指定國家的 Local DB 同步 engine"""
    config = settings.LOCAL_DB_CONFIG.get(country_code)
    if not config:
        print(f"   ⚠️ 國家 [{country_code}] 未設定 Local DB，跳過")
        return None
    user = quote_plus(config['pg_user'])
    password = quote_plus(config['pg_password'])
    url = f"postgresql+psycopg2://{user}:{password}@{config['pg_host']}:{config['pg_port']}/{config['pg_db']}"
    print(f"📡 連線到 Local DB [{country_code}]: {config['pg_host']}:{config['pg_port']}/{config['pg_db']}")
    return create_engine(url, echo=False)


def drop_global_tables(engine):
    """DROP 所有 Global DB 表"""
    print("\n🗑️  正在 DROP Global DB 所有表...")
    table_names = [
        "global_audit_log",
        "global_library",
        "agent_acl",
        "agent_master",
        "user_route_map",
    ]
    with engine.begin() as conn:
        for table in table_names:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
            print(f"   ✅ DROP TABLE {table}")
    print("🗑️  Global DB 所有表已刪除")


def drop_local_tables(engine, country_code: str):
    """DROP 所有 Local DB 表"""
    print(f"\n🗑️  正在 DROP Local DB [{country_code}] 所有表...")
    table_names = [
        "file_lifecycle",
        "local_library",
        "local_library_catalog",
        "local_notice",
        "login_audit",
        "otp_vault",
    ]
    with engine.begin() as conn:
        for table in table_names:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
            print(f"   ✅ [{country_code}] DROP TABLE {table}")
    print(f"🗑️  Local DB [{country_code}] 所有表已刪除")


def create_global_tables(engine):
    """建立所有 Global DB 表"""
    print("\n📦 正在建立 Global DB 表...")
    from core.database import GlobalBase
    import models.global_models  # noqa: F401

    GlobalBase.metadata.create_all(bind=engine)
    print("   ✅ user_route_map")
    print("   ✅ agent_master")
    print("   ✅ agent_acl")
    print("   ✅ global_library (保留但不再使用)")
    print("   ✅ global_audit_log")
    print("📦 Global DB 所有表已建立")


def create_local_tables(engine, country_code: str):
    """建立所有 Local DB 表"""
    print(f"\n📦 正在建立 Local DB [{country_code}] 表...")
    from core.local_database import LocalBase
    import models.local_models  # noqa: F401

    LocalBase.metadata.create_all(bind=engine)
    print(f"   ✅ [{country_code}] otp_vault")
    print(f"   ✅ [{country_code}] login_audit")
    print(f"   ✅ [{country_code}] local_notice")
    print(f"   ✅ [{country_code}] local_library_catalog")
    print(f"   ✅ [{country_code}] local_library")
    print(f"   ✅ [{country_code}] file_lifecycle")
    print(f"📦 Local DB [{country_code}] 所有表已建立")


def seed_users(session: Session):
    """插入使用者 seed 資料"""
    print("\n👥 正在插入使用者資料...")
    from models.global_models import UserRouteMap

    users = [
        {"email": "super@ctbc.com", "name": "Super Admin", "department": "it", "country_code": "TW", "role": "root", "status": "active"},
        {"email": "tina@ctbc.com", "name": "Tina", "department": "planning", "country_code": "TW", "role": "admin", "status": "active"},
        {"email": "john@ctbc.com", "name": "John", "department": "rd", "country_code": "TW", "role": "admin", "status": "active"},
        {"email": "alice@ctbc.com", "name": "Alice", "department": "marketing", "country_code": "TW", "role": "admin", "status": "active"},
        {"email": "bob@ctbc.com.sg", "name": "Bob", "department": "finance", "country_code": "SG", "role": "user", "status": "active"},
        {"email": "admin.sg@ctbc.com", "name": "SG Admin", "department": "management", "country_code": "SG", "role": "admin", "status": "active"},
        {"email": "carol@ctbc.com", "name": "Carol", "department": "hr", "country_code": "TW", "role": "user", "status": "active"},
        {"email": "david@ctbc.co.jp", "name": "David", "department": "rd", "country_code": "JP", "role": "user", "status": "active"},
        {"email": "eva@ctbc.com", "name": "Eva", "department": "planning", "country_code": "TW", "role": "user", "status": "inactive"},
        {"email": "frank@ctbc.co.th", "name": "Frank", "department": "marketing", "country_code": "TH", "role": "user", "status": "active"},
    ]

    now = datetime.now(timezone.utc)
    for u in users:
        user = UserRouteMap(
            email=u["email"],
            name=u["name"],
            department=u["department"],
            country_code=u["country_code"],
            role=u["role"],
            status=u["status"],
            created_at=now,
            updated_at=now,
        )
        session.merge(user)
        print(f"   ✅ {u['email']} ({u['name']}, {u['role']}, {u['country_code']})")

    session.commit()
    print(f"👥 已插入 {len(users)} 筆使用者資料")


def seed_agents(session: Session) -> list:
    """插入 Agent seed 資料，回傳 agent_id 列表"""
    print("\n🤖 正在插入 Agent 資料...")
    from models.global_models import AgentMaster

    agents = [
        {
            "name": "【EPMO】VMO Satellite",
            "icon": "🛰️",
            "color": "#4FC3F7",
            "description": "VMO 衛星監控代理，協助追蹤專案進度與風險。",
            "is_published": True,
            "agent_config_json": {"model": "gpt-4o"},
        },
        {
            "name": "【EPMO】Talent Agent",
            "icon": "👤",
            "color": "#81C784",
            "description": "人才管理代理，協助人力資源配置與評估。",
            "is_published": True,
            "agent_config_json": {"model": "gpt-4o"},
        },
        {
            "name": "【EPMO】RISKO.beta(影印問題版)",
            "icon": "🔥",
            "color": "#FF8A65",
            "description": "風險評估代理，識別並分析專案潛在風險。",
            "is_published": True,
            "agent_config_json": {"model": "gpt-4o"},
        },
        {
            "name": "【EPMO】Coordinator Agent (Dr. PJ Jr.)",
            "icon": "🤖",
            "color": "#9575CD",
            "description": "專案協調代理，協助跨部門溝通與任務分配。",
            "is_published": True,
            "agent_config_json": {"model": "gpt-4.1"},
        },
        {
            "name": "【EPMO】project 專案顧問",
            "icon": "📋",
            "color": "#4DB6AC",
            "description": "專案顧問代理，提供專案管理建議與最佳實踐。",
            "is_published": True,
            "agent_config_json": {"model": "gpt-4.1"},
        },
        {
            "name": "Agatha AI 助理",
            "icon": "🧠",
            "color": "#7C4DFF",
            "description": "由 Agatha 平台驅動的智慧 AI 助理，支援多輪對話與即時串流回覆。",
            "is_published": True,
            "agent_config_json": {"model": "agatha", "agatha_enabled": True},
        },
    ]

    agent_ids = []
    now = datetime.now(timezone.utc)
    for a in agents:
        agent_id = uuid.uuid4()
        agent = AgentMaster(
            agent_id=agent_id,
            name=a["name"],
            icon=a["icon"],
            color=a["color"],
            description=a["description"],
            is_published=a["is_published"],
            agent_config_json=a["agent_config_json"],
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        agent_ids.append(agent_id)
        print(f"   ✅ {a['icon']} {a['name']}")

    session.commit()
    print(f"🤖 已插入 {len(agents)} 筆 Agent 資料")
    return agent_ids


def seed_agent_acl(session: Session, agent_ids: list):
    """為每個 Agent 建立 ACL"""
    print("\n🔐 正在插入 Agent ACL 資料...")
    from models.global_models import AgentACL

    all_roles = ["user", "admin", "root"]

    for agent_id in agent_ids:
        acl = AgentACL(
            agent_id=agent_id,
            allowed_users={
                "authorized_roles": all_roles,
                "authorized_users": [],
                "exception_list": [],
            },
        )
        session.merge(acl)
        print(f"   ✅ ACL for agent {agent_id}")

    session.commit()
    print(f"🔐 已插入 {len(agent_ids)} 筆 Agent ACL 資料")


def seed_local_library(session: Session, country_code: str):
    """插入各國圖書館 seed 資料到 Local DB（含 catalog 記錄）"""
    print(f"\n📚 正在插入 [{country_code}] 圖書館資料...")
    from models.local_models import LocalLibrary, LocalLibraryCatalog

    # 各國的圖書館資料
    library_data = {
        "TW": [
            {
                "library_name": "Cloud Architecture",
                "documents": [
                    {"name": "AWS Best Practices Guide", "description": "Comprehensive guide for AWS cloud architecture design patterns and best practices."},
                    {"name": "Azure Fundamentals", "description": "Introduction to Microsoft Azure services and cloud computing concepts."},
                    {"name": "GCP Infrastructure Design", "description": "Google Cloud Platform infrastructure design and deployment strategies."},
                    {"name": "Multi-Cloud Strategy", "description": "Strategies for implementing and managing multi-cloud environments."},
                    {"name": "Cloud Security Framework", "description": "Security frameworks and compliance standards for cloud deployments."},
                ],
            },
            {
                "library_name": "Project Management",
                "documents": [
                    {"name": "Agile Methodology Handbook", "description": "Complete handbook for agile project management methodologies."},
                    {"name": "Risk Assessment Templates", "description": "Templates and guidelines for project risk assessment and mitigation."},
                    {"name": "Stakeholder Communication Plan", "description": "Best practices for stakeholder communication and engagement."},
                ],
            },
            {
                "library_name": "Compliance & Regulations",
                "documents": [
                    {"name": "GDPR Compliance Guide", "description": "Guidelines for ensuring GDPR compliance in data processing activities."},
                    {"name": "ISO 27001 Standards", "description": "Information security management system standards and implementation."},
                ],
            },
        ],
        "SG": [
            {
                "library_name": "Singapore Regulations",
                "documents": [
                    {"name": "MAS Technology Risk Management", "description": "MAS guidelines on technology risk management for financial institutions."},
                    {"name": "PDPA Compliance Guide", "description": "Personal Data Protection Act compliance guidelines for Singapore operations."},
                ],
            },
            {
                "library_name": "APAC Operations",
                "documents": [
                    {"name": "Cross-Border Payment Guide", "description": "Guide for cross-border payment processing in APAC region."},
                ],
            },
        ],
        "JP": [
            {
                "library_name": "Japan Compliance",
                "documents": [
                    {"name": "FSA Regulatory Framework", "description": "Financial Services Agency regulatory framework for banking operations in Japan."},
                    {"name": "APPI Data Protection", "description": "Act on the Protection of Personal Information compliance guide."},
                ],
            },
        ],
        "TH": [
            {
                "library_name": "Thailand Operations",
                "documents": [
                    {"name": "BOT Regulations Overview", "description": "Bank of Thailand regulatory overview for foreign bank branches."},
                    {"name": "PDPA Thailand Guide", "description": "Thailand Personal Data Protection Act compliance guidelines."},
                ],
            },
        ],
    }

    libraries = library_data.get(country_code, [])
    if not libraries:
        print(f"   ℹ️ [{country_code}] 無圖書館種子資料")
        return

    now = datetime.now(timezone.utc)
    total = 0
    catalog_count = 0
    all_roles = ["user", "admin", "root"]

    # 先建立 catalog 記錄
    for lib in libraries:
        catalog = LocalLibraryCatalog(
            catalog_id=uuid.uuid4(),
            library_name=lib["library_name"],
            created_at=now,
        )
        session.add(catalog)
        catalog_count += 1
        print(f"   📁 [{country_code}] Catalog: {lib['library_name']}")

    session.commit()
    print(f"📁 [{country_code}] 已插入 {catalog_count} 筆 Catalog 資料")

    # 再建立文件記錄
    for lib in libraries:
        for doc in lib["documents"]:
            entry = LocalLibrary(
                doc_id=uuid.uuid4(),
                library_name=lib["library_name"],
                name=doc["name"],
                description=doc["description"],
                metadata_json={},
                auth_rules={
                    "authorized_roles": all_roles,
                    "authorized_users": [],
                    "exception_list": [],
                },
                created_at=now,
                updated_at=now,
            )
            session.add(entry)
            total += 1
            print(f"   ✅ [{country_code}][{lib['library_name']}] {doc['name']}")

    session.commit()
    print(f"📚 [{country_code}] 已插入 {total} 筆圖書館文件資料")


def seed_local_announcements(session: Session, country_code: str):
    """插入各國公告 seed 資料到 Local DB"""
    print(f"\n📢 正在插入 [{country_code}] 公告資料...")
    from models.local_models import LocalNotice

    announcement_data = {
        "TW": [
            {"subject": "海外規範更版", "content_en": "The overseas compliance framework has been updated to version 3.2. All project managers are required to review the updated guidelines.", "publish_status": "published"},
            {"subject": "專案方法論", "content_en": "A new project methodology has been introduced to streamline cross-functional collaboration.", "publish_status": "published"},
            {"subject": "年度資安政策更新", "content_en": "Annual cybersecurity policy has been revised. All employees must complete the mandatory security training.", "publish_status": "published"},
        ],
        "SG": [
            {"subject": "MAS Compliance Update", "content_en": "New MAS compliance requirements effective Q2 2026. Please review the updated guidelines.", "publish_status": "published"},
            {"subject": "Singapore Office Relocation", "content_en": "Our Singapore office will be relocating to Marina Bay Financial Centre in March 2026.", "publish_status": "draft"},
        ],
        "JP": [
            {"subject": "FSA 規制更新", "content_en": "FSA regulatory updates for 2026. All Japan branch operations must comply by end of Q1.", "publish_status": "published"},
        ],
        "TH": [
            {"subject": "BOT New Guidelines", "content_en": "Bank of Thailand has issued new guidelines for digital banking services.", "publish_status": "published"},
        ],
    }

    announcements = announcement_data.get(country_code, [])
    if not announcements:
        print(f"   ℹ️ [{country_code}] 無公告種子資料")
        return

    now = datetime.now(timezone.utc)
    for a in announcements:
        notice = LocalNotice(
            notice_id=uuid.uuid4(),
            subject=a["subject"],
            content_en=a["content_en"],
            files=[],
            publish_status=a["publish_status"],
            created_at=now,
            updated_at=now,
        )
        session.add(notice)
        print(f"   ✅ [{country_code}] {a['subject']} ({a['publish_status']})")

    session.commit()
    print(f"📢 [{country_code}] 已插入 {len(announcements)} 筆公告資料")


def main():
    parser = argparse.ArgumentParser(description="CTBC AI Portal - DB Seed Script")
    parser.add_argument("--drop", action="store_true", help="先 DROP 所有表再重建")
    args = parser.parse_args()

    print("=" * 60)
    print("  CTBC AI Portal - DB Seed Script")
    print("  Global DB + 各國 Local DB")
    print("=" * 60)

    # === Step 1: Global DB ===
    try:
        global_engine = get_global_engine()
        with global_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("✅ Global DB 連線成功")
    except Exception as e:
        print(f"\n❌ Global DB 連線失敗: {e}")
        sys.exit(1)

    try:
        if args.drop:
            drop_global_tables(global_engine)

        create_global_tables(global_engine)

        with Session(global_engine) as session:
            seed_users(session)
            agent_ids = seed_agents(session)
            seed_agent_acl(session, agent_ids)

    except Exception as e:
        print(f"\n❌ Global DB Seed 失敗: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        global_engine.dispose()

    # === Step 2: 各國 Local DB ===
    configured_countries = list(settings.LOCAL_DB_CONFIG.keys())
    print(f"\n🌍 已設定的國家: {', '.join(configured_countries)}")

    for country_code in configured_countries:
        print(f"\n{'─' * 40}")
        print(f"  處理國家: {country_code}")
        print(f"{'─' * 40}")

        try:
            local_engine = get_local_engine(country_code)
            if not local_engine:
                continue

            with local_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print(f"✅ [{country_code}] Local DB 連線成功")

            if args.drop:
                drop_local_tables(local_engine, country_code)

            create_local_tables(local_engine, country_code)

            with Session(local_engine) as session:
                seed_local_library(session, country_code)
                seed_local_announcements(session, country_code)

        except Exception as e:
            print(f"\n❌ [{country_code}] Local DB Seed 失敗: {e}")
            import traceback
            traceback.print_exc()
            # 繼續處理其他國家
            continue
        finally:
            if local_engine:
                local_engine.dispose()

    print("\n" + "=" * 60)
    print("  ✅ Seed 完成！所有資料已成功插入。")
    print(f"  Global DB: {settings.GLOBAL_DB_NAME}")
    print(f"  Local DBs: {', '.join(configured_countries)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
