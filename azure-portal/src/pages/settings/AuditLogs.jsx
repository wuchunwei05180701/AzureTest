import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Input,
  Select,
  DatePicker,
  Tag,
  Modal,
  Descriptions,
  Space,
  Tooltip,
  Badge,
  Typography,
  Divider,
  message,
} from 'antd';
import {
  SearchOutlined,
  DownloadOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { auditAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import '../Settings.css';
import './AuditLogs.css';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;

// 操作類型對應的 Tag 顏色
const ACTION_COLORS = {
  auth:         'blue',
  user:         'purple',
  agent:        'cyan',
  library:      'green',
  announcement: 'orange',
  chat:         'geekblue',
  pii:          'red',
};

const getActionColor = (action) => {
  const category = action?.split('.')[0];
  return ACTION_COLORS[category] || 'default';
};

const AuditLogs = () => {
  const { user: currentUser, hasPermission } = useAuth();
  const { countries: countryList } = useCountry();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const isRoot = currentUser?.role === 'root';

  // 操作類型中文標籤（動態使用 t()）
  const ACTION_LABELS = {
    'auth.otp_request':     t('auditLogs.actionOtpRequest'),
    'auth.login_success':   t('auditLogs.actionLoginSuccess'),
    'auth.login_failed':    t('auditLogs.actionLoginFailed'),
    'auth.account_locked':  t('auditLogs.actionAccountLocked'),
    'auth.logout':          t('auditLogs.actionLogout'),
    'user.create':          t('auditLogs.actionUserCreate'),
    'user.update':          t('auditLogs.actionUserUpdate'),
    'user.role_change':     t('auditLogs.actionUserRoleChange'),
    'user.status_change':   t('auditLogs.actionUserStatusChange'),
    'user.delete':          t('auditLogs.actionUserDelete'),
    'agent.publish':        t('auditLogs.actionAgentPublish'),
    'agent.unpublish':      t('auditLogs.actionAgentUnpublish'),
    'agent.acl_update':     t('auditLogs.actionAgentAclUpdate'),
    'library.upload':       t('auditLogs.actionLibraryUpload'),
    'library.download':     t('auditLogs.actionLibraryDownload'),
    'library.delete':       t('auditLogs.actionLibraryDelete'),
    'library.update':       t('auditLogs.actionLibraryUpdate'),
    'library.auth_update':  t('auditLogs.actionLibraryAuthUpdate'),
    'library.view':         t('auditLogs.actionLibraryView'),
    'library.preview':      t('auditLogs.actionLibraryPreview'),
    'announcement.create':  t('auditLogs.actionAnnouncementCreate'),
    'announcement.update':  t('auditLogs.actionAnnouncementUpdate'),
    'announcement.delete':  t('auditLogs.actionAnnouncementDelete'),
    'chat.send':            t('auditLogs.actionChatSend'),
    'chat.session_delete':  t('auditLogs.actionChatSessionDelete'),
    'pii.detected_chat':    t('auditLogs.actionPiiDetectedChat'),
    'pii.blocked_upload':   t('auditLogs.actionPiiBlockedUpload'),
    'pii.blocked_chat':     t('auditLogs.actionPiiBlockedChat'),
  };

  // 操作類別（用於篩選下拉）
  const ACTION_CATEGORIES = [
    { value: 'auth',         label: t('auditLogs.categoryAuth') },
    { value: 'user',         label: t('auditLogs.categoryUser') },
    { value: 'agent',        label: t('auditLogs.categoryAgent') },
    { value: 'library',      label: t('auditLogs.categoryLibrary') },
    { value: 'announcement', label: t('auditLogs.categoryAnnouncement') },
    { value: 'chat',         label: t('auditLogs.categoryChat') },
    { value: 'pii',          label: t('auditLogs.categoryPii') },
  ];

  // 資料狀態
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 分頁
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // 篩選條件
  const [filterEmail, setFilterEmail] = useState('');
  const [filterActionCategory, setFilterActionCategory] = useState(null);
  const [filterAction, setFilterAction] = useState(null);
  const [filterCountry, setFilterCountry] = useState(null);
  const [filterResult, setFilterResult] = useState(null);
  const [filterTarget, setFilterTarget] = useState('');
  const [filterDateRange, setFilterDateRange] = useState(null);

  // 詳情 Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  // 取得日誌列表
  const fetchLogs = useCallback(async (currentPage = page, currentPageSize = pageSize) => {
    setLoading(true);
    try {
      const params = {
        page: currentPage,
        page_size: currentPageSize,
      };
      if (filterEmail.trim()) params.user_email = filterEmail.trim();
      if (filterAction) params.action = filterAction;
      else if (filterActionCategory) params.action_category = filterActionCategory;
      if (filterCountry) params.country_code = filterCountry;
      if (filterResult) params.result = filterResult;
      if (filterTarget.trim()) params.target = filterTarget.trim();
      if (filterDateRange?.[0]) params.date_from = filterDateRange[0].toISOString();
      if (filterDateRange?.[1]) params.date_to = filterDateRange[1].toISOString();

      const res = await auditAPI.list(params);
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('取得稽核日誌失敗:', err);
      message.error(t('auditLogs.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterEmail, filterAction, filterActionCategory, filterCountry, filterResult, filterTarget, filterDateRange]);

  useEffect(() => {
    fetchLogs(1, pageSize);
    setPage(1);
  }, [filterEmail, filterAction, filterActionCategory, filterCountry, filterResult, filterTarget, filterDateRange]);

  useEffect(() => {
    fetchLogs(page, pageSize);
  }, [page, pageSize]);

  // 匯出 CSV
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (filterEmail.trim()) params.user_email = filterEmail.trim();
      if (filterAction) params.action = filterAction;
      else if (filterActionCategory) params.action_category = filterActionCategory;
      if (filterCountry) params.country_code = filterCountry;
      if (filterResult) params.result = filterResult;
      if (filterTarget.trim()) params.target = filterTarget.trim();
      if (filterDateRange?.[0]) params.date_from = filterDateRange[0].toISOString();
      if (filterDateRange?.[1]) params.date_to = filterDateRange[1].toISOString();

      const res = await auditAPI.export(params);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_logs_${dayjs().format('YYYYMMDD_HHmmss')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success(t('auditLogs.exportSuccess'));
    } catch (err) {
      console.error('匯出失敗:', err);
      message.error(t('auditLogs.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // 重設篩選
  const handleReset = () => {
    setFilterEmail('');
    setFilterActionCategory(null);
    setFilterAction(null);
    setFilterCountry(null);
    setFilterResult(null);
    setFilterTarget('');
    setFilterDateRange(null);
    setPage(1);
  };

  // 表格欄位定義
  const columns = [
    {
      title: t('auditLogs.colTime'),
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (ts) => ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: t('auditLogs.colUser'),
      dataIndex: 'user_email',
      key: 'user_email',
      width: 200,
      ellipsis: true,
      render: (email) => (
        <Text copyable={{ text: email }} style={{ fontSize: 13 }}>
          {email || '-'}
        </Text>
      ),
    },
    {
      title: t('auditLogs.colAction'),
      dataIndex: 'action',
      key: 'action',
      width: 160,
      render: (action) => (
        <Tag color={getActionColor(action)}>
          {ACTION_LABELS[action] || action}
        </Tag>
      ),
    },
    {
      title: t('auditLogs.colTarget'),
      dataIndex: 'target',
      key: 'target',
      width: 200,
      ellipsis: true,
      render: (target) => (
        <Tooltip title={target}>
          <Text style={{ fontSize: 13 }}>{target || '-'}</Text>
        </Tooltip>
      ),
    },
    {
      title: t('auditLogs.colCountry'),
      dataIndex: 'country_code',
      key: 'country_code',
      width: 70,
      align: 'center',
      render: (code) => code ? <Tag>{code}</Tag> : '-',
    },
    {
      title: t('auditLogs.colResult'),
      dataIndex: 'result',
      key: 'result',
      width: 90,
      align: 'center',
      render: (result) => (
        result === 'failure'
          ? <Badge status="error" text={t('auditLogs.resultFailure')} />
          : <Badge status="success" text={t('auditLogs.resultSuccess')} />
      ),
    },
    {
      title: t('auditLogs.colIp'),
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 130,
      render: (ip) => ip || '-',
    },
    {
      title: t('auditLogs.colDuration'),
      dataIndex: 'response_time_ms',
      key: 'response_time_ms',
      width: 80,
      align: 'right',
      render: (ms) => ms != null ? `${ms} ms` : '-',
    },
    {
      title: t('auditLogs.colDetail'),
      key: 'detail',
      width: 70,
      align: 'center',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={() => {
            setSelectedLog(record);
            setDetailModalOpen(true);
          }}
        />
      ),
    },
  ];

  return (
    <div className="audit-logs-page settings-page">
      <div className="settings-header">
        <h2>{t('auditLogs.title')}</h2>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchLogs(page, pageSize)}
            loading={loading}
          >
            {t('auditLogs.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
            loading={exporting}
          >
            {t('auditLogs.exportCsv')}
          </Button>
        </Space>
      </div>

      {/* 篩選列 */}
      <div className="audit-filters">
        <div className="audit-filter-row">
          <Input
            placeholder={t('auditLogs.searchEmail')}
            prefix={<SearchOutlined />}
            value={filterEmail}
            onChange={(e) => setFilterEmail(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Select
            placeholder={t('auditLogs.actionCategory')}
            value={filterActionCategory}
            onChange={(v) => { setFilterActionCategory(v); setFilterAction(null); }}
            allowClear
            style={{ width: 140 }}
          >
            {ACTION_CATEGORIES.map((cat) => (
              <Option key={cat.value} value={cat.value}>{cat.label}</Option>
            ))}
          </Select>
          <Select
            placeholder={t('auditLogs.actionResult')}
            value={filterResult}
            onChange={setFilterResult}
            allowClear
            style={{ width: 120 }}
          >
            <Option value="success">{t('auditLogs.resultSuccess')}</Option>
            <Option value="failure">{t('auditLogs.resultFailure')}</Option>
          </Select>
          {isRoot && (
            <Select
              placeholder={t('auditLogs.country')}
              value={filterCountry}
              onChange={setFilterCountry}
              allowClear
              style={{ width: 100 }}
            >
              {countryList.map((c) => (
                <Option key={c.code} value={c.code}>{c.code}</Option>
              ))}
            </Select>
          )}
          <Input
            placeholder={t('auditLogs.searchTarget')}
            prefix={<FilterOutlined />}
            value={filterTarget}
            onChange={(e) => setFilterTarget(e.target.value)}
            allowClear
            style={{ width: 200 }}
          />
          <RangePicker
            showTime
            value={filterDateRange}
            onChange={setFilterDateRange}
            style={{ width: 360 }}
            placeholder={[t('auditLogs.startTime'), t('auditLogs.endTime')]}
          />
          <Button onClick={handleReset}>{t('auditLogs.resetFilter')}</Button>
        </div>
        <div className="audit-filter-summary">
          {t('auditLogs.totalRecords', { total })}
        </div>
      </div>

      {/* 日誌表格 */}
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="log_id"
        loading={loading}
        size="small"
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (tot) => t('auditLogs.showTotal', { total: tot }),
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        rowClassName={(record) =>
          record.result === 'failure' ? 'audit-row-failure' : ''
        }
      />

      {/* 詳情 Modal */}
      <Modal
        title={t('auditLogs.detailTitle')}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            {t('common.close')}
          </Button>,
        ]}
        width={640}
      >
        {selectedLog && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('auditLogs.detailTime')}>
              {selectedLog.timestamp
                ? dayjs(selectedLog.timestamp).format('YYYY-MM-DD HH:mm:ss')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailUser')}>
              {selectedLog.user_email || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailAction')}>
              <Tag color={getActionColor(selectedLog.action)}>
                {ACTION_LABELS[selectedLog.action] || selectedLog.action}
              </Tag>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                ({selectedLog.action})
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailTarget')}>
              {selectedLog.target || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailCountry')}>
              {selectedLog.country_code || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailResult')}>
              {selectedLog.result === 'failure'
                ? <Badge status="error" text={t('auditLogs.resultFailure')} />
                : <Badge status="success" text={t('auditLogs.resultSuccess')} />}
            </Descriptions.Item>
            {selectedLog.error_message && (
              <Descriptions.Item label={t('auditLogs.detailErrorMsg')}>
                <Text type="danger">{selectedLog.error_message}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label={t('auditLogs.detailIp')}>
              {selectedLog.ip_address || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailBrowser')}>
              <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {selectedLog.user_agent || '-'}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('auditLogs.detailResponseTime')}>
              {selectedLog.response_time_ms != null
                ? `${selectedLog.response_time_ms} ms`
                : '-'}
            </Descriptions.Item>
            {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
              <Descriptions.Item label={t('auditLogs.detailExtra')}>
                <pre className="audit-details-json">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default AuditLogs;
