import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  RobotOutlined,
  BookOutlined,
  SettingOutlined,
  MessageOutlined,
  HistoryOutlined,
  NotificationOutlined,
  SafetyOutlined,
  DatabaseOutlined,
  TeamOutlined,
  AuditOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import './Sidebar.css';

const Sidebar = ({ collapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const { t } = useLanguage();
  const [expandedMenus, setExpandedMenus] = useState({});

  const toggleMenu = (key) => {
    setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isActive = (path) => location.pathname === path;
  const isParentActive = (paths) => paths.some((p) => location.pathname.startsWith(p));
  const isExactActive = (path) => location.pathname === path;

  // 根據使用者權限動態產生設定子選單
  const settingsChildren = [];
  if (hasPermission('manage_announcements')) {
    settingsChildren.push({ key: 'announcement-settings', icon: <NotificationOutlined />, label: t('sidebar.announcementSettings'), path: '/settings/announcements' });
  }
  if (hasPermission('manage_agent_permissions')) {
    settingsChildren.push({ key: 'agent-permissions', icon: <SafetyOutlined />, label: t('sidebar.agentPermissions'), path: '/settings/agent-permissions' });
  }
  if (hasPermission('manage_library')) {
    settingsChildren.push({ key: 'library-settings', icon: <DatabaseOutlined />, label: t('sidebar.librarySettings'), path: '/settings/library' });
  }
  if (hasPermission('manage_users')) {
    settingsChildren.push({ key: 'user-management', icon: <TeamOutlined />, label: t('sidebar.userManagement'), path: '/settings/users' });
  }
  if (hasPermission('manage_users') || hasPermission('cross_country_logs')) {
    settingsChildren.push({ key: 'audit-logs', icon: <AuditOutlined />, label: t('sidebar.auditLogs'), path: '/settings/audit-logs' });
  }

  const menuItems = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: t('sidebar.home'),
      path: '/',
    },
    {
      key: 'agent-store',
      icon: <RobotOutlined />,
      label: t('sidebar.agentStore'),
      path: '/agent-store',
      children: [
        { key: 'chat', icon: <MessageOutlined />, label: t('sidebar.chat'), path: '/agent-store/chat' },
        { key: 'history', icon: <HistoryOutlined />, label: t('sidebar.chatHistory'), path: '/agent-store/history' },
      ],
    },
    {
      key: 'library',
      icon: <BookOutlined />,
      label: t('sidebar.library'),
      path: '/library',
    },
    // 只有在有任何設定權限時才顯示設定選單
    ...(settingsChildren.length > 0
      ? [
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: t('sidebar.settings'),
            children: settingsChildren,
          },
        ]
      : []),
  ];

  return (
    <div className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          if (item.children) {
            const allPaths = [...item.children.map((c) => c.path), ...(item.path ? [item.path] : [])];
            const isExpanded = expandedMenus[item.key] || isParentActive(item.children.map((c) => c.path));
            const parentActive = isParentActive(allPaths);
            return (
              <div key={item.key} className="sidebar-menu-group">
                <div
                  className={`sidebar-item sidebar-parent ${parentActive ? 'active-parent' : ''}`}
                  onClick={() => {
                    if (item.path) {
                      navigate(item.path);
                      if (!isExpanded) toggleMenu(item.key);
                    } else {
                      toggleMenu(item.key);
                    }
                  }}
                >
                  <span className="sidebar-item-icon">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="sidebar-item-label">{item.label}</span>
                      <span
                        className="sidebar-expand-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMenu(item.key);
                        }}
                      >
                        {isExpanded ? <DownOutlined /> : <RightOutlined />}
                      </span>
                    </>
                  )}
                </div>
                {isExpanded && !collapsed && (
                  <div className="sidebar-children">
                    {item.children.map((child) => (
                      <div
                        key={child.key}
                        className={`sidebar-item sidebar-child ${isActive(child.path) ? 'active' : ''}`}
                        onClick={() => navigate(child.path)}
                      >
                        <span className="sidebar-item-icon">{child.icon}</span>
                        <span className="sidebar-item-label">{child.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={item.key}
              className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className="sidebar-item-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
            </div>
          );
        })}
      </nav>
    </div>
  );
};

export default Sidebar;
