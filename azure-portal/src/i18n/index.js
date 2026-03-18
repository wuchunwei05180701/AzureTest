/**
 * i18n 國際化模組
 *
 * 國家 → 語言對應：
 *   TW → zh-TW (繁體中文)
 *   JP → en    (英文)
 *   SG → en    (英文)
 *   TH → en    (英文)
 *   VN → en    (英文)
 *   PH → en    (英文)
 *
 * 預設語言：zh-TW
 */

import zhTW from './locales/zh-TW';
import en from './locales/en';

/** 所有語言包 */
export const locales = {
  'zh-TW': zhTW,
  en,
};

/** 國家代碼 → 語言代碼 對應表 */
export const COUNTRY_LANGUAGE_MAP = {
  TW: 'zh-TW',
  JP: 'en',
  SG: 'en',
  TH: 'en',
  VN: 'en',
  PH: 'en',
};

/** 預設語言 */
export const DEFAULT_LANGUAGE = 'zh-TW';

/** 語言顯示名稱 */
export const LANGUAGE_LABELS = {
  'zh-TW': '繁體中文',
  en: 'English',
};

/**
 * 根據國家代碼取得對應的語言代碼
 * @param {string} countryCode - 國家代碼 (TW, JP, SG, TH, VN, PH)
 * @returns {string} 語言代碼
 */
export const getLanguageByCountry = (countryCode) => {
  return COUNTRY_LANGUAGE_MAP[countryCode] || DEFAULT_LANGUAGE;
};

/**
 * 取得翻譯文字（支援巢狀 key 和參數替換）
 *
 * @param {object} translations - 語言包物件
 * @param {string} key - 翻譯 key，例如 'home.announcementTitle'
 * @param {object} [params] - 參數替換，例如 { count: 3 }
 * @returns {string} 翻譯後的文字
 */
export const translate = (translations, key, params) => {
  const keys = key.split('.');
  let result = translations;

  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = result[k];
    } else {
      // 找不到翻譯時回傳 key 本身
      return key;
    }
  }

  if (typeof result !== 'string') {
    return key;
  }

  // 參數替換：{name} → params.name
  if (params) {
    return result.replace(/\{(\w+)\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : match;
    });
  }

  return result;
};
