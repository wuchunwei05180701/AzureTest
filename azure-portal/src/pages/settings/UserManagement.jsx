import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Popconfirm,
  message,
  Space,
  Badge,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  UserSwitchOutlined,
  StopOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  SearchOutlined,
  LockOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { userAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { adaptUsers, toUserCreate } from '../../utils/adapters';
import {
  userList as mockUserList,
  ROLES,
  ROLE_COLORS,
  countries as mockCountries,
  canOperateUser,
  getAssignableRoles as getAssignableRolesFallback,
} from '../../data/mockData';
import '../Settings.css';

const UserManagement = () => {
  const { user: currentUser } = useAuth();
  const { countries: countryList } = useCountry();
  const { t } = useLanguage();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [filterRole, setFilterRole] = useState(null);
  const [filterCountry, setFilterCountry] = useState(null);
  const [assignableRoles, setAssignableRoles] = useState([]);
  const [form] = Form.useForm();

  // 使用 CountryContext 的國家列表，若為空則 fallback 到 mockCountries
  const countries = countryList.length > 0 ? countryList : mockCountries;

  // 當前使用者的角色和 email
  const myRole = currentUser?.role || 'user';
  const myEmail = currentUser?.email || '';
  const myCountry = currentUser?.country || 'TW';
  const isSuperAdmin = myRole === 'super_admin';

  // ===== 載入可指派角色列表 =====
  const fetchAssignableRoles = useCallback(async () => {
    try {
      const res = await userAPI.getAssignableRoles();
      setAssignableRoles(
        res.data.map((r) => ({
          value: r.value,
          label: r.label,
        }))
      );
    } catch (err) {
      console.warn('取得可指派角色失敗，使用前端 fallback', err);
      setAssignableRoles(getAssignableRolesFallback(myRole));
    }
  }, [myRole]);

  // 動態翻譯角色 label（語言切換時自動更新，不需重新呼叫 API）
  const translatedAssignableRoles = assignableRoles.map((r) => ({
    value: r.value,
    label: t(`roles.${r.value}`) || r.label,
  }));

  // ===== 資料載入 =====
  const fetchUsers = useCallback(async (filters = {}) => {
    setLoading(true);
    try {
      const res = await userAPI.list(filters);
      setUsers(adaptUsers(res.data));
    } catch (err) {
      console.warn('使用者 API 失敗，使用 mock 資料', err);
      setUsers(mockUserList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchAssignableRoles();
  }, [fetchUsers, fetchAssignableRoles]);

  // ===== 搜尋/篩選 =====
  const handleSearch = (value) => {
    setSearchText(value);
    fetchUsers({
      search: value || undefined,
      role: filterRole || undefined,
      country: filterCountry || undefined,
    });
  };

  const handleFilterRole = (role) => {
    setFilterRole(role);
    fetchUsers({
      search: searchText || undefined,
      role: role || undefined,
      country: filterCountry || undefined,
    });
  };

  const handleFilterCountry = (country) => {
    setFilterCountry(country);
    fetchUsers({
      search: searchText || undefined,
      role: filterRole || undefined,
      country: country || undefined,
    });
  };

  // ===== 檢查是否可操作目標使用者 =====
  const canOperate = (record) => {
    return canOperateUser(myRole, myEmail, record.role, record.email);
  };

  // ===== 新增使用者 =====
  const handleAdd = () => {
    setEditingUser(null);
    form.resetFields();
    // 預設角色為可指派角色中等級最低的
    const defaultRole = assignableRoles.length > 0
      ? assignableRoles[assignableRoles.length - 1].value
      : ROLES.USER;
    // 非 super_admin 預設國家為自己的國家
    form.setFieldsValue({
      role: defaultRole,
      status: 'active',
      country: isSuperAdmin ? undefined : myCountry,
    });
    setModalOpen(true);
  };

  // ===== 編輯使用者 =====
  const handleEdit = (record) => {
    if (!canOperate(record)) {
      message.warning(t('userManagement.cannotEditUser'));
      return;
    }
    setEditingUser(record);
    form.setFieldsValue({
      name: record.name,
      email: record.email,
      department: record.department,
      role: record.role,
      country: record.country,
    });
    setModalOpen(true);
  };

  // ===== 儲存（新增 / 更新）=====
  const handleSave = () => {
    form.validateFields().then(async (values) => {
      if (editingUser) {
        // 編輯模式 → 呼叫 update API
        try {
          await userAPI.update(editingUser.email, {
            name: values.name,
            department: values.department,
            role: values.role,
          });
          message.success(t('userManagement.userUpdated'));
          fetchUsers({
            search: searchText || undefined,
            role: filterRole || undefined,
            country: filterCountry || undefined,
          });
        } catch (err) {
          message.error(t('userManagement.updateFailed') + '：' + (err.response?.data?.detail || err.message));
        }
      } else {
        // 新增模式 → 呼叫 create API
        try {
          await userAPI.create(toUserCreate(values));
          message.success(t('userManagement.userCreated'));
          fetchUsers({
            search: searchText || undefined,
            role: filterRole || undefined,
            country: filterCountry || undefined,
          });
        } catch (err) {
          if (err.response?.status === 409) {
            message.error(t('userManagement.emailExists'));
          } else {
            message.error(t('userManagement.createFailed') + '：' + (err.response?.data?.detail || err.message));
          }
        }
      }
      setModalOpen(false);
      form.resetFields();
    });
  };

  // ===== 停用/啟用 =====
  const handleToggleStatus = async (email, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await userAPI.updateStatus(email, newStatus);
      message.success(newStatus === 'active' ? t('userManagement.accountEnabled') : t('userManagement.accountDisabled'));
      fetchUsers({
        search: searchText || undefined,
        role: filterRole || undefined,
        country: filterCountry || undefined,
      });
    } catch (err) {
      message.error(t('userManagement.operationFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 刪除使用者 =====
  const handleDeleteUser = async (email) => {
    try {
      await userAPI.delete(email);
      message.success(t('userManagement.userDeleted'));
      fetchUsers({
        search: searchText || undefined,
        role: filterRole || undefined,
        country: filterCountry || undefined,
      });
    } catch (err) {
      message.error(t('userManagement.deleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 角色變更 =====
  const handleRoleChange = async (email, newRole) => {
    try {
      await userAPI.updateRole(email, newRole);
      message.success(t('userManagement.roleUpdated'));
      fetchUsers({
        search: searchText || undefined,
        role: filterRole || undefined,
        country: filterCountry || undefined,
      });
    } catch (err) {
      message.error(t('userManagement.roleUpdateFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 前端篩選（作為 API 篩選的補充）=====
  const filteredUsers = users.filter((u) => {
    const deptLabel = t(`departments.${u.department}`) || u.department;
    const matchSearch =
      !searchText ||
      u.name.toLowerCase().includes(searchText.toLowerCase()) ||
      u.email.toLowerCase().includes(searchText.toLowerCase()) ||
      deptLabel.toLowerCase().includes(searchText.toLowerCase());
    const matchRole = !filterRole || u.role === filterRole;
    const matchCountry = !filterCountry || u.country === filterCountry;
    return matchSearch && matchRole && matchCountry;
  });

  // 所有角色選項（用於篩選下拉選單，顯示全部角色）
  const allRoleOptions = Object.keys(ROLES).map((key) => ({
    value: ROLES[key],
    label: t(`roles.${ROLES[key]}`),
  }));

  const countryOptions = countries.map((c) => ({
    value: c.code,
    label: t(`countries.${c.code}`) || c.name,
  }));

  const columns = [
    {
      title: t('userManagement.user'),
      key: 'user',
      render: (_, record) => {
        const isSelf = myEmail && record.email.toLowerCase() === myEmail.toLowerCase();
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: ROLE_COLORS[record.role] + '30',
                color: ROLE_COLORS[record.role],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              {record.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 500 }}>
                {record.name}
                {isSelf && (
                  <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>
                    {t('common.self')}
                  </Tag>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#999' }}>{record.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      title: t('userManagement.department'),
      dataIndex: 'department',
      key: 'department',
      width: 120,
      render: (dept) => t(`departments.${dept}`) || dept,
    },
    {
      title: t('userManagement.country'),
      dataIndex: 'country',
      key: 'country',
      width: 100,
      render: (code) => {
        return t(`countries.${code}`) || code;
      },
    },
    {
      title: t('userManagement.role'),
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role, record) => {
        const operable = canOperate(record);
        if (!operable) {
          // 不可操作的使用者：顯示唯讀 Tag
          return (
            <Tooltip title={t('userManagement.cannotChangeRole')}>
              <Tag
                color={ROLE_COLORS[role]}
                icon={<LockOutlined />}
                style={{ cursor: 'not-allowed' }}
              >
                {t(`roles.${role}`) || role}
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Select
            value={role}
            size="small"
            style={{ width: 140 }}
            onChange={(val) => handleRoleChange(record.email, val)}
            options={translatedAssignableRoles}
            popupMatchSelectWidth={false}
          />
        );
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) =>
        status === 'active' ? (
          <Badge status="success" text={<Tag color="green">{t('common.active')}</Tag>} />
        ) : (
          <Badge status="error" text={<Tag color="red">{t('common.inactive')}</Tag>} />
        ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 280,
      render: (_, record) => {
        const operable = canOperate(record);
        return (
          <Space>
            <Tooltip title={!operable ? t('common.insufficientPermission') : ''}>
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
                style={{ color: operable ? 'var(--primary-color)' : '#ccc' }}
                disabled={!operable}
              >
                {t('common.edit')}
              </Button>
            </Tooltip>
            {operable ? (
              <Popconfirm
                title={
                  record.status === 'active'
                    ? t('userManagement.confirmDisable')
                    : t('userManagement.confirmEnable')
                }
                onConfirm={() => handleToggleStatus(record.email, record.status)}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
              >
                {record.status === 'active' ? (
                  <Button type="text" danger icon={<StopOutlined />}>
                    {t('userManagement.disableAccount')}
                  </Button>
                ) : (
                  <Button
                    type="text"
                    icon={<CheckCircleOutlined />}
                    style={{ color: 'var(--primary-color)' }}
                  >
                    {t('userManagement.enableAccount')}
                  </Button>
                )}
              </Popconfirm>
            ) : (
              <Tooltip title={t('common.insufficientPermission')}>
                <Button
                  type="text"
                  icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
                  disabled
                  style={{ color: '#ccc' }}
                >
                  {record.status === 'active' ? t('userManagement.disableAccount') : t('userManagement.enableAccount')}
                </Button>
              </Tooltip>
            )}
            {operable ? (
              <Popconfirm
                title={t('userManagement.confirmDelete')}
                onConfirm={() => handleDeleteUser(record.email)}
                okText={t('userManagement.confirmDeleteBtn')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}
              >
                <Button type="text" danger icon={<DeleteOutlined />}>
                  {t('common.delete')}
                </Button>
              </Popconfirm>
            ) : (
              <Tooltip title={t('common.insufficientPermission')}>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  disabled
                  style={{ color: '#ccc' }}
                >
                  {t('common.delete')}
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <TeamOutlined style={{ marginRight: 8 }} />
          {t('userManagement.title')}
        </h2>
        <div className="settings-actions">
          <Input
            placeholder={t('userManagement.searchPlaceholder')}
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ width: 180 }}
            allowClear
          />
          <Select
            placeholder={t('userManagement.filterRole')}
            style={{ width: 150 }}
            value={filterRole}
            onChange={handleFilterRole}
            allowClear
            options={allRoleOptions}
          />
          {/* 只有 super_admin 可以篩選國家 */}
          {isSuperAdmin && (
            <Select
              placeholder={t('userManagement.filterCountry')}
              style={{ width: 120 }}
              value={filterCountry}
              onChange={handleFilterCountry}
              allowClear
              options={countryOptions}
            />
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            style={{
              background: 'var(--primary-color)',
              borderColor: 'var(--primary-color)',
            }}
          >
            {t('userManagement.addUser')}
          </Button>
        </div>
      </div>

      <div className="settings-content">
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.keys(ROLES).map((key) => {
            const role = ROLES[key];
            const label = t(`roles.${role}`);
            const count = users.filter((u) => u.role === role).length;
            return (
              <Tag
                key={role}
                color={ROLE_COLORS[role]}
                style={{ cursor: 'pointer', fontSize: 12 }}
                onClick={() => handleFilterRole(filterRole === role ? null : role)}
              >
                {label}: {count} {t('common.person')}
              </Tag>
            );
          })}
          <Tag style={{ fontSize: 12 }}>
            {t('userManagement.totalCount', { total: users.length, active: users.filter((u) => u.status === 'active').length })}
          </Tag>
        </div>

        <Table
          columns={columns}
          dataSource={filteredUsers}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: t('userManagement.noUsers') }}
          loading={loading}
        />
      </div>

      {/* 新增/編輯使用者 Modal */}
      <Modal
        title={
          <span>
            <UserSwitchOutlined style={{ marginRight: 8 }} />
            {editingUser ? t('userManagement.editUser') : t('userManagement.addUser')}
          </span>
        }
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{
          style: {
            background: 'var(--primary-color)',
            borderColor: 'var(--primary-color)',
          },
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('userManagement.nameLabel')}
            rules={[{ required: true, message: t('userManagement.nameRequired') }]}
          >
            <Input placeholder={t('userManagement.namePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="email"
            label={t('userManagement.emailLabel')}
            rules={[
              { required: true, message: t('userManagement.emailRequired') },
              { type: 'email', message: t('userManagement.emailInvalid') },
            ]}
          >
            <Input placeholder={t('userManagement.emailPlaceholder')} disabled={!!editingUser} />
          </Form.Item>
          <Form.Item
            name="department"
            label={t('userManagement.departmentLabel')}
            rules={[{ required: true, message: t('userManagement.departmentRequired') }]}
          >
            <Input placeholder={t('userManagement.departmentPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="country"
            label={t('userManagement.countryLabel')}
            rules={[{ required: true, message: t('userManagement.countryRequired') }]}
            extra={!isSuperAdmin ? t('userManagement.countryHint') : ''}
          >
            <Select
              placeholder={t('userManagement.countryPlaceholder')}
              options={countryOptions}
              disabled={!!editingUser || !isSuperAdmin}
            />
          </Form.Item>
          <Form.Item
            name="role"
            label={t('userManagement.roleLabel')}
            rules={[{ required: true, message: t('userManagement.roleRequired') }]}
            extra={
              translatedAssignableRoles.length === 0
                ? t('userManagement.noAssignableRolesWarning')
                : t('userManagement.assignableRolesHint', { roles: translatedAssignableRoles.map((r) => r.label).join('、') })
            }
          >
            <Select
              placeholder={t('userManagement.rolePlaceholder')}
              options={translatedAssignableRoles}
              notFoundContent={t('userManagement.noAssignableRoles')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UserManagement;
