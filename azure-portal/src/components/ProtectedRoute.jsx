import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';

/**
 * ProtectedRoute — 路由守衛元件
 *
 * 用法 1：僅檢查登入狀態（無 props）
 *   <Route element={<ProtectedRoute />}>
 *
 * 用法 2：同時檢查特定權限（單一）
 *   <Route element={<ProtectedRoute requiredPermission="manage_users" />}>
 *
 * 用法 3：任一權限符合即可（多選一）
 *   <Route element={<ProtectedRoute anyPermission={["manage_library", "manage_agent_permissions"]} />}>
 *
 * 當使用者已登入但缺少所需權限時，導回首頁。
 */
const ProtectedRoute = ({ requiredPermission, anyPermission }) => {
  const { isAuthenticated, loading, hasPermission } = useAuth();
  const location = useLocation();

  // 載入中，顯示全頁 Spin
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: '#f5f5f5',
        }}
      >
        <Spin size="large" tip="載入中..." />
      </div>
    );
  }

  // 未登入，跳轉到 /login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 已登入但缺少所需權限（單一）→ 導回首頁
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/" replace />;
  }

  // 已登入但缺少所需權限（多選一）→ 導回首頁
  if (anyPermission && Array.isArray(anyPermission)) {
    const hasAny = anyPermission.some((p) => hasPermission(p));
    if (!hasAny) {
      return <Navigate to="/" replace />;
    }
  }

  // 已登入且有權限，渲染子路由
  return <Outlet />;
};

export default ProtectedRoute;
