// ===== 角色定義 =====
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  PLATFORM_ADMIN: 'platform_admin',
  USER_MANAGER: 'user_manager',
  LIBRARY_MANAGER: 'library_manager',
  USER: 'user',
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: '台灣最高管理者',
  [ROLES.PLATFORM_ADMIN]: '平台管理者',
  [ROLES.USER_MANAGER]: '用戶管理者',
  [ROLES.LIBRARY_MANAGER]: '圖書館管理者',
  [ROLES.USER]: '一般使用者',
};

export const ROLE_COLORS = {
  [ROLES.SUPER_ADMIN]: '#FFD700',
  [ROLES.PLATFORM_ADMIN]: '#FF6B6B',
  [ROLES.USER_MANAGER]: '#4ECDC4',
  [ROLES.LIBRARY_MANAGER]: '#45B7D1',
  [ROLES.USER]: '#95E1D3',
};

// 角色階層等級（數字越大權限越高）
export const ROLE_HIERARCHY = {
  [ROLES.SUPER_ADMIN]: 4,
  [ROLES.PLATFORM_ADMIN]: 3,
  [ROLES.USER_MANAGER]: 2,
  [ROLES.LIBRARY_MANAGER]: 2,
  [ROLES.USER]: 1,
};

// 取得角色等級
export const getRoleLevel = (role) => ROLE_HIERARCHY[role] || 0;

// 檢查操作者是否可以操作目標使用者
export const canOperateUser = (operatorRole, operatorEmail, targetRole, targetEmail) => {
  // 不能操作自己
  if (operatorEmail && targetEmail && operatorEmail.toLowerCase() === targetEmail.toLowerCase()) {
    return false;
  }
  // 不能操作等級 >= 自己的使用者
  return getRoleLevel(operatorRole) > getRoleLevel(targetRole);
};

// 取得可指派的角色列表（等級 < 自己的角色）— 前端 fallback 用
export const getAssignableRoles = (operatorRole) => {
  const operatorLevel = getRoleLevel(operatorRole);
  return Object.entries(ROLE_HIERARCHY)
    .filter(([, level]) => level < operatorLevel)
    .map(([role]) => ({ value: role, label: ROLE_LABELS[role] }))
    .sort((a, b) => (ROLE_HIERARCHY[b.value] || 0) - (ROLE_HIERARCHY[a.value] || 0));
};

// 角色權限定義
export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    'view_announcements', 'use_agents', 'view_library', 'chat_history',
    'manage_users', 'manage_library', 'manage_announcements', 'manage_agent_permissions',
    'access_all_agents', 'access_all_docs', 'cross_country_logs',
  ],
  [ROLES.PLATFORM_ADMIN]: [
    'view_announcements', 'use_agents', 'view_library', 'chat_history',
    'manage_users', 'manage_library', 'manage_announcements', 'manage_agent_permissions',
    'access_all_agents', 'access_all_docs',
  ],
  [ROLES.USER_MANAGER]: [
    'view_announcements', 'use_agents', 'view_library', 'chat_history',
    'manage_users',
  ],
  [ROLES.LIBRARY_MANAGER]: [
    'view_announcements', 'use_agents', 'view_library', 'chat_history',
    'manage_library',
  ],
  [ROLES.USER]: [
    'view_announcements', 'use_agents', 'view_library', 'chat_history',
  ],
};

// 檢查角色是否有特定權限
export const hasPermission = (role, permission) => {
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
};

// ===== 公告資料 =====
export const announcements = [
  {
    id: 1,
    subject: '海外規範更版',
    date: '2026.01.01',
    isNew: true,
    content:
      'The overseas compliance framework has been updated to version 3.2. All project managers are required to review the updated guidelines and ensure alignment with the new regulatory standards before Q2 2026.',
    attachment: {
      name: 'Overseas_Compliance_v3.2.pdf',
      coverUrl: '/mock-cover-1.png',
      pdfUrl: '#',
    },
  },
  {
    id: 2,
    subject: '專案方法論',
    date: '2025.12.01',
    isNew: true,
    content:
      'A new project methodology has been introduced to streamline cross-functional collaboration. The methodology integrates agile and waterfall approaches for hybrid project management across departments.',
    attachment: {
      name: 'Project_Methodology_2026.pdf',
      coverUrl: '/mock-cover-2.png',
      pdfUrl: '#',
    },
  },
  {
    id: 3,
    subject: '年度資安政策更新',
    date: '2025.11.15',
    isNew: false,
    content:
      'Annual cybersecurity policy has been revised. All employees must complete the mandatory security training by end of January 2026. Please refer to the attached document for details.',
    attachment: {
      name: 'Security_Policy_2026.pdf',
      coverUrl: '/mock-cover-3.png',
      pdfUrl: '#',
    },
  },
  {
    id: 4,
    subject: '新進人員訓練手冊',
    date: '2025.10.20',
    isNew: false,
    content:
      'The onboarding training manual has been updated with new modules covering cloud architecture basics and internal tool usage. New hires should complete all modules within their first month.',
    attachment: null,
  },
];

// ===== Agent 資料 =====
export const agents = [
  {
    id: 1,
    name: '【EPMO】VMO Satellite',
    model: 'gpt-4o',
    status: '可用',
    icon: '🛰️',
    color: '#4FC3F7',
    description: 'VMO 衛星監控代理，協助追蹤專案進度與風險。',
  },
  {
    id: 2,
    name: '【EPMO】Talent Agent',
    model: 'gpt-4o',
    status: '可用',
    icon: '👤',
    color: '#81C784',
    description: '人才管理代理，協助人力資源配置與評估。',
  },
  {
    id: 3,
    name: '【EPMO】RISKO.beta(影印問題版)',
    model: 'gpt-4o',
    status: '可用',
    icon: '🔥',
    color: '#FF8A65',
    description: '風險評估代理，識別並分析專案潛在風險。',
  },
  {
    id: 4,
    name: '【EPMO】Coordinator Agent (Dr. PJ Jr.)',
    model: 'gpt-4.1',
    status: '可用',
    icon: '🤖',
    color: '#9575CD',
    description: '專案協調代理，協助跨部門溝通與任務分配。',
  },
  {
    id: 5,
    name: '【EPMO】project 專案顧問',
    model: 'gpt-4.1',
    status: '可用',
    icon: '📋',
    color: '#4DB6AC',
    description: '專案顧問代理，提供專案管理建議與最佳實踐。',
  },
];

// ===== 對話歷史 =====
export const chatHistory = [
  {
    id: 1,
    agentId: 4,
    agentName: '【EPMO】Coordinator Agent (Dr. PJ Jr.)',
    lastMessage: '已完成本週專案進度報告的彙整...',
    timestamp: '2026-01-15 14:30',
    messages: [
      { role: 'user', content: '請幫我彙整本週專案進度報告', time: '14:25' },
      {
        role: 'assistant',
        content: '已完成本週專案進度報告的彙整，以下是各部門的進度摘要...',
        time: '14:30',
      },
    ],
  },
  {
    id: 2,
    agentId: 5,
    agentName: '【EPMO】project 專案顧問',
    lastMessage: '根據您的需求，建議採用敏捷開發方法...',
    timestamp: '2026-01-14 10:15',
    messages: [
      { role: 'user', content: '新專案應該用什麼開發方法？', time: '10:10' },
      {
        role: 'assistant',
        content: '根據您的需求，建議採用敏捷開發方法，以下是詳細建議...',
        time: '10:15',
      },
    ],
  },
  {
    id: 3,
    agentId: 1,
    agentName: '【EPMO】VMO Satellite',
    lastMessage: '目前有 3 個專案存在延遲風險...',
    timestamp: '2026-01-13 16:45',
    messages: [
      { role: 'user', content: '目前有哪些專案有延遲風險？', time: '16:40' },
      {
        role: 'assistant',
        content: '目前有 3 個專案存在延遲風險，分別是...',
        time: '16:45',
      },
    ],
  },
];

// ===== 線上圖書館 =====
export const libraries = [
  {
    id: 1,
    name: 'Cloud Architecture',
    documents: [
      {
        id: 101,
        name: 'AWS Best Practices Guide',
        description: 'Comprehensive guide for AWS cloud architecture design patterns and best practices.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 102,
        name: 'Azure Fundamentals',
        description: 'Introduction to Microsoft Azure services and cloud computing concepts.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 103,
        name: 'GCP Infrastructure Design',
        description: 'Google Cloud Platform infrastructure design and deployment strategies.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 104,
        name: 'Multi-Cloud Strategy',
        description: 'Strategies for implementing and managing multi-cloud environments.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 105,
        name: 'Cloud Security Framework',
        description: 'Security frameworks and compliance standards for cloud deployments.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
    ],
  },
  {
    id: 2,
    name: 'Project Management',
    documents: [
      {
        id: 201,
        name: 'Agile Methodology Handbook',
        description: 'Complete handbook for agile project management methodologies.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 202,
        name: 'Risk Assessment Templates',
        description: 'Templates and guidelines for project risk assessment and mitigation.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 203,
        name: 'Stakeholder Communication Plan',
        description: 'Best practices for stakeholder communication and engagement.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
    ],
  },
  {
    id: 3,
    name: 'Compliance & Regulations',
    documents: [
      {
        id: 301,
        name: 'GDPR Compliance Guide',
        description: 'Guidelines for ensuring GDPR compliance in data processing activities.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
      {
        id: 302,
        name: 'ISO 27001 Standards',
        description: 'Information security management system standards and implementation.',
        coverUrl: '/mock-doc-cover.png',
        pdfUrl: '#',
      },
    ],
  },
];

// ===== 國家列表 =====
export const countries = [
  { code: 'TW', name: '台灣' },
  { code: 'JP', name: '日本' },
  { code: 'SG', name: '新加坡' },
  { code: 'TH', name: '泰國' },
  { code: 'VN', name: '越南' },
  { code: 'PH', name: '菲律賓' },
];

// ===== 部門代碼列表 =====
export const DEPARTMENTS = [
  'planning',
  'rd',
  'marketing',
  'finance',
  'hr',
  'it',
  'management',
];

// ===== 使用者資料 =====
export const currentUser = {
  id: 1,
  name: 'Tina',
  email: 'tina@ctbc.com',
  role: ROLES.PLATFORM_ADMIN,
  department: 'planning',
  country: 'TW',
  memberCount: 18,
  agentCount: 33,
};

// ===== 使用者列表（用於權限設定）=====
export const userList = [
  { id: 1, name: 'Tina', email: 'tina@ctbc.com', department: 'planning', role: ROLES.PLATFORM_ADMIN, country: 'TW', status: 'active' },
  { id: 2, name: 'John', email: 'john@ctbc.com', department: 'rd', role: ROLES.USER_MANAGER, country: 'TW', status: 'active' },
  { id: 3, name: 'Alice', email: 'alice@ctbc.com', department: 'marketing', role: ROLES.LIBRARY_MANAGER, country: 'TW', status: 'active' },
  { id: 4, name: 'Bob', email: 'bob@ctbc.com.sg', department: 'finance', role: ROLES.USER, country: 'SG', status: 'active' },
  { id: 5, name: 'Carol', email: 'carol@ctbc.com', department: 'hr', role: ROLES.USER, country: 'TW', status: 'active' },
  { id: 6, name: 'David', email: 'david@ctbc.co.jp', department: 'rd', role: ROLES.USER, country: 'JP', status: 'active' },
  { id: 7, name: 'Eva', email: 'eva@ctbc.com', department: 'planning', role: ROLES.USER, country: 'TW', status: 'inactive' },
  { id: 8, name: 'Frank', email: 'frank@ctbc.co.th', department: 'marketing', role: ROLES.USER, country: 'TH', status: 'active' },
];
