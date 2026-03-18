import React, { useMemo } from 'react';
import { ConfigProvider } from 'antd';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import { useLanguage } from '../contexts/LanguageContext';

/** 語言代碼 → antd locale 對應 */
const ANTD_LOCALE_MAP = {
  'zh-TW': zhTW,
  en: enUS,
};

/**
 * AntdLocaleWrapper
 *
 * 根據當前語言動態切換 antd 的 locale，
 * 讓 antd 內建元件（Table、Pagination、DatePicker 等）也跟著切換語言。
 */
const AntdLocaleWrapper = ({ children }) => {
  const { language } = useLanguage();

  const antdLocale = useMemo(() => {
    return ANTD_LOCALE_MAP[language] || zhTW;
  }, [language]);

  return (
    <ConfigProvider locale={antdLocale}>
      {children}
    </ConfigProvider>
  );
};

export default AntdLocaleWrapper;
