import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  MenuOutlined,
  UserOutlined,
  TeamOutlined,
  LogoutOutlined,
  GlobalOutlined,
  EditOutlined,
  CameraOutlined,
  DeleteOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Tag,
  Button,
  Select,
  Dropdown,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Divider,
  Space,
} from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import { ROLE_COLORS } from '../data/mockData';
import { BASE_PREFIX, getToken } from '../services/api';
import './TopBar.css';

/**
 * 透過 fetch（帶 Authorization header）取得頭貼 blob URL
 */
const fetchAvatarBlobUrl = async () => {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BASE_PREFIX}/api/auth/avatar`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

const TopBar = ({ onToggleSidebar }) => {
  const { user, logout, updateProfile, uploadAvatar, deleteAvatar } = useAuth();
  const { countries, selectedCountry, displayCountry, isSuperAdmin, setSelectedCountry } = useCountry();
  const { t, language, setLanguage } = useLanguage();

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [avatarBlobUrl, setAvatarBlobUrl] = useState(null);   // 從後端取得的 blob URL
  const [avatarPreview, setAvatarPreview] = useState(null);   // Modal 內本地預覽
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null); // 待上傳的檔案 | 'DELETE'
  const [form] = Form.useForm();
  const fileInputRef = useRef(null);

  const roleLabel = user ? (t(`roles.${user.role}`) || user.role) : '';
  const roleColor = user ? (ROLE_COLORS[user.role] || '#999') : '#999';

  // 取得顯示用的國家名稱
  const countryName =
    t(`countries.${displayCountry}`) ||
    countries.find((c) => c.code === displayCountry)?.name ||
    displayCountry;

  // 當 user.avatar_url 變更時，重新取得 blob URL
  useEffect(() => {
    let objectUrl = null;
    if (user?.avatar_url) {
      fetchAvatarBlobUrl().then((url) => {
        objectUrl = url;
        setAvatarBlobUrl(url);
      });
    } else {
      setAvatarBlobUrl(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user?.avatar_url]);

  const handleLogout = async () => {
    await logout();
  };

  // 開啟編輯個人資料 Modal
  const handleOpenProfile = () => {
    form.setFieldsValue({ name: user?.name || '' });
    setAvatarPreview(null);
    setPendingAvatarFile(null);
    setProfileModalOpen(true);
  };

  // 關閉 Modal
  const handleCloseProfile = () => {
    setProfileModalOpen(false);
    setAvatarPreview(null);
    setPendingAvatarFile(null);
    form.resetFields();
  };

  // 選擇頭貼檔案
  const handleAvatarFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 驗證類型
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      message.error(t('topbar.avatarTypeError'));
      return;
    }

    // 驗證大小（5MB）
    if (file.size > 5 * 1024 * 1024) {
      message.error(t('topbar.avatarSizeError'));
      return;
    }

    // 建立本地預覽
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);
    setPendingAvatarFile(file);

    // 清除 input value，讓同一張圖可以重複選
    e.target.value = '';
  };

  // Modal 內「刪除頭貼」按鈕
  const handleDeleteAvatarInModal = () => {
    setAvatarPreview(null);
    setPendingAvatarFile('DELETE');
  };

  // 儲存個人資料
  const handleSaveProfile = async () => {
    try {
      const values = await form.validateFields();
      setProfileLoading(true);

      // 1. 更新姓名（若有變更）
      if (values.name !== user?.name) {
        await updateProfile({ name: values.name });
      }

      // 2. 處理頭貼
      if (pendingAvatarFile === 'DELETE') {
        try {
          await deleteAvatar();
          setAvatarBlobUrl(null);
          message.success(t('topbar.avatarDeleted'));
        } catch {
          message.error(t('topbar.avatarDeleteFailed'));
        }
      } else if (pendingAvatarFile && pendingAvatarFile !== 'DELETE') {
        const formData = new FormData();
        formData.append('file', pendingAvatarFile);
        try {
          await uploadAvatar(formData);
          // 重新取得頭貼 blob URL
          const newUrl = await fetchAvatarBlobUrl();
          setAvatarBlobUrl(newUrl);
          message.success(t('topbar.avatarUploaded'));
        } catch {
          message.error(t('topbar.avatarUploadFailed'));
        }
      }

      message.success(t('topbar.profileSaved'));
      handleCloseProfile();
    } catch (err) {
      if (err?.errorFields) return; // 表單驗證錯誤
      console.error('更新個人資料失敗:', err);
      message.error(t('topbar.profileSaveFailed'));
    } finally {
      setProfileLoading(false);
    }
  };

  // 語言切換
  const handleLanguageChange = (lang) => {
    setLanguage(lang);
  };

  // 下拉選單項目
  const dropdownItems = [
    {
      key: 'edit-profile',
      icon: <EditOutlined />,
      label: t('topbar.editProfile'),
      onClick: handleOpenProfile,
    },
    {
      key: 'language',
      icon: <GlobalOutlined />,
      label: t('topbar.switchLanguage'),
      children: [
        {
          key: 'lang-zh-TW',
          label: (
            <Space size={6}>
              {language === 'zh-TW'
                ? <CheckOutlined style={{ color: 'var(--primary-color)', fontSize: 12 }} />
                : <span style={{ display: 'inline-block', width: 12 }} />
              }
              {t('topbar.languageZhTW')}
            </Space>
          ),
          onClick: () => handleLanguageChange('zh-TW'),
        },
        {
          key: 'lang-en',
          label: (
            <Space size={6}>
              {language === 'en'
                ? <CheckOutlined style={{ color: 'var(--primary-color)', fontSize: 12 }} />
                : <span style={{ display: 'inline-block', width: 12 }} />
              }
              {t('topbar.languageEn')}
            </Space>
          ),
          onClick: () => handleLanguageChange('en'),
        },
      ],
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('topbar.logout'),
      danger: true,
      onClick: handleLogout,
    },
  ];

  // Modal 內頭貼顯示邏輯
  const modalAvatarSrc = (() => {
    if (pendingAvatarFile === 'DELETE') return null;
    if (avatarPreview) return avatarPreview;
    return avatarBlobUrl || null;
  })();

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
            <span className="topbar-team-name">
              {user.department ? (t(`departments.${user.department}`) || user.department) : ''}
            </span>
          </div>
        )}
      </div>

      <div className="topbar-right">
        {user && (
          <>
            {/* 國家選擇（Super Admin） */}
            {isSuperAdmin ? (
              <Select
                value={selectedCountry}
                onChange={setSelectedCountry}
                placeholder={t('topbar.selectCountry')}
                size="small"
                style={{ width: 130 }}
                options={countries.map((c) => ({
                  value: c.code,
                  label: `${t(`countries.${c.code}`) || c.name} (${c.code})`,
                }))}
                className="topbar-country-select"
              />
            ) : (
              <Tag color="blue" style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                <GlobalOutlined style={{ marginRight: 4 }} />
                {countryName}
              </Tag>
            )}

            {/* 使用者資訊 + 頭貼（可點擊下拉） */}
            <Dropdown
              menu={{ items: dropdownItems }}
              trigger={['click']}
              placement="bottomRight"
              overlayClassName="topbar-user-dropdown"
            >
              <div className="topbar-user-clickable">
                <div className="topbar-user-info">
                  <span className="topbar-user-name">{user.name || user.email}</span>
                  <Tag
                    color={roleColor}
                    style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}
                  >
                    {roleLabel}
                  </Tag>
                </div>
                <Avatar
                  size={36}
                  src={avatarBlobUrl || undefined}
                  icon={!avatarBlobUrl ? <UserOutlined /> : undefined}
                  className="topbar-avatar"
                />
              </div>
            </Dropdown>
          </>
        )}
      </div>

      {/* 編輯個人資料 Modal */}
      <Modal
        title={t('topbar.profileModalTitle')}
        open={profileModalOpen}
        onCancel={handleCloseProfile}
        onOk={handleSaveProfile}
        confirmLoading={profileLoading}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={420}
        destroyOnClose
      >
        <div className="profile-modal-content">
          {/* 頭貼區域 */}
          <div className="profile-avatar-section">
            <Avatar
              size={80}
              src={modalAvatarSrc || undefined}
              icon={!modalAvatarSrc ? <UserOutlined /> : undefined}
              className="profile-avatar-preview"
            />
            <div className="profile-avatar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarFileChange}
              />
              <Button
                size="small"
                icon={<CameraOutlined />}
                onClick={() => fileInputRef.current?.click()}
              >
                {modalAvatarSrc ? t('topbar.changeAvatar') : t('topbar.uploadAvatar')}
              </Button>
              {modalAvatarSrc && (
                <Popconfirm
                  title={t('topbar.deleteAvatarConfirm')}
                  onConfirm={handleDeleteAvatarInModal}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    {t('topbar.deleteAvatar')}
                  </Button>
                </Popconfirm>
              )}
              <div className="profile-avatar-hint">{t('topbar.avatarHint')}</div>
            </div>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          {/* 表單 */}
          <Form form={form} layout="vertical">
            <Form.Item
              label={t('topbar.nameLabel')}
              name="name"
              rules={[{ required: true, message: t('topbar.nameRequired') }]}
            >
              <Input placeholder={t('topbar.namePlaceholder')} maxLength={100} />
            </Form.Item>
            <Form.Item label={t('topbar.emailLabel')}>
              <Input value={user?.email} disabled />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
};

export default TopBar;
