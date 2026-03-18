import React from 'react';
import { MenuOutlined, UserOutlined, TeamOutlined, LogoutOutlined, GlobalOutlined } from '@ant-design/icons';
import { Avatar, Tag, Button, Tooltip, Select } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import { ROLE_COLORS } from '../data/mockData';
import './TopBar.css';

const TopBar = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { countries, selectedCountry, displayCountry, isSuperAdmin, setSelectedCountry } = useCountry();
  const { t } = useLanguage();

  const roleLabel = user ? (t(`roles.${user.role}`) || user.role) : '';
  const roleColor = user ? (ROLE_COLORS[user.role] || '#999') : '#999';

  // 取得顯示用的國家名稱（使用 i18n 翻譯）
  const countryName = t(`countries.${displayCountry}`) || countries.find((c) => c.code === displayCountry)?.name || displayCountry;

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        <MenuOutlined className="topbar-hamburger" onClick={onToggleSidebar} />
        <div className="topbar-logo">
          <span className="topbar-logo-icon">N</span>
          <span className="topbar-logo-text">Web Portal</span>
        </div>
        {user && (
          <div className="topbar-team">
            <TeamOutlined style={{ color: 'var(--primary-color)', marginRight: 6 }} />
            <span className="topbar-team-name">{user.department ? (t(`departments.${user.department}`) || user.department) : ''}</span>
          </div>
        )}
      </div>
      <div className="topbar-right">
        {user && (
          <>
            <div className="topbar-user-info">
              <span className="topbar-user-name">{user.name || user.email}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                {/* 國家顯示區域 */}
                {isSuperAdmin ? (
                  <Select
                    value={selectedCountry}
                    onChange={setSelectedCountry}
                    placeholder={t('topbar.selectCountry')}
                    size="small"
                    style={{ width: 130 }}
                    options={countries.map((c) => ({ value: c.code, label: `${t(`countries.${c.code}`) || c.name} (${c.code})` }))}
                    className="topbar-country-select"
                  />
                ) : (
                  <Tag color="blue" style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                    <GlobalOutlined style={{ marginRight: 4 }} />
                    {countryName}
                  </Tag>
                )}
                <Tag
                  color={roleColor}
                  style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}
                >
                  {roleLabel}
                </Tag>
              </div>
            </div>
            <Avatar size={36} icon={<UserOutlined />} className="topbar-avatar" />
            <Tooltip title={t('topbar.logout')}>
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                className="topbar-logout-btn"
                style={{ marginLeft: 8, color: '#666' }}
              />
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};

export default TopBar;
