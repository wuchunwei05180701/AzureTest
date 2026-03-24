import axios from 'axios';

// ===== Token 管理 =====
const TOKEN_KEY = 'ctbc_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const removeToken = () => localStorage.removeItem(TOKEN_KEY);

// ===== Axios Instance =====
// 偵測是否在 /AzureTest/ 路徑下（Nginx 反向代理）
export const BASE_PREFIX = window.location.pathname.startsWith('/AzureTest') ? '/AzureTest' : '';

const api = axios.create({
  baseURL: `${BASE_PREFIX}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor：自動附加 Authorization header
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor：401 時自動清除 token 並跳轉到 login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      removeToken();
      // 避免在 login 頁面重複跳轉
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/AzureTest/login';
      }
    }
    return Promise.reject(error);
  }
);

// ===== 認證 API =====
export const authAPI = {
  requestOTP: (email) =>
    api.post('/auth/request-otp', { email }),

  verifyOTP: (email, otpCode) =>
    api.post('/auth/verify-otp', { email, otp_code: otpCode }),

  getMe: () =>
    api.get('/auth/me'),

  logout: () =>
    api.post('/auth/logout'),

  /** 更新個人資料（姓名）
   * @param {object} data - { name? }
   */
  updateProfile: (data) =>
    api.patch('/auth/profile', data),

  /** 上傳頭貼
   * @param {FormData} formData - 包含 file 的 FormData
   */
  uploadAvatar: (formData) =>
    api.post('/auth/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  /** 刪除頭貼 */
  deleteAvatar: () =>
    api.delete('/auth/avatar'),

  /** 取得頭貼 URL（回傳 blob URL）*/
  getAvatarUrl: () => {
    const token = getToken();
    return `${BASE_PREFIX}/api/auth/avatar`;
  },
};

// ===== 使用者管理 API =====
export const userAPI = {
  list: (params) =>
    api.get('/users', { params }),

  create: (data) =>
    api.post('/users', data),

  update: (email, data) =>
    api.put(`/users/${encodeURIComponent(email)}`, data),

  updateStatus: (email, status) =>
    api.patch(`/users/${encodeURIComponent(email)}/status`, { status }),

  updateRole: (email, role) =>
    api.patch(`/users/${encodeURIComponent(email)}/role`, { role }),

  getAssignableRoles: () =>
    api.get('/users/assignable-roles'),

  delete: (email) =>
    api.delete(`/users/${encodeURIComponent(email)}`),
};

// ===== Agent API =====
export const agentAPI = {
  list: () =>
    api.get('/agents'),

  listAll: () =>
    api.get('/agents/all'),

  updatePublish: (agentId, isPublished) =>
    api.put(`/agents/${agentId}/publish`, { is_published: isPublished }),

  updateACL: (agentId, aclData) =>
    api.put(`/agents/${agentId}/acl`, aclData),
};

// ===== 公告 API =====
export const announcementAPI = {
  /** @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   *  @param {number} [limit] - 回傳筆數上限（不指定則回傳全部）
   */
  list: (country, limit) =>
    api.get('/announcements', { params: { ...(country ? { country } : {}), ...(limit ? { limit } : {}) } }),

  /** @param {string} [country] - 國家代碼（僅 super_admin 可跨國） */
  listAll: (country) =>
    api.get('/announcements/all', { params: country ? { country } : {} }),

  /** @param {string} [country] - 目標國家（僅 super_admin 可跨國建立） */
  create: (data, country) =>
    api.post('/announcements', data, { params: country ? { country } : {} }),

  /** 一步到位建立公告（含附件上傳 + PII 掃描）
   * @param {FormData} formData - 包含 file 的 FormData（可多個）
   * @param {object} params - { subject, content_en, publish_status, country? }
   */
  createWithFiles: (formData, params) =>
    api.post('/announcements/create-with-files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params,
    }),

  /** @param {string} [country] - 目標國家（僅 super_admin 可跨國編輯） */
  update: (noticeId, data, country) =>
    api.put(`/announcements/${noticeId}`, data, { params: country ? { country } : {} }),

  /** @param {string} [country] - 目標國家（僅 super_admin 可跨國刪除） */
  delete: (noticeId, country) =>
    api.delete(`/announcements/${noticeId}`, { params: country ? { country } : {} }),

  /** 下載公告附件
   * @param {string} noticeId - 公告 ID
   * @param {string} [country] - 國家代碼
   * @param {string} [filename] - 指定下載的檔案名稱（多附件時使用）
   */
  download: (noticeId, country, filename) =>
    api.get(`/announcements/${noticeId}/download`, {
      responseType: 'blob',
      params: {
        ...(country ? { country } : {}),
        ...(filename ? { filename } : {}),
      },
    }),

  /** 預覽公告附件 PDF（回傳 blob）
   * @param {string} noticeId - 公告 ID
   * @param {string} [country] - 國家代碼
   * @param {string} [filename] - 指定預覽的檔案名稱（多附件時使用）
   */
  preview: (noticeId, country, filename) =>
    api.get(`/announcements/${noticeId}/preview`, {
      responseType: 'blob',
      params: {
        ...(country ? { country } : {}),
        ...(filename ? { filename } : {}),
      },
    }),

  /** 上傳公告附件（支援多檔案）
   * @param {string} noticeId - 公告 ID
   * @param {FormData} formData - 包含 file 的 FormData（可多個）
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  uploadFile: (noticeId, formData, country) =>
    api.post('/announcements/upload-file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { notice_id: noticeId, ...(country ? { country } : {}) },
    }),

  /** 刪除公告的單一附件
   * @param {string} noticeId - 公告 ID
   * @param {string} filename - 要刪除的附件檔名
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  deleteFile: (noticeId, filename, country) =>
    api.delete(`/announcements/${noticeId}/file`, {
      params: { filename, ...(country ? { country } : {}) },
    }),
};

// ===== PII 偵測 API =====
export const piiAPI = {
  /** 預掃描上傳檔案中的 PII（不儲存檔案）
   * @param {FormData} formData - 包含 file 的 FormData（可多個）
   * @returns {Promise} { has_pii, files: [{ filename, has_pii, entity_count, entity_types }], message }
   */
  scanFiles: (formData) =>
    api.post('/pii/scan-files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// ===== 圖書館 API =====
export const libraryAPI = {
  /** @param {string} [country] - 國家代碼（僅 super_admin 可跨國） */
  list: (country) =>
    api.get('/library', { params: country ? { country } : {} }),

  /** 取得最新的圖書館文件（首頁用，按建立時間倒序）
   * @param {string} [country] - 國家代碼
   * @param {number} [limit=4] - 回傳筆數
   */
  latest: (country, limit = 4) =>
    api.get('/library/latest', {
      params: {
        ...(country ? { country } : {}),
        limit,
      },
    }),

  /** @param {string} [country] - 國家代碼（僅 super_admin 可跨國） */
  listAll: (country) =>
    api.get('/library/all', { params: country ? { country } : {} }),

  upload: (formData, config = {}) =>
    api.post('/library/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...config,
    }),

  /** @param {object} [config] - axios config（可含 params.country） */
  delete: (docId, config = {}) =>
    api.delete(`/library/${docId}`, config),

  /** 編輯文件資訊（名稱、描述、館名）
   * @param {string} docId - 文件 ID
   * @param {object} data - { name?, description?, library_name? }
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  update: (docId, data, country) =>
    api.put(`/library/${docId}`, data, { params: country ? { country } : {} }),

  /** 刪除文件的單一附件
   * @param {string} docId - 文件 ID
   * @param {string} filename - 要刪除的附件檔名
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  deleteFile: (docId, filename, country) =>
    api.delete(`/library/${docId}/file`, {
      params: { filename, ...(country ? { country } : {}) },
    }),

  /** 追加上傳附件到已有文件（支援多檔案）
   * @param {string} docId - 文件 ID
   * @param {FormData} formData - 包含 file 的 FormData（可多個）
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  uploadFile: (docId, formData, country) =>
    api.post(`/library/${docId}/upload-file`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: country ? { country } : {},
    }),

  /** @param {string} [country] - 國家代碼（僅 super_admin 可跨國） */
  updateAuth: (docId, authData, country) =>
    api.put(`/library/${docId}/auth`, authData, { params: country ? { country } : {} }),

  /** 下載文件
   * @param {string} docId - 文件 ID
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   * @param {string} [filename] - 指定下載的檔案名稱（多檔案時使用）
   */
  download: (docId, country, filename) =>
    api.get(`/library/${docId}/download`, {
      responseType: 'blob',
      params: {
        ...(country ? { country } : {}),
        ...(filename ? { filename } : {}),
      },
    }),

  /** 預覽 PDF（回傳 blob）
   * @param {string} docId - 文件 ID
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   * @param {string} [filename] - 指定預覽的檔案名稱（多檔案時使用）
   * @param {boolean} [record=true] - 是否記錄稽核日誌（縮圖載入時傳 false）
   */
  preview: (docId, country, filename, record = true) =>
    api.get(`/library/${docId}/preview`, {
      responseType: 'blob',
      headers: {
        // 防止瀏覽器快取，確保每次都發送請求到後端（record=true 時需要記錄稽核日誌）
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      params: {
        ...(country ? { country } : {}),
        ...(filename ? { filename } : {}),
        ...(record === false ? { record: false } : {}),
      },
    }),

  /** 上傳館封面圖片
   * @param {string} catalogId - 館 ID
   * @param {FormData} formData - 包含 file 的 FormData
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  uploadCatalogImage: (catalogId, formData, country) =>
    api.post(`/library/catalogs/${catalogId}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: country ? { country } : {},
    }),

  /** 取得館封面圖片（回傳 blob）
   * @param {string} catalogId - 館 ID
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  getCatalogImage: (catalogId, country) =>
    api.get(`/library/catalogs/${catalogId}/image`, {
      responseType: 'blob',
      params: country ? { country } : {},
    }),

  /** 刪除館封面圖片
   * @param {string} catalogId - 館 ID
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  deleteCatalogImage: (catalogId, country) =>
    api.delete(`/library/catalogs/${catalogId}/image`, {
      params: country ? { country } : {},
    }),

  /** 刪除整個館（僅限空館，同時刪除 catalog 記錄）
   * @param {string} libraryName - 館名
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  deleteLibrary: (libraryName, country) =>
    api.delete(`/library/by-library/${encodeURIComponent(libraryName)}`, {
      params: country ? { country } : {},
    }),

  /** 取得所有館名列表（含各館文件數量）
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  listCatalogs: (country) =>
    api.get('/library/catalogs', { params: country ? { country } : {} }),

  /** 手動建立新館（不需要同時上傳文件）
   * @param {object} data - { library_name, description? }
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  createCatalog: (data, country) =>
    api.post('/library/catalogs', data, { params: country ? { country } : {} }),

  /** 更新館名或描述（若館名變更，後端會同步更新所有文件的 library_name）
   * @param {string} catalogId - 館 ID
   * @param {object} data - { library_name?, description? }
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  updateCatalog: (catalogId, data, country) =>
    api.put(`/library/catalogs/${catalogId}`, data, { params: country ? { country } : {} }),

  /** 記錄文件點擊（開啟文件 Modal 時呼叫）
   * @param {string} docId - 文件 ID
   * @param {string} [country] - 國家代碼（僅 super_admin 可跨國）
   */
  recordView: (docId, country) =>
    api.post(`/library/${docId}/view`, {}, { params: country ? { country } : {} }),

  /** 取得圖書館統計資料
   * @param {object} params - { country?, date_from?, date_to? }
   */
  getStats: (params = {}) =>
    api.get('/library/stats/summary', { params }),
};

// ===== 對話 API =====
export const chatAPI = {
  /** 非 streaming 發送訊息 */
  send: (data) =>
    api.post('/chat', data),

  /** [Deprecated] 取得對話歷史列表（舊版，請改用 sessions） */
  history: () =>
    api.get('/chat/history'),

  /** [Deprecated] 取得單一對話詳情（舊版，請改用 sessionDetail） */
  detail: (chatId) =>
    api.get(`/chat/${chatId}`),

  /** 取得對話 Session 列表（分頁）
   * @param {object} params - { page, page_size, agent_id }
   */
  sessions: (params) =>
    api.get('/chat/sessions', { params }),

  /** 取得對話 Session 詳情（含所有訊息）
   * @param {string} sessionId - Session ID (sess-xxx)
   */
  sessionDetail: (sessionId) =>
    api.get(`/chat/sessions/${sessionId}`),

  /** 刪除對話 Session
   * @param {string} sessionId - Session ID (sess-xxx)
   */
  deleteSession: (sessionId) =>
    api.delete(`/chat/sessions/${sessionId}`),

  /**
   * Streaming 聊天（SSE）— 整合 Agatha Public API
   *
   * @param {object} data - { agent_id, message, session_id }
   * @param {function} onMessage - 收到 SSE 事件時的回調 (eventData)
   * @param {function} onComplete - 串流結束時的回調
   * @param {function} onError - 錯誤時的回調 (error)
   * @returns {function} abort - 呼叫此函式可中斷串流
   */
  stream: (data, onMessage, onComplete, onError) => {
    const controller = new AbortController();

    (async () => {
      try {
        const token = getToken();
        // 過濾掉 undefined/null 的欄位（如 images 為空時不傳）
        const payload = { ...data };
        if (!payload.images || payload.images.length === 0) {
          delete payload.images;
        }

        const response = await fetch(`${BASE_PREFIX}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errorMessage = `服務錯誤 (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.detail || errorData.message || errorMessage;
          } catch (_) {
            // 無法解析 JSON，使用預設錯誤訊息
          }
          throw new Error(errorMessage);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();

          if (!done) {
            buffer += decoder.decode(value, { stream: true });
          }

          const lines = buffer.split('\n');

          if (done) {
            buffer = '';
          } else {
            buffer = lines.pop() || '';
          }

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 跳過 [DONE] 標記
            if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
              continue;
            }

            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') continue;

              try {
                const jsonData = JSON.parse(dataStr);

                // 錯誤事件 → 呼叫 onError 並中斷
                if (jsonData.type === 'error') {
                  if (onError) onError(new Error(jsonData.message || 'AI 服務錯誤'));
                  try { await reader.cancel(); } catch (_) {}
                  return;
                }

                // 轉發事件給前端
                if (onMessage) onMessage(jsonData);
              } catch (e) {
                console.warn('⚠️ 解析 SSE 資料失敗:', trimmed.substring(0, 80), e.message);
              }
            }
          }

          if (done) {
            if (onComplete) onComplete();
            break;
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          // 使用者主動中斷，不視為錯誤
          if (onComplete) onComplete();
          return;
        }
        console.error('❌ Streaming 聊天錯誤:', error);
        if (onError) onError(error);
      }
    })();

    // 回傳 abort 函式
    return () => controller.abort();
  },
};

// ===== 國家 API =====
export const countryAPI = {
  /** 取得已設定 Local DB 的國家列表 */
  list: () =>
    api.get('/countries'),
};

// ===== 稽核日誌 API =====
export const auditAPI = {
  /**
   * 查詢稽核日誌（分頁 + 篩選）
   * @param {object} params - { page, page_size, user_email, action, action_category, country_code, result, target, date_from, date_to }
   */
  list: (params = {}) =>
    api.get('/audit-logs', { params }),

  /**
   * 取得所有 action 類型列表（供篩選下拉選單用）
   */
  listActions: () =>
    api.get('/audit-logs/actions'),

  /**
   * 匯出稽核日誌為 CSV
   * @param {object} params - 篩選條件（同 list）
   */
  export: (params = {}) =>
    api.get('/audit-logs/export', {
      params,
      responseType: 'blob',
    }),
};

export default api;
