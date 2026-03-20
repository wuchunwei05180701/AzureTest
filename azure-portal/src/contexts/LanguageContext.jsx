import React, { createContext, useContext, useMemo, useCallback, useState, useEffect } from 'react';
import { locales, DEFAULT_LANGUAGE, translate } from '../i18n';

const LanguageContext = createContext(null);

const LANGUAGE_STORAGE_KEY = 'ctbc_language';

/**
 * LanguageProvider
 *
 * 支援手動切換語言（繁體中文 / English）。
 * 使用者選擇的語言會儲存在 localStorage 中，下次開啟時自動套用。
 */
export const LanguageProvider = ({ children }) => {
  // 從 localStorage 讀取使用者偏好語言，預設繁體中文
  const [language, setLanguageState] = useState(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && locales[saved]) return saved;
    return 'zh-TW';
  });

  // 切換語言並儲存到 localStorage
  const setLanguage = useCallback((lang) => {
    if (locales[lang]) {
      setLanguageState(lang);
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
  }, []);

  // 取得當前語言包
  const translations = useMemo(() => {
    return locales[language] || locales[DEFAULT_LANGUAGE];
  }, [language]);

  // t() 翻譯函數
  const t = useCallback(
    (key, params) => {
      return translate(translations, key, params);
    },
    [translations]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      translations,
      t,
    }),
    [language, setLanguage, translations, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

/**
 * useLanguage hook
 * @returns {{ language: string, setLanguage: (lang: string) => void, translations: object, t: (key: string, params?: object) => string }}
 */
export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
