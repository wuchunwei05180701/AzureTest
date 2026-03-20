import React, { useState, useEffect, useCallback } from 'react';
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
import '../Settings.css';
import './AuditLogs.css';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;

// 操作類型中文標籤
const ACTION_LABELS = {
  'auth.otp_request':     '申請 OTP',
  'auth.login_success':   '登入成功',
  'auth.login_failed':    '登入失敗',
  'auth.account_locked':  '帳號鎖定',
  'auth.logout':          '登出',
  'user.create':          '新增使用者',
  'user.update':          '更新使用者',
  'user.role_change':     '變更角色',
  'user.status_change':   '變更狀態',
  'user.delete':          '刪除使用者',
  'agent.publish':        '上架 Agent',
  'agent.unpublish':      '下架 Agent',
  'agent.acl_update':     '更新 Agent 權限',
  'library.upload':       '上傳文件',
  'library.download':     '下載文件',
  'library.delete':       '刪除文件',
  'library.update':       '更新文件',
  'library.auth_update':  '更新文件權限',
  'announcement.create':  '新增公告',
  'announcement.update':  '更新公告',
  'announcement.delete':  '刪除公告',
  'chat.session_delete':  '刪除對話',
  'pii.detected_chat':    '聊天偵測到個資',
  'pii.blocked_upload':   '上傳因個資被阻擋',
  'pii.blocked_chat':     '聊天因個資被阻擋',
};

// 操作類別（用於篩選下拉）
const ACTION_CATEGORIES = [
  { value: 'auth',         label: '認證' },
  { value: 'user',         label: '使用者管理' },
  { value: 'agent',        label: 'Agent 管理' },
  { value: 'library',      label: '圖書館' },
  { value: 'announcement', label: '公告' },
  { value: 'chat',         label: '聊天' },
  { value: 'pii',          label: '個資偵測' },
];

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
  const { user: currentUser } = useAuth();
  const { countries: countryList } = useCountry();

  const isRoot = currentUser?.role === 'root';

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
      message.error('取得稽核日誌失敗');
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
      message.success('CSV 匯出成功');
    } catch (err) {
      console.error('匯出失敗:', err);
      message.error('匯出失敗');
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
      title: '時間',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (ts) => ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '使用者',
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
      title: '操作類型',
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
      title: '操作對象',
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
      title: '國家',
      dataIndex: 'country_code',
      key: 'country_code',
      width: 70,
      align: 'center',
      render: (code) => code ? <Tag>{code}</Tag> : '-',
    },
    {
      title: '結果',
      dataIndex: 'result',
      key: 'result',
      width: 90,
      align: 'center',
      render: (result) => (
        result === 'failure'
          ? <Badge status="error" text="失敗" />
          : <Badge status="success" text="成功" />
      ),
    },
    {
      title: 'IP 位址',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 130,
      render: (ip) => ip || '-',
    },
    {
      title: '耗時',
      dataIndex: 'response_time_ms',
      key: 'response_time_ms',
      width: 80,
      align: 'right',
      render: (ms) => ms != null ? `${ms} ms` : '-',
    },
    {
      title: '詳情',
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
        <h2>稽核日誌</h2>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchLogs(page, pageSize)}
            loading={loading}
          >
            重新整理
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
            loading={exporting}
          >
            匯出 CSV
          </Button>
        </Space>
      </div>

      {/* 篩選列 */}
      <div className="audit-filters">
        <div className="audit-filter-row">
          <Input
            placeholder="搜尋使用者 Email"
            prefix={<SearchOutlined />}
            value={filterEmail}
            onChange={(e) => setFilterEmail(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Select
            placeholder="操作類別"
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
            placeholder="操作結果"
            value={filterResult}
            onChange={setFilterResult}
            allowClear
            style={{ width: 120 }}
          >
            <Option value="success">成功</Option>
            <Option value="failure">失敗</Option>
          </Select>
          {isRoot && (
            <Select
              placeholder="國家"
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
            placeholder="搜尋操作對象"
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
            placeholder={['開始時間', '結束時間']}
          />
          <Button onClick={handleReset}>重設篩選</Button>
        </div>
        <div className="audit-filter-summary">
          共 <strong>{total}</strong> 筆記錄
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
          showTotal: (t) => `共 ${t} 筆`,
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
        title="日誌詳情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            關閉
          </Button>,
        ]}
        width={640}
      >
        {selectedLog && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="時間">
              {selectedLog.timestamp
                ? dayjs(selectedLog.timestamp).format('YYYY-MM-DD HH:mm:ss')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="使用者">
              {selectedLog.user_email || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="操作類型">
              <Tag color={getActionColor(selectedLog.action)}>
                {ACTION_LABELS[selectedLog.action] || selectedLog.action}
              </Tag>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                ({selectedLog.action})
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="操作對象">
              {selectedLog.target || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="國家">
              {selectedLog.country_code || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="結果">
              {selectedLog.result === 'failure'
                ? <Badge status="error" text="失敗" />
                : <Badge status="success" text="成功" />}
            </Descriptions.Item>
            {selectedLog.error_message && (
              <Descriptions.Item label="失敗原因">
                <Text type="danger">{selectedLog.error_message}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="IP 位址">
              {selectedLog.ip_address || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="瀏覽器">
              <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {selectedLog.user_agent || '-'}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="回應時間">
              {selectedLog.response_time_ms != null
                ? `${selectedLog.response_time_ms} ms`
                : '-'}
            </Descriptions.Item>
            {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
              <Descriptions.Item label="補充資訊">
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
