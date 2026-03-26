import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { AuthProvider } from './contexts/AuthContext';
import { CountryProvider } from './contexts/CountryContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ChatProvider } from './contexts/ChatContext';
import AntdLocaleWrapper from './components/AntdLocaleWrapper';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import AgentStore from './pages/AgentStore';
import AgentChat from './pages/AgentChat';
import ChatHistory from './pages/ChatHistory';
import Library from './pages/Library';
import AnnouncementSettings from './pages/settings/AnnouncementSettings';
import AgentPermissions from './pages/settings/AgentPermissions';
import LibrarySettings from './pages/settings/LibrarySettings';
import LibraryStats from './pages/settings/LibraryStats';
import UserManagement from './pages/settings/UserManagement';
import AuditLogs from './pages/settings/AuditLogs';

const App = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2aabb3',
          borderRadius: 6,
        },
      }}
    >
      <AuthProvider>
        <CountryProvider>
          <LanguageProvider>
            <AntdLocaleWrapper>
              <BrowserRouter basename="/AzureTest">
                {/* ChatProvider 包在 BrowserRouter 內，讓 chatAPI 可使用 token，
                    同時讓狀態在路由切換時保持存活 */}
                <ChatProvider>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route element={<ProtectedRoute />}>
                      <Route path="/" element={<Layout />}>
                        <Route index element={<Home />} />
                        <Route path="agent-store" element={<AgentStore />} />
                        <Route path="agent-store/chat" element={<AgentChat />} />
                        <Route path="agent-store/history" element={<ChatHistory />} />
                        <Route path="library" element={<Library />} />

                        {/* Settings 路由 — 各自需要對應權限 */}
                        <Route element={<ProtectedRoute requiredPermission="manage_announcements" />}>
                          <Route path="settings/announcements" element={<AnnouncementSettings />} />
                        </Route>
                        <Route element={<ProtectedRoute requiredPermission="manage_agent_permissions" />}>
                          <Route path="settings/agent-permissions" element={<AgentPermissions />} />
                        </Route>
                        <Route element={<ProtectedRoute requiredPermission="manage_library" />}>
                          <Route path="settings/library" element={<LibrarySettings />} />
                          <Route path="settings/library-stats" element={<LibraryStats />} />
                        </Route>
                        <Route element={<ProtectedRoute requiredPermission="manage_users" />}>
                          <Route path="settings/users" element={<UserManagement />} />
                        </Route>
                        <Route element={<ProtectedRoute requiredPermission="cross_country_logs" />}>
                          <Route path="settings/audit-logs" element={<AuditLogs />} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Route>
                    </Route>
                  </Routes>
                </ChatProvider>
              </BrowserRouter>
            </AntdLocaleWrapper>
          </LanguageProvider>
        </CountryProvider>
      </AuthProvider>
    </ConfigProvider>
  );
};

export default App;
