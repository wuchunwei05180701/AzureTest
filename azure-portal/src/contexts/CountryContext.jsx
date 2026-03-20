import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { countryAPI } from '../services/api';
import { useAuth } from './AuthContext';

const CountryContext = createContext(null);

export const CountryProvider = ({ children }) => {
  const { user } = useAuth();
  // root 角色可跨國查看（原 super_admin）
  const isSuperAdmin = user?.role === 'root';
  
  const [countries, setCountries] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(undefined);
  // selectedCountry:
  //   undefined = 尚未初始化
  //   'TW'/'SG'/... = 當前選擇的國家

  // 載入國家列表
  useEffect(() => {
    if (user) {
      countryAPI.list().then((res) => {
        setCountries(res.data || []);
      }).catch(() => {});
    }
  }, [user]);

  // 使用者登入時設定預設國家，登出時重置
  useEffect(() => {
    if (!user) {
      setSelectedCountry(undefined);
    } else if (isSuperAdmin && selectedCountry === undefined) {
      // root 預設選擇自己的國家
      setSelectedCountry(user.country || 'TW');
    }
  }, [user, isSuperAdmin]);

  // 取得當前有效的國家代碼（用於 API 呼叫）
  const effectiveCountry = isSuperAdmin ? selectedCountry : undefined;
  // 非 root: undefined 表示不傳 country 參數（後端會用使用者自己的國家）

  // 取得顯示用的國家代碼
  const displayCountry = selectedCountry || user?.country || 'TW';

  const handleCountryChange = useCallback((value) => {
    if (!isSuperAdmin) return;
    setSelectedCountry(value || undefined);
  }, [isSuperAdmin]);

  return (
    <CountryContext.Provider value={{
      countries,
      selectedCountry,
      effectiveCountry,
      displayCountry,
      isSuperAdmin,
      setSelectedCountry: handleCountryChange,
    }}>
      {children}
    </CountryContext.Provider>
  );
};

export const useCountry = () => {
  const context = useContext(CountryContext);
  if (!context) {
    throw new Error('useCountry must be used within a CountryProvider');
  }
  return context;
};
