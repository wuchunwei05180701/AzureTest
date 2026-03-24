import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, Table, Select, DatePicker, Button,
  Spin, Empty, Tag, Space, Tooltip, Progress, Typography, Segmented,
} from 'antd';
import {
  EyeOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  ReloadOutlined,
  BarChartOutlined,
  BookOutlined,
  FileTextOutlined,
  RiseOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { libraryAPI } from '../../services/api';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import dayjs from 'dayjs';
import '../Settings.css';

const { RangePicker } = DatePicker;
const { Text } = Typography;

// 簡易長條圖元件（不依賴外部圖表庫）
const SimpleBarChart = ({ data, valueKey, labelKey, color = '#2aabb3', maxItems = 10 }) => {
  if (!data || data.length === 0) return <Empty description="暫無資料" style={{ padding: '20px 0' }} />;
  const items = data.slice(0, maxItems);
  const maxVal = Math.max(...items.map((d) => d[valueKey] || 0), 1);
  return (
    <div style={{ padding: '8px 0' }}>
      {items.map((item, idx) => {
        const val = item[valueKey] || 0;
        const pct = Math.round((val / maxVal) * 100);
        return (
          <div key={idx} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text
                ellipsis={{ tooltip: item[labelKey] }}
                style={{ fontSize: 12, maxWidth: '70%', color: '#333' }}
              >
                {idx + 1}. {item[labelKey] || '（未知）'}
              </Text>
              <Text style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>{val}</Text>
            </div>
            <Progress
              percent={pct}
              showInfo={false}
              strokeColor={color}
              trailColor="#f0f0f0"
              size="small"
              style={{ margin: 0 }}
            />
          </div>
        );
      })}
    </div>
  );
};

// 每日趨勢折線圖（純 CSS/SVG 實作）
const TrendChart = ({ data }) => {
  if (!data || data.length === 0) return <Empty description="暫無趨勢資料" style={{ padding: '20px 0' }} />;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const maxVal = Math.max(...sorted.map((d) => d.views + d.downloads + d.previews), 1);
  const width = 600;
  const height = 160;
  const padL = 40;
  const padR = 20;
  const padT = 10;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const toX = (i) => padL + (i / Math.max(sorted.length - 1, 1)) * chartW;
  const toY = (v) => padT + chartH - (v / maxVal) * chartH;

  const viewsPath = sorted.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.views)}`).join(' ');
  const downloadsPath = sorted.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.downloads)}`).join(' ');

  // 只顯示最多 7 個日期標籤
  const step = Math.ceil(sorted.length / 7);
  const labelIndices = sorted.map((_, i) => i).filter((i) => i % step === 0 || i === sorted.length - 1);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ display: 'block', margin: '0 auto' }}>
        {/* 格線 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padT + chartH * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#999">
                {Math.round(maxVal * ratio)}
              </text>
            </g>
          );
        })}
        {/* 點擊折線（藍色） */}
        <path d={viewsPath} fill="none" stroke="#2aabb3" strokeWidth={2} />
        {/* 下載折線（橙色） */}
        <path d={downloadsPath} fill="none" stroke="#fa8c16" strokeWidth={2} />
        {/* 日期標籤 */}
        {labelIndices.map((i) => (
          <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" fontSize={10} fill="#999">
            {sorted[i].date.slice(5)}
          </text>
        ))}
        {/* 圖例 */}
        <circle cx={padL + 10} cy={padT - 2} r={4} fill="#2aabb3" />
        <text x={padL + 18} y={padT + 2} fontSize={11} fill="#2aabb3">點擊</text>
        <circle cx={padL + 60} cy={padT - 2} r={4} fill="#fa8c16" />
        <text x={padL + 68} y={padT + 2} fontSize={11} fill="#fa8c16">下載</text>
      </svg>
    </div>
  );
};

const LibraryStats = () => {
  const { effectiveCountry, isSuperAdmin, countries, displayCountry } = useCountry();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [dateRange, setDateRange] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [activeTab, setActiveTab] = useState('docs');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      const country = isSuperAdmin ? (selectedCountry || displayCountry) : effectiveCountry;
      if (country) params.country = country;
      if (dateRange && dateRange[0]) params.date_from = dateRange[0].toISOString();
      if (dateRange && dateRange[1]) params.date_to = dateRange[1].toISOString();

      const res = await libraryAPI.getStats(params);
      setStats(res.data);
    } catch (err) {
      console.error('取得統計資料失敗:', err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [effectiveCountry, isSuperAdmin, selectedCountry, displayCountry, dateRange]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // 文件排行表格欄位
  const docColumns = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_, __, idx) => {
        const colors = ['#ffd700', '#c0c0c0', '#cd7f32'];
        return idx < 3
          ? <TrophyOutlined style={{ color: colors[idx], fontSize: 16 }} />
          : <Text style={{ color: '#999', fontSize: 13 }}>{idx + 1}</Text>;
      },
    },
    {
      title: '文件名稱',
      dataIndex: 'doc_name',
      key: 'doc_name',
      ellipsis: true,
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{name || record.doc_id?.slice(0, 8) + '...'}</div>
          <Tag color="blue" style={{ fontSize: 11, marginTop: 2 }}>
            <BookOutlined style={{ marginRight: 3 }} />
            {record.library_name || '（未知館）'}
          </Tag>
        </div>
      ),
    },
    {
      title: <span><EyeOutlined style={{ marginRight: 4, color: '#2aabb3' }} />點擊</span>,
      dataIndex: 'views',
      key: 'views',
      width: 80,
      sorter: (a, b) => a.views - b.views,
      render: (v) => <Text style={{ color: '#2aabb3', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: <span><FilePdfOutlined style={{ marginRight: 4, color: '#e74c3c' }} />預覽</span>,
      dataIndex: 'previews',
      key: 'previews',
      width: 80,
      sorter: (a, b) => a.previews - b.previews,
      render: (v) => <Text style={{ color: '#e74c3c', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: <span><DownloadOutlined style={{ marginRight: 4, color: '#fa8c16' }} />下載</span>,
      dataIndex: 'downloads',
      key: 'downloads',
      width: 80,
      sorter: (a, b) => a.downloads - b.downloads,
      render: (v) => <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: '總互動',
      key: 'total',
      width: 80,
      sorter: (a, b) => (a.views + a.previews + a.downloads) - (b.views + b.previews + b.downloads),
      defaultSortOrder: 'descend',
      render: (_, r) => (
        <Text style={{ fontWeight: 700, color: '#333' }}>
          {r.views + r.previews + r.downloads}
        </Text>
      ),
    },
  ];

  // 各館統計表格欄位
  const libraryColumns = [
    {
      title: '館名',
      dataIndex: 'library_name',
      key: 'library_name',
      render: (name) => (
        <span>
          <BookOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
          {name}
        </span>
      ),
    },
    {
      title: <span><EyeOutlined style={{ marginRight: 4, color: '#2aabb3' }} />點擊</span>,
      dataIndex: 'views',
      key: 'views',
      width: 90,
      sorter: (a, b) => a.views - b.views,
      render: (v) => <Text style={{ color: '#2aabb3', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: <span><FilePdfOutlined style={{ marginRight: 4, color: '#e74c3c' }} />預覽</span>,
      dataIndex: 'previews',
      key: 'previews',
      width: 90,
      sorter: (a, b) => a.previews - b.previews,
      render: (v) => <Text style={{ color: '#e74c3c', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: <span><DownloadOutlined style={{ marginRight: 4, color: '#fa8c16' }} />下載</span>,
      dataIndex: 'downloads',
      key: 'downloads',
      width: 90,
      sorter: (a, b) => a.downloads - b.downloads,
      render: (v) => <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: '總互動',
      key: 'total',
      width: 90,
      sorter: (a, b) => (a.views + a.previews + a.downloads) - (b.views + b.previews + b.downloads),
      defaultSortOrder: 'descend',
      render: (_, r) => (
        <Text style={{ fontWeight: 700 }}>{r.views + r.previews + r.downloads}</Text>
      ),
    },
  ];

  const summary = stats?.summary || { total_views: 0, total_previews: 0, total_downloads: 0 };
  const totalInteractions = summary.total_views + summary.total_previews + summary.total_downloads;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <BarChartOutlined style={{ marginRight: 8 }} />
          圖書館使用統計
        </h2>
      </div>

      {/* 篩選工具列 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <Space wrap>
          {isSuperAdmin && (
            <Select
              placeholder="選擇國家"
              value={selectedCountry || displayCountry}
              onChange={setSelectedCountry}
              style={{ minWidth: 140 }}
              options={countries.map((c) => ({
                value: c.code,
                label: `${c.name} (${c.code})`,
              }))}
            />
          )}
          <RangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder={['開始日期', '結束日期']}
            allowClear
            presets={[
              { label: '最近 7 天', value: [dayjs().subtract(6, 'day'), dayjs()] },
              { label: '最近 30 天', value: [dayjs().subtract(29, 'day'), dayjs()] },
              { label: '最近 90 天', value: [dayjs().subtract(89, 'day'), dayjs()] },
              { label: '本月', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
            ]}
          />
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={fetchStats}
            loading={loading}
            style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
          >
            重新整理
          </Button>
        </Space>
      </Card>

      <Spin spinning={loading} tip="載入統計資料中...">
        {/* 總覽卡片 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={
                  <span>
                    <RiseOutlined style={{ marginRight: 6, color: '#2aabb3' }} />
                    總互動次數
                  </span>
                }
                value={totalInteractions}
                valueStyle={{ color: '#2aabb3', fontWeight: 700 }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={
                  <span>
                    <EyeOutlined style={{ marginRight: 6, color: '#1890ff' }} />
                    文件點擊次數
                  </span>
                }
                value={summary.total_views}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={
                  <span>
                    <FilePdfOutlined style={{ marginRight: 6, color: '#e74c3c' }} />
                    PDF 預覽次數
                  </span>
                }
                value={summary.total_previews}
                valueStyle={{ color: '#e74c3c' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title={
                  <span>
                    <DownloadOutlined style={{ marginRight: 6, color: '#fa8c16' }} />
                    文件下載次數
                  </span>
                }
                value={summary.total_downloads}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Col>
        </Row>

        {/* 趨勢圖 */}
        <Card
          title={
            <span>
              <RiseOutlined style={{ marginRight: 8, color: 'var(--primary-color)' }} />
              每日使用趨勢
            </span>
          }
          style={{ marginBottom: 16 }}
        >
          <TrendChart data={stats?.daily_trend || []} />
        </Card>

        {/* Tab 切換：文件排行 / 各館統計 */}
        <Card
          title={
            <Segmented
              value={activeTab}
              onChange={setActiveTab}
              options={[
                {
                  value: 'docs',
                  label: (
                    <span>
                      <FileTextOutlined style={{ marginRight: 6 }} />
                      文件排行榜
                    </span>
                  ),
                },
                {
                  value: 'libraries',
                  label: (
                    <span>
                      <BookOutlined style={{ marginRight: 6 }} />
                      各館統計
                    </span>
                  ),
                },
                {
                  value: 'chart',
                  label: (
                    <span>
                      <BarChartOutlined style={{ marginRight: 6 }} />
                      長條圖
                    </span>
                  ),
                },
              ]}
            />
          }
        >
          {activeTab === 'docs' && (
            <Table
              columns={docColumns}
              dataSource={stats?.top_docs || []}
              rowKey={(r) => r.doc_id || r.doc_name}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              locale={{ emptyText: <Empty description="暫無資料" /> }}
            />
          )}

          {activeTab === 'libraries' && (
            <Table
              columns={libraryColumns}
              dataSource={stats?.by_library || []}
              rowKey="library_name"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              locale={{ emptyText: <Empty description="暫無資料" /> }}
            />
          )}

          {activeTab === 'chart' && (
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    <EyeOutlined style={{ marginRight: 6, color: '#2aabb3' }} />
                    文件點擊排行（Top 10）
                  </Text>
                </div>
                <SimpleBarChart
                  data={stats?.top_docs || []}
                  valueKey="views"
                  labelKey="doc_name"
                  color="#2aabb3"
                />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    <DownloadOutlined style={{ marginRight: 6, color: '#fa8c16' }} />
                    文件下載排行（Top 10）
                  </Text>
                </div>
                <SimpleBarChart
                  data={[...(stats?.top_docs || [])].sort((a, b) => b.downloads - a.downloads)}
                  valueKey="downloads"
                  labelKey="doc_name"
                  color="#fa8c16"
                />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    <BookOutlined style={{ marginRight: 6, color: '#722ed1' }} />
                    各館點擊統計
                  </Text>
                </div>
                <SimpleBarChart
                  data={stats?.by_library || []}
                  valueKey="views"
                  labelKey="library_name"
                  color="#722ed1"
                />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    <DownloadOutlined style={{ marginRight: 6, color: '#52c41a' }} />
                    各館下載統計
                  </Text>
                </div>
                <SimpleBarChart
                  data={stats?.by_library || []}
                  valueKey="downloads"
                  labelKey="library_name"
                  color="#52c41a"
                />
              </Col>
            </Row>
          )}
        </Card>
      </Spin>
    </div>
  );
};

export default LibraryStats;
