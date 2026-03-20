/**
 * adapters.js — 後端 API 回應 ↔ 前端元件格式轉換工具
 *
 * 後端 schema 定義於 Azure/backend/models/schemas.py
 * 前端 mockData 定義於 Azure/azure-portal/src/data/mockData.js
 */

// ============================================================
// 工具函式
// ============================================================

/**
 * 將 ISO 8601 日期字串轉換為 "YYYY.MM.DD" 格式
 * @param {string} isoString - ISO 8601 格式的日期字串
 * @returns {string} "YYYY.MM.DD" 格式的日期字串，無效輸入回傳空字串
 */
export function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

/**
 * 判斷日期是否在最近 N 天內
 * @param {string} isoString - ISO 8601 格式的日期字串
 * @param {number} days - 天數閾值
 * @returns {boolean} 若日期在 N 天內回傳 true，否則回傳 false
 */
export function isWithinDays(isoString, days = 7) {
  if (!isoString) return false;
  const target = new Date(isoString);
  if (Number.isNaN(target.getTime())) return false;
  const now = new Date();
  const diffMs = now.getTime() - target.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

// ============================================================
// 公告 (Announcement)  —  後端 → 前端
// ============================================================

/**
 * 單筆公告：後端 AnnouncementResponse → 前端 announcement 物件
 *
 * 後端欄位 (schemas.AnnouncementResponse):
 *   notice_id, subject, content_en, files, publish_status, created_at, updated_at
 *
 * 前端欄位 (mockData.announcements[]):
 *   id, subject, content, date, isNew, attachment
 *
 * @param {object} apiData - 後端 API 回傳的公告物件
 * @returns {object} 前端格式的公告物件
 */
export function adaptAnnouncement(apiData) {
  if (!apiData) return null;

  // attachments：完整附件列表
  const attachments = [];
  if (Array.isArray(apiData.files) && apiData.files.length > 0) {
    apiData.files.forEach((file) => {
      attachments.push({
        name: file.name || file.original_name || '',
        coverUrl: file.cover_url || file.coverUrl || '',
        pdfUrl: file.file_url || file.pdfUrl || '#',
        fileSize: file.file_size || 0,
      });
    });
  }

  // 關聯的圖書館文件
  const libraryDocs = [];
  if (Array.isArray(apiData.library_docs) && apiData.library_docs.length > 0) {
    apiData.library_docs.forEach((doc) => {
      libraryDocs.push({
        docId: doc.doc_id || '',
        name: doc.name || '',
        libraryName: doc.library_name || '',
      });
    });
  }

  // 向後相容：attachment 取第一個
  const attachment = attachments.length > 0 ? attachments[0] : null;

  return {
    id: apiData.notice_id,
    subject: apiData.subject ?? '',
    content: apiData.content_en ?? '',
    date: formatDate(apiData.created_at),
    isNew: isWithinDays(apiData.created_at, 7),
    publish_status: apiData.publish_status ?? 'draft',
    attachment,
    attachments, // 多附件陣列
    libraryDocs, // 關聯的圖書館文件
  };
}

/**
 * 多筆公告轉換
 * @param {Array} apiDataList - 後端公告陣列
 * @returns {Array} 前端格式的公告陣列
 */
export function adaptAnnouncements(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList.map(adaptAnnouncement).filter(Boolean);
}

// ============================================================
// Agent  —  後端 → 前端
// ============================================================

/**
 * 單筆 Agent：後端 AgentResponse → 前端 agent 物件
 *
 * 後端欄位 (schemas.AgentResponse):
 *   agent_id, name, agent_config_json, icon, color, description, is_published
 *
 * 前端欄位 (mockData.agents[]):
 *   id, name, model, status, icon, color, description
 *
 * @param {object} apiData - 後端 API 回傳的 Agent 物件
 * @returns {object} 前端格式的 Agent 物件
 */
export function adaptAgent(apiData) {
  if (!apiData) return null;

  const configJson = apiData.agent_config_json || {};
  const acl = apiData.acl || null;

  return {
    id: apiData.agent_id,
    name: apiData.name ?? '',
    model: configJson.model || 'unknown',
    status: apiData.is_published ? '可用' : '不可用',
    icon: apiData.icon ?? '',
    iconType: apiData.icon_type ?? '',
    color: apiData.color ?? '',
    description: apiData.description ?? '',
    acl: acl ? {
      authorizedRoles: acl.authorized_roles || [],
      authorizedUsers: acl.authorized_users || [],
      exceptionList: acl.exception_list || [],
    } : null,
  };
}

/**
 * 多筆 Agent 轉換
 * @param {Array} apiDataList - 後端 Agent 陣列
 * @returns {Array} 前端格式的 Agent 陣列
 */
export function adaptAgents(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList.map(adaptAgent).filter(Boolean);
}

// ============================================================
// 圖書館館名目錄 (Library Catalog)  —  後端 → 前端
// ============================================================

/**
 * 單筆 Catalog：後端 LibraryCatalogResponse → 前端 catalog 物件
 *
 * 後端欄位 (schemas.LibraryCatalogResponse):
 *   catalog_id, library_name, description, doc_count, created_at
 *
 * @param {object} apiData - 後端 API 回傳的 Catalog 物件
 * @returns {object} 前端格式的 Catalog 物件
 */
export function adaptCatalog(apiData) {
  if (!apiData) return null;
  return {
    catalogId: apiData.catalog_id,
    name: apiData.library_name ?? '',
    description: apiData.description ?? '',
    imageUrl: apiData.image_url ?? null,
    docCount: apiData.doc_count ?? 0,
    createdAt: apiData.created_at ?? null,
  };
}

/**
 * 多筆 Catalog 轉換
 * @param {Array} apiDataList - 後端 Catalog 陣列
 * @returns {Array} 前端格式的 Catalog 陣列
 */
export function adaptCatalogs(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList.map(adaptCatalog).filter(Boolean);
}

// ============================================================
// 圖書館文件 (Library Document)  —  後端 → 前端
// ============================================================

/**
 * 單筆文件：後端 LibraryDocResponse → 前端 document 物件
 *
 * 後端欄位 (schemas.LibraryDocResponse):
 *   doc_id, library_name, name, description, file_url, auth_rules, created_at
 *
 * 前端欄位 (mockData.libraries[].documents[]):
 *   id, name, description, coverUrl, pdfUrl
 *
 * @param {object} apiData - 後端 API 回傳的文件物件
 * @returns {object} 前端格式的文件物件（含 _libraryName 供分組用）
 */
export function adaptLibraryDoc(apiData) {
  if (!apiData) return null;

  const files = Array.isArray(apiData.files) ? apiData.files : [];

  return {
    id: apiData.doc_id,
    name: apiData.name ?? '',
    description: apiData.description ?? '',
    coverUrl: '/mock-doc-cover.png', // 後端無封面，使用前端預設圖
    pdfUrl: apiData.file_url || '#',
    hasFile: !!apiData.file_url || files.length > 0, // 是否有上傳檔案
    files, // 多檔案資訊陣列 [{ filename, relative_path, file_size }]
    libraryName: apiData.library_name ?? '', // 所屬館名（供首頁顯示）
    createdAt: apiData.created_at ?? null, // 建立時間
    auth_rules: apiData.auth_rules ?? {}, // 存取控制規則（authorized_users, authorized_roles, exception_list）
    _libraryName: apiData.library_name ?? '', // 內部欄位，供 adaptLibraryDocs 分組用
  };
}

/**
 * 多筆文件轉換，並按 library_name 分組成前端格式
 *
 * 後端回傳扁平列表，前端需要按分類分組：
 *   [{ id, name, documents: [...] }, ...]
 *
 * @param {Array} apiDataList - 後端文件扁平陣列
 * @param {Array} [catalogs] - 可選的 catalog 列表（確保空館也出現）
 *   每個 catalog: { catalogId, name, description, docCount, createdAt }
 * @returns {Array} 前端格式的圖書館分組陣列
 */
export function adaptLibraryDocs(apiDataList, catalogs) {
  if (!Array.isArray(apiDataList)) apiDataList = [];

  const groupMap = new Map();

  // 如果有 catalogs，先建立空的分組（確保空館也出現）
  if (Array.isArray(catalogs) && catalogs.length > 0) {
    catalogs.forEach((cat, idx) => {
      const catName = cat.name || cat.library_name || '';
      if (catName && !groupMap.has(catName)) {
        groupMap.set(catName, {
          id: cat.catalogId || `cat-${idx + 1}`,
          name: catName,
          imageUrl: cat.imageUrl || null,
          documents: [],
        });
      }
    });
  }

  apiDataList.forEach((item) => {
    const doc = adaptLibraryDoc(item);
    if (!doc) return;

    const libName = doc._libraryName;
    if (!groupMap.has(libName)) {
      groupMap.set(libName, {
        id: groupMap.size + 1,
        name: libName,
        documents: [],
      });
    }

    // 移除內部欄位後加入 documents
    const { _libraryName, ...cleanDoc } = doc;
    groupMap.get(libName).documents.push(cleanDoc);
  });

  return Array.from(groupMap.values());
}

/**
 * 多筆文件轉換（扁平列表，不分組）— 首頁最新文件用
 *
 * @param {Array} apiDataList - 後端文件扁平陣列
 * @returns {Array} 前端格式的文件扁平陣列（不含內部欄位 _libraryName）
 */
export function adaptLibraryDocsFlat(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList
    .map(adaptLibraryDoc)
    .filter(Boolean)
    .map(({ _libraryName, ...doc }) => doc);
}

// ============================================================
// 使用者 (User)  —  後端 → 前端
// ============================================================

/**
 * 單筆使用者：後端 UserListResponse → 前端 user 物件
 *
 * 後端欄位 (schemas.UserListResponse):
 *   email (PK), name, department, country, role, status, last_login_at, created_at
 *
 * 前端欄位 (mockData.userList[]):
 *   id, name, email, department, role, country, status
 *
 * @param {object} apiData - 後端 API 回傳的使用者物件
 * @returns {object} 前端格式的使用者物件
 */
export function adaptUser(apiData) {
  if (!apiData) return null;

  return {
    id: apiData.email, // 後端以 email 作為 PK
    name: apiData.name ?? '',
    email: apiData.email ?? '',
    department: apiData.department ?? '',
    role: apiData.role ?? '',
    country: apiData.country ?? '',
    status: apiData.status ?? 'active',
  };
}

/**
 * 多筆使用者轉換
 * @param {Array} apiDataList - 後端使用者陣列
 * @returns {Array} 前端格式的使用者陣列
 */
export function adaptUsers(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList.map(adaptUser).filter(Boolean);
}

// ============================================================
// 聊天歷史 (Chat History)  —  後端 → 前端
// ============================================================

/**
 * [Deprecated] 單筆聊天歷史：後端 ChatHistoryItem → 前端 chatHistory 物件
 * 請改用 adaptSessionSummary
 */
export function adaptChatHistoryItem(apiData) {
  if (!apiData) return null;

  return {
    id: apiData.chat_id,
    agentId: apiData.agent_id,
    agentName: apiData.agent_name ?? '',
    lastMessage: apiData.last_message ?? '',
    timestamp: apiData.updated_at || apiData.timestamp || '',
    messages: Array.isArray(apiData.messages) ? apiData.messages : [],
  };
}

/**
 * [Deprecated] 多筆聊天歷史轉換
 * 請改用 adaptSessionList
 */
export function adaptChatHistory(apiDataList) {
  if (!Array.isArray(apiDataList)) return [];
  return apiDataList.map(adaptChatHistoryItem).filter(Boolean);
}

// ============================================================
// 對話 Session（新版）  —  後端 → 前端
// ============================================================

/**
 * 將 ISO 日期轉為 "YYYY-MM-DD HH:mm" 格式
 * @param {string} isoString - ISO 8601 格式的日期字串
 * @returns {string} 格式化的日期時間字串
 */
export function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * 單筆 Session 摘要：後端 SessionSummary → 前端物件
 *
 * 後端欄位 (schemas.SessionSummary):
 *   session_id, agent_id, agent_name, title, last_message_preview,
 *   message_count, created_at, updated_at
 *
 * @param {object} apiData - 後端 API 回傳的 Session 摘要
 * @returns {object} 前端格式的 Session 物件
 */
export function adaptSessionSummary(apiData) {
  if (!apiData) return null;

  return {
    sessionId: apiData.session_id,
    agentId: apiData.agent_id,
    agentName: apiData.agent_name ?? '',
    title: apiData.title ?? '',
    lastMessagePreview: apiData.last_message_preview ?? '',
    messageCount: apiData.message_count ?? 0,
    createdAt: apiData.created_at,
    updatedAt: apiData.updated_at,
    formattedTime: formatDateTime(apiData.updated_at || apiData.created_at),
  };
}

/**
 * Session 列表回應轉換
 *
 * 後端欄位 (schemas.SessionListResponse):
 *   sessions, total, page, page_size
 *
 * @param {object} apiData - 後端 API 回傳的列表回應
 * @returns {object} { sessions: [...], total, page, pageSize }
 */
export function adaptSessionList(apiData) {
  if (!apiData) return { sessions: [], total: 0, page: 1, pageSize: 20 };

  return {
    sessions: Array.isArray(apiData.sessions)
      ? apiData.sessions.map(adaptSessionSummary).filter(Boolean)
      : [],
    total: apiData.total ?? 0,
    page: apiData.page ?? 1,
    pageSize: apiData.page_size ?? 20,
  };
}

/**
 * Session 詳情轉換（含訊息列表）
 *
 * 後端欄位 (schemas.SessionDetailResponse):
 *   session_id, agent_id, agent_name, title, thread_id, messages, created_at, updated_at
 *
 * @param {object} apiData - 後端 API 回傳的 Session 詳情
 * @returns {object} 前端格式的 Session 詳情
 */
export function adaptSessionDetail(apiData) {
  if (!apiData) return null;

  return {
    sessionId: apiData.session_id,
    agentId: apiData.agent_id,
    agentName: apiData.agent_name ?? '',
    title: apiData.title ?? '',
    threadId: apiData.thread_id ?? null,
    messages: Array.isArray(apiData.messages)
      ? apiData.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          time: formatDateTime(msg.created_at),
        }))
      : [],
    createdAt: apiData.created_at,
    updatedAt: apiData.updated_at,
  };
}

// ============================================================
// 反向轉換：前端 → 後端
// ============================================================

/**
 * 前端公告表單 → 後端 AnnouncementCreate 格式
 *
 * 後端 schema (schemas.AnnouncementCreate):
 *   subject, content_en, publish_status, files
 *
 * @param {object} frontendData - 前端表單資料
 * @returns {object} 後端 create API 所需格式
 */
export function toAnnouncementCreate(frontendData) {
  if (!frontendData) return null;

  const files = [];
  if (frontendData.attachment) {
    files.push({
      name: frontendData.attachment.name || '',
      cover_url: frontendData.attachment.coverUrl || '',
      file_url: frontendData.attachment.pdfUrl || '',
    });
  }

  // 關聯的圖書館文件
  const library_docs = [];
  if (Array.isArray(frontendData.libraryDocs)) {
    frontendData.libraryDocs.forEach((doc) => {
      library_docs.push({
        doc_id: doc.docId || doc.doc_id || '',
        name: doc.name || '',
        library_name: doc.libraryName || doc.library_name || '',
      });
    });
  }

  return {
    subject: frontendData.subject ?? '',
    content_en: frontendData.content ?? '',
    publish_status: frontendData.publishStatus || 'draft',
    files,
    library_docs,
  };
}

/**
 * 前端公告表單 → 後端 AnnouncementUpdate 格式
 *
 * 後端 schema (schemas.AnnouncementUpdate):
 *   subject?, content_en?, publish_status?, files?
 *
 * 只包含有值的欄位，避免覆蓋未修改的資料
 *
 * @param {object} frontendData - 前端表單資料
 * @returns {object} 後端 update API 所需格式
 */
export function toAnnouncementUpdate(frontendData) {
  if (!frontendData) return null;

  const payload = {};

  if (frontendData.subject !== undefined) {
    payload.subject = frontendData.subject;
  }

  if (frontendData.content !== undefined) {
    payload.content_en = frontendData.content;
  }

  if (frontendData.publishStatus !== undefined) {
    payload.publish_status = frontendData.publishStatus;
  }

  if (frontendData.attachment !== undefined) {
    if (frontendData.attachment === null) {
      payload.files = [];
    } else {
      payload.files = [
        {
          name: frontendData.attachment.name || '',
          cover_url: frontendData.attachment.coverUrl || '',
          file_url: frontendData.attachment.pdfUrl || '',
        },
      ];
    }
  }

  // 關聯的圖書館文件
  if (frontendData.libraryDocs !== undefined) {
    if (!frontendData.libraryDocs || frontendData.libraryDocs.length === 0) {
      payload.library_docs = [];
    } else {
      payload.library_docs = frontendData.libraryDocs.map((doc) => ({
        doc_id: doc.docId || doc.doc_id || '',
        name: doc.name || '',
        library_name: doc.libraryName || doc.library_name || '',
      }));
    }
  }

  return payload;
}

/**
 * 前端使用者表單 → 後端 UserCreate 格式
 *
 * 後端 schema (schemas.UserCreate):
 *   email, name, department?, country, role?
 *
 * @param {object} frontendData - 前端表單資料
 * @returns {object} 後端 create API 所需格式
 */
export function toUserCreate(frontendData) {
  if (!frontendData) return null;

  return {
    email: frontendData.email ?? '',
    name: frontendData.name ?? '',
    department: frontendData.department || null,
    country: frontendData.country ?? '',
    role: frontendData.role || 'user',
  };
}
