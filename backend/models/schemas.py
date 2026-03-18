"""
Pydantic Request/Response Schemas
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# ===== 認證 =====
class OTPRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    otp_code: str = Field(..., min_length=6, max_length=6)


class UserInfo(BaseModel):
    email: str
    name: str
    role: str
    department: Optional[str] = None
    country: str
    permissions: List[str] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


# ===== 使用者管理 =====
class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    department: Optional[str] = None
    country: str = Field(..., min_length=2, max_length=5)
    role: str = "user"


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    department: Optional[str] = None
    role: Optional[str] = None


class UserStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(active|inactive)$")


class UserRoleUpdate(BaseModel):
    role: str


class UserListResponse(BaseModel):
    email: str
    name: str
    department: Optional[str] = None
    country: str
    role: str
    status: str
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ===== Agent =====
class AgentACLInfo(BaseModel):
    """Agent ACL 資訊（嵌入 AgentResponse 中回傳給前端）"""
    authorized_roles: List[str] = []
    authorized_users: List[str] = []
    exception_list: List[str] = []


class AgentResponse(BaseModel):
    agent_id: str
    name: str
    agent_config_json: Dict[str, Any] = {}
    icon: Optional[str] = None
    icon_type: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    is_published: bool = False
    acl: Optional[AgentACLInfo] = None


class AgentPublishUpdate(BaseModel):
    is_published: bool


class AgentACLUpdate(BaseModel):
    authorized_roles: List[str] = []
    authorized_users: List[str] = Field(default=[], max_length=50)
    exception_list: List[str] = []


# ===== 公告 =====
class AnnouncementCreate(BaseModel):
    subject: str = Field(..., min_length=1, max_length=255)
    content_en: Optional[str] = Field(None, max_length=300)
    publish_status: str = "draft"
    files: Optional[List[Dict[str, Any]]] = []
    library_docs: Optional[List[Dict[str, Any]]] = []  # 關聯的圖書館文件


class AnnouncementUpdate(BaseModel):
    subject: Optional[str] = Field(None, min_length=1, max_length=255)
    content_en: Optional[str] = Field(None, max_length=300)
    publish_status: Optional[str] = None
    files: Optional[List[Dict[str, Any]]] = None
    library_docs: Optional[List[Dict[str, Any]]] = None  # 關聯的圖書館文件


class AnnouncementResponse(BaseModel):
    notice_id: str
    subject: str
    content_en: Optional[str] = None
    files: List[Dict[str, Any]] = []
    library_docs: List[Dict[str, Any]] = []  # 關聯的圖書館文件
    publish_status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ===== 圖書館 =====
class LibraryCatalogCreate(BaseModel):
    library_name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class LibraryCatalogResponse(BaseModel):
    catalog_id: str
    library_name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    doc_count: int = 0
    created_at: Optional[datetime] = None


class LibraryDocCreate(BaseModel):
    library_name: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class LibraryDocUpdate(BaseModel):
    library_name: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


class LibraryAuthUpdate(BaseModel):
    authorized_roles: List[str] = []
    authorized_users: List[str] = Field(default=[], max_length=50)
    exception_list: List[str] = []


class LibraryDocResponse(BaseModel):
    doc_id: str
    library_name: str
    name: str
    description: Optional[str] = None
    file_url: Optional[str] = None
    files: List[Dict[str, Any]] = []
    auth_rules: Dict[str, Any] = {}
    created_at: Optional[datetime] = None


# ===== 對話 =====
class ChatMessage(BaseModel):
    role: str  # user / assistant
    content: str


class ChatCreate(BaseModel):
    agent_id: str
    message: str


class ChatStreamCreate(BaseModel):
    """Streaming 聊天請求（整合 Agatha Public API）"""
    agent_id: str
    message: str
    session_id: Optional[str] = None  # null=新對話, "sess-xxx"=延續對話
    images: Optional[List[str]] = None  # 圖片陣列（base64 data URI 或 HTTP URL）


class ChatResponse(BaseModel):
    chat_id: str
    agent_id: str
    agent_name: Optional[str] = None
    messages: List[Dict[str, Any]] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChatHistoryItem(BaseModel):
    chat_id: str
    agent_id: str
    agent_name: Optional[str] = None
    last_message: Optional[str] = None
    timestamp: Optional[datetime] = None


# ===== 對話歷史（Session + Message 雙 Collection） =====
class SessionSummary(BaseModel):
    """對話 Session 摘要（列表用）"""
    session_id: str
    agent_id: str
    agent_name: Optional[str] = None
    title: Optional[str] = None
    last_message_preview: Optional[str] = None
    message_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SessionListResponse(BaseModel):
    """對話 Session 列表回應（含分頁）"""
    sessions: List[SessionSummary] = []
    total: int = 0
    page: int = 1
    page_size: int = 20


class SessionMessageItem(BaseModel):
    """單條訊息"""
    role: str
    content: str
    created_at: Optional[datetime] = None


class SessionDetailResponse(BaseModel):
    """對話 Session 詳情（含所有訊息）"""
    session_id: str
    agent_id: str
    agent_name: Optional[str] = None
    title: Optional[str] = None
    thread_id: Optional[str] = None
    messages: List[SessionMessageItem] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ===== 通用 =====
class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None
    dev_otp: Optional[str] = None  # 開發模式下回傳 OTP，正式環境不會有值


class PaginatedResponse(BaseModel):
    items: List[Any] = []
    total: int = 0
    page: int = 1
    page_size: int = 10
