import React, { useState, useEffect } from 'react';
import {
  Table,
  Tag,
  Switch,
  Button,
  Modal,
  Transfer,
  Checkbox,
  Divider,
  message,
  Space,
  Badge,
  Spin,
} from 'antd';
import {
  SafetyOutlined,
  UserAddOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { agentAPI, userAPI } from '../../services/api';
import { adaptAgents } from '../../utils/adapters';
import { agents as mockAgents } from '../../data/mockData';
import { useLanguage } from '../../contexts/LanguageContext';
import '../Settings.css';

// 所有可授權的角色（v2：與後端 permissions.py 的 Role enum 一致）
// 注意：label 僅作為 fallback，實際顯示由 i18n t('roles.xxx') 決定
const ALL_ROLES = [
  { value: 'root',  label: '最高管理者' },
  { value: 'admin', label: '管理者' },
  { value: 'user',  label: '一般使用者' },
];

const AgentPermissions = () => {
  const { t } = useLanguage();
  const [agentData, setAgentData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aclModal, setAclModal] = useState(null); // 當前編輯的 Agent
  const [selectedRoles, setSelectedRoles] = useState([]); // 已勾選的角色
  const [targetKeys, setTargetKeys] = useState([]); // 已選的使用者 email
  const [allUsers, setAllUsers] = useState([]); // 真實使用者列表
  const [saving, setSaving] = useState(false);
  // 追蹤正在切換上架狀態的 Agent ID（防止重複點擊）
  const [publishingIds, setPublishingIds] = useState(new Set());

  // 載入真實使用者列表
  const fetchUsers = async () => {
    try {
      const res = await userAPI.list();
      const users = Array.isArray(res.data) ? res.data : [];
      setAllUsers(users);
    } catch (err) {
      console.warn('使用者列表 API 失敗', err);
      setAllUsers([]);
    }
  };

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await agentAPI.listAll();
      const adapted = adaptAgents(res.data).map((a) => ({
        ...a,
        published: a.status === '可用',
        assignedUsers: a.acl?.authorizedUsers || [],
        assignedRoles: a.acl?.authorizedRoles || [],
      }));
      setAgentData(adapted);
    } catch (err) {
      console.warn('Agent API 失敗，使用 mock 資料', err);
      setAgentData(
        mockAgents.map((a) => ({
          ...a,
          published: true,
          assignedUsers: [],
          assignedRoles: [],
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAgents();
  }, []);

  const handlePublishToggle = async (agentId, checked) => {
    // 防止重複點擊：若該 Agent 正在處理中，直接忽略
    if (publishingIds.has(agentId)) return;

    // 樂觀更新 UI（立即反映切換結果，提升體驗）
    setAgentData((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, published: checked } : a))
    );
    setPublishingIds((prev) => new Set(prev).add(agentId));

    try {
      await agentAPI.updatePublish(agentId, checked);
      message.success(checked ? t('agentPermissions.agentOnline') : t('agentPermissions.agentOffline'));
      // 成功後重新拉取確保資料同步
      fetchAgents();
    } catch (err) {
      // 失敗時回滾樂觀更新
      setAgentData((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, published: !checked } : a))
      );
      message.error(t('agentPermissions.operationFailed') + '：' + (err.response?.data?.detail || err.message));
    } finally {
      // 無論成功或失敗，都解除鎖定
      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  };

  const openAclModal = (agent) => {
    setSelectedRoles(agent.assignedRoles || []);
    setTargetKeys(agent.assignedUsers || []);
    setAclModal(agent);
  };

  const handleAclSave = async () => {
    if (!aclModal) return;
    setSaving(true);
    try {
      const currentAcl = agentData.find(a => a.id === aclModal.id)?.acl || {};
      await agentAPI.updateACL(aclModal.id, {
        authorized_roles: selectedRoles,
        authorized_users: targetKeys,
        exception_list: currentAcl.exceptionList || [],
      });
      message.success(t('agentPermissions.permissionUpdated'));
      setAclModal(null);
      fetchAgents();
    } catch (err) {
      message.error(t('agentPermissions.updateFailed') + '：' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  // 快速操作：全選/取消全選角色
  const handleSelectAllRoles = (checked) => {
    if (checked) {
      setSelectedRoles(ALL_ROLES.map(r => r.value));
    } else {
      setSelectedRoles([]);
    }
  };

  // 計算授權摘要
  const getAclSummary = (record) => {
    const roleCount = record.assignedRoles?.length || 0;
    const userCount = record.assignedUsers?.length || 0;
    return { roleCount, userCount, total: roleCount + userCount };
  };

  const columns = [
    {
      title: 'Agent',
      key: 'agent',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: record.color + '20',
              color: record.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            {record.icon}
          </div>
          <div>
            <div style={{ fontWeight: 500 }}>{record.name}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{record.model}</div>
          </div>
        </div>
      ),
    },
    {
      title: t('agentPermissions.publishStatus'),
      key: 'published',
      width: 120,
      render: (_, record) => (
        <Switch
          checked={record.published}
          loading={publishingIds.has(record.id)}
          disabled={publishingIds.has(record.id)}
          onChange={(checked) => handlePublishToggle(record.id, checked)}
          checkedChildren={t('agentPermissions.online')}
          unCheckedChildren={t('agentPermissions.offline')}
        />
      ),
    },
    {
      title: t('agentPermissions.authorization'),
      key: 'acl',
      width: 220,
      render: (_, record) => {
        const { userCount } = getAclSummary(record);
        return (
          <Space size={4}>
            {userCount > 0 && (
              <Tag icon={<UserAddOutlined />} color="green">
                {userCount} {t('agentPermissions.users')}
              </Tag>
            )}
            {userCount === 0 && (
              <Tag color="default">{t('agentPermissions.noAuthorization')}</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          icon={<UserOutlined />}
          onClick={() => openAclModal(record)}
          style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
        >
          {t('agentPermissions.manageAccess')}
        </Button>
      ),
    },
  ];

  // Transfer 資料來源：使用真實使用者列表，key 為 email
  const transferData = allUsers.map((u) => ({
    key: u.email,
    title: `${u.name} (${u.email})`,
    description: u.department || '',
  }));

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <SafetyOutlined style={{ marginRight: 8 }} />
          {t('agentPermissions.title')}
        </h2>
      </div>

      <div className="settings-content">
        <Table
          columns={columns}
          dataSource={agentData}
          rowKey="id"
          pagination={false}
          loading={loading}
          locale={{ emptyText: t('agentPermissions.noAgents') }}
        />
      </div>

      <Modal
        title={
          <span>
            <SafetyOutlined style={{ marginRight: 8 }} />
            {t('agentPermissions.manageAccessTitle', { name: aclModal?.name })}
          </span>
        }
        open={!!aclModal}
        onCancel={() => setAclModal(null)}
        onOk={handleAclSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={700}
        confirmLoading={saving}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        {/* 角色授權區塊 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              <TeamOutlined style={{ marginRight: 6 }} />
              {t('agentPermissions.roleAuthorization')}
            </span>
            <Checkbox
              checked={selectedRoles.length === ALL_ROLES.length}
              indeterminate={selectedRoles.length > 0 && selectedRoles.length < ALL_ROLES.length}
              onChange={(e) => handleSelectAllRoles(e.target.checked)}
            >
              {t('agentPermissions.selectAllRoles')}
            </Checkbox>
          </div>
          <p style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
            {t('agentPermissions.roleAuthorizationDesc')}
          </p>
          <Checkbox.Group
            value={selectedRoles}
            onChange={setSelectedRoles}
            style={{ width: '100%' }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {ALL_ROLES.map((role) => (
                <Checkbox key={role.value} value={role.value}>
                  {role.label}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* 個別使用者授權區塊 */}
        <div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              <UserAddOutlined style={{ marginRight: 6 }} />
              {t('agentPermissions.userAuthorization')}
            </span>
          </div>
          <p style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
            {t('agentPermissions.userAuthorizationDesc', { count: targetKeys.length })}
          </p>
          <Transfer
            dataSource={transferData}
            targetKeys={targetKeys}
            onChange={setTargetKeys}
            render={(item) => item.title}
            titles={[t('agentPermissions.unauthorized'), t('agentPermissions.authorized')]}
            listStyle={{ width: 280, height: 260 }}
            showSearch
            searchPlaceholder={t('agentPermissions.searchUsers')}
          />
        </div>
      </Modal>
    </div>
  );
};

export default AgentPermissions;
