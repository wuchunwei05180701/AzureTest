import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authAPI, getToken, setToken, removeToken, BASE_PREFIX } from '../services/api';

const AuthContext = createContext(null);

// 定期刷新使用者資訊的間隔（毫秒）— 每 60 秒
const REFRESH_INTERVAL = 60 * 1000;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef(null);

  // 從後端 /api/auth/me 取得最新使用者資訊
  const fetchUser = useCallback(async () => {
    const token = getToken();
    if (!token) return null;

    try {
      const response = await authAPI.getMe();
      setUser(response.data);
      return response.data;
    } catch (error) {
      console.error('取得使用者資訊失敗:', error);
      if (error.response?.status === 401) {
        removeToken();
        setUser(null);
      }
      return null;
    }
  }, []);

  // 手動刷新使用者資訊（供其他元件呼叫）
  const refreshUser = useCallback(async () => {
    return await fetchUser();
  }, [fetchUser]);

  // 啟動時自動檢查 localStorage 中的 token
  useEffect(() => {
    const initAuth = async () => {
      const token = getToken();
      if (token) {
        await fetchUser();
      }
      setLoading(false);
    };

    initAuth();
  }, [fetchUser]);

  // 定期刷新使用者資訊（偵測角色變更等）
  useEffect(() => {
    if (!user) {
      // 未登入時清除定時器
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    // 已登入時啟動定期刷新
    refreshTimerRef.current = setInterval(() => {
      fetchUser();
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [user, fetchUser]);

  // 監聽頁面可見性變化 — 切回頁面時立即刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && getToken()) {
        fetchUser();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchUser]);

  // 登入：儲存 token 並設定使用者
  const login = useCallback((token, userData) => {
    setToken(token);
    setUser(userData);
  }, []);

  // 登出：清除 token 和使用者狀態
  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      // 即使 API 呼叫失敗也要清除本地狀態
      console.error('登出 API 呼叫失敗:', error);
    } finally {
      removeToken();
      setUser(null);
    }
  }, []);

  // 檢查使用者是否有特定權限
  const hasPermission = useCallback(
    (permission) => {
      if (!user || !user.permissions) return false;
      return user.permissions.includes(permission);
    },
    [user]
  );

  // 更新個人資料（姓名）
  const updateProfile = useCallback(async (data) => {
    await authAPI.updateProfile(data);
    // 更新本地 user 狀態
    setUser((prev) => prev ? { ...prev, ...data } : prev);
  }, []);

  // 上傳頭貼
  const uploadAvatar = useCallback(async (formData) => {
    const response = await authAPI.uploadAvatar(formData);
    // 重新取得最新使用者資訊（含新的 avatar_url）
    await fetchUser();
    return response;
  }, [fetchUser]);

  // 刪除頭貼
  const deleteAvatar = useCallback(async () => {
    await authAPI.deleteAvatar();
    setUser((prev) => prev ? { ...prev, avatar_url: null } : prev);
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    hasPermission,
    refreshUser,
    updateProfile,
    uploadAvatar,
    deleteAvatar,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
