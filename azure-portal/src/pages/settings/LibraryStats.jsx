import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Statistic, Table, Select, DatePicker, Button,
  Spin, Empty, Tag, Space, Tooltip, Progress, Typography, Segmented, Modal,
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
  UserOutlined,
  ClockCircleOutlined,
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

// 預定義顏色表（用於區分不同館的折線）
const LIBRARY_COLORS = [
  '#2aabb3', '#fa8c16', '#e74c3c', '#52c41a', '#722ed1',
  '#1890ff', '#eb2f96', '#13c2c2', '#faad14', '#a0d911',
  '#f5222d', '#2f54eb', '#fa541c', '#9254de', '#36cfc9',
];

// 以館為主的每日趨勢折線圖（純 CSS/SVG 實作）
const LibraryTrendChart = ({ data, metric, onDayClick }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null); // { libIdx, dateIdx }

  if (!data || data.length === 0) return <Empty description="暫無趨勢資料" style={{ padding: '20px 0' }} />;

  // 取得所有日期（從第一個館的 trend 取得，已排序）
  const allDates = data[0]?.trend?.map((t) => t.date) || [];
  if (allDates.length === 0) return <Empty description="暫無趨勢資料" style={{ padding: '20px 0' }} />;

  // 計算最大值
  let maxVal = 1;
  data.forEach((lib) => {
    lib.trend?.forEach((t) => {
      const val = t[metric] || 0;
      if (val > maxVal) maxVal = val;
    });
  });

  const width = 600;
  const height = 220;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const toX = (i) => padL + (i / Math.max(allDates.length - 1, 1)) * chartW;
  const toY = (v) => padT + chartH - (v / maxVal) * chartH;

  const step = Math.ceil(allDates.length / 7);
  const labelIndices = allDates.map((_, i) => i).filter((i) => i % step === 0 || i === allDates.length - 1);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ marginBottom: 6, fontSize: 12, color: '#999', textAlign: 'center' }}>
        💡 點擊圖表上的資料點可查看當天文件明細
      </div>
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
        {/* 每個館一條折線 */}
        {data.map((lib, libIdx) => {
          const color = LIBRARY_COLORS[libIdx % LIBRARY_COLORS.length];
          const trend = lib.trend || [];
          const pathD = trend
            .map((t, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(t[metric] || 0)}`)
            .join(' ');
          return (
            <g key={lib.library_name}>
              <path d={pathD} fill="none" stroke={color} strokeWidth={2} opacity={0.85} />
              {trend.map((t, i) => {
                const isHovered = hoveredPoint?.libIdx === libIdx && hoveredPoint?.dateIdx === i;
                return (
                  <circle
                    key={`${libIdx}-${i}`}
                    cx={toX(i)}
                    cy={toY(t[metric] || 0)}
                    r={isHovered ? 6 : 3.5}
                    fill={isHovered ? color : color}
                    stroke="#fff"
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    style={{ cursor: 'pointer', transition: 'r 0.15s' }}
                    onMouseEnter={() => setHoveredPoint({ libIdx, dateIdx: i })}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => onDayClick && onDayClick(t.date)}
                  />
                );
              })}
            </g>
          );
        })}
        {/* Tooltip */}
        {hoveredPoint !== null && (() => {
          const lib = data[hoveredPoint.libIdx];
          const t = lib?.trend?.[hoveredPoint.dateIdx];
          if (!t) return null;
          const val = t[metric] || 0;
          const label = `${lib.library_name}: ${val}`;
          const textWidth = Math.max(label.length * 7 + 20, 100);
          let tooltipX = toX(hoveredPoint.dateIdx) - textWidth / 2;
          if (tooltipX < 5) tooltipX = 5;
          if (tooltipX + textWidth > width - 5) tooltipX = width - 5 - textWidth;
          return (
            <g>
              <rect
                x={tooltipX}
                y={padT - 18}
                width={textWidth}
                height={16}
                rx={3}
                fill="rgba(0,0,0,0.8)"
              />
              <text x={tooltipX + textWidth / 2} y={padT - 6} textAnchor="middle" fontSize={10} fill="#fff">
                {t.date} | {lib.library_name}: {val}
              </text>
            </g>
          );
        })()}
        {/* X 軸日期標籤 */}
        {labelIndices.map((i) => (
          <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" fontSize={10} fill="#999">
            {allDates[i]?.slice(5)}
          </text>
        ))}
      </svg>
      {/* 圖例 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 16px', marginTop: 8 }}>
        {data.map((lib, idx) => {
          const color = LIBRARY_COLORS[idx % LIBRARY_COLORS.length];
          return (
            <div key={lib.library_name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span style={{ display: 'inline-block', width: 12, height: 3, borderRadius: 2, background: color }} />
              <span style={{ color: '#555' }}>{lib.library_name}</span>
            </div>
          );
        })}
      </div>
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
  const [trendMetric, setTrendMetric] = useState('views');
  const [trendChartMetric, setTrendChartMetric] = useState('views');

  const [dailyDetailVisible, setDailyDetailVisible] = useState(false);
  const [dailyDetailLoading, setDailyDetailLoading] = useState(false);
  const [dailyDetailData, setDailyDetailData] = useState(null);
  const [dailyDetailDate, setDailyDetailDate] = useState('');

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

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleDayClick = useCallback(async (date) => {
    setDailyDetailDate(date);
    setDailyDetailVisible(true);
    setDailyDetailLoading(true);
    try {
      const params = { date };
      const country = isSuperAdmin ? (selectedCountry || displayCountry) : effectiveCountry;
      if (country) params.country = country;
      const res = await libraryAPI.getDailyDetail(params);
      setDailyDetailData(res.data);
    } catch (err) {
      console.error('取得每日明細失敗:', err);
      setDailyDetailData(null);
    } finally {
      setDailyDetailLoading(false);
    }
  }, [isSuperAdmin, selectedCountry, displayCountry, effectiveCountry]);

  const dailyDetailColumns = [
    {
      title: '文件名稱', dataIndex: 'doc_name', key: 'doc_name', ellipsis: true,
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{name || record.doc_id?.slice(0, 8) + '...'}</div>
          <Tag color="blue" style={{ fontSize: 11, marginTop: 2 }}>
            <BookOutlined style={{ marginRight: 3 }} />{record.library_name || '（未知館）'}
          </Tag>
        </div>
      ),
    },
    { title: <span><EyeOutlined style={{ marginRight: 4, color: '#2aabb3' }} />點擊</span>, dataIndex: 'views', key: 'views', width: 70, sorter: (a, b) => a.views - b.views, render: (v) => <Text style={{ color: '#2aabb3', fontWeight: 600 }}>{v}</Text> },
    { title: <span><FilePdfOutlined style={{ marginRight: 4, color: '#e74c3c' }} />預覽</span>, dataIndex: 'previews', key: 'previews', width: 70, sorter: (a, b) => a.previews - b.previews, render: (v) => <Text style={{ color: '#e74c3c', fontWeight: 600 }}>{v}</Text> },
    { title: <span><DownloadOutlined style={{ marginRight: 4, color: '#fa8c16' }} />下載</span>, dataIndex: 'downloads', key: 'downloads', width: 70, sorter: (a, b) => a.downloads - b.downloads, render: (v) => <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{v}</Text> },
    {
      title: <span><UserOutlined style={{ marginRight: 4 }} />使用者</span>, dataIndex: 'users', key: 'users', width: 140,
      render: (users) => <div>{(users || []).map((u, i) => <Tag key={i} style={{ fontSize: 11, marginBottom: 2 }}>{u}</Tag>)}</div>,
    },
    { title: '總計', dataIndex: 'total', key: 'total', width: 60, defaultSortOrder: 'descend', sorter: (a, b) => a.total - b.total, render: (v) => <Text style={{ fontWeight: 700, color: '#333' }}>{v}</Text> },
  ];

  const docColumns = [
    {
      title: '排名', key: 'rank', width: 60,
      render: (_, __, idx) => {
        const colors = ['#ffd700', '#c0c0c0', '#cd7f32'];
        return idx < 3 ? <TrophyOutlined style={{ color: colors[idx], fontSize: 16 }} /> : <Text style={{ color: '#999', fontSize: 13 }}>{idx + 1}</Text>;
      },
    },
    {
      title: '文件名稱', dataIndex: 'doc_name', key: 'doc_name', ellipsis: true,
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{name || record.doc_id?.slice(0, 8) + '...'}</div>
          <Tag color="blue" style={{ fontSize: 11, marginTop: 2 }}><BookOutlined style={{ marginRight: 3 }} />{record.library_name || '（未知館）'}</Tag>
        </div>
      ),
    },
    { title: <span><EyeOutlined style={{ marginRight: 4, color: '#2aabb3' }} />點擊</span>, dataIndex: 'views', key: 'views', width: 80, sorter: (a, b) => a.views - b.views, render: (v) => <Text style={{ color: '#2aabb3', fontWeight: 600 }}>{v}</Text> },
    { title: <span><FilePdfOutlined style={{ marginRight: 4, color: '#e74c3c' }} />預覽</span>, dataIndex: 'previews', key: 'previews', width: 80, sorter: (a, b) => a.previews - b.previews, render: (v) => <Text style={{ color: '#e74c3c', fontWeight: 600 }}>{v}</Text> },
    { title: <span><DownloadOutlined style={{ marginRight: 4, color: '#fa8c16' }} />下載</span>, dataIndex: 'downloads', key: 'downloads', width: 80, sorter: (a, b) => a.downloads - b.downloads, render: (v) => <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{v}</Text> },
    {
      title: '總互動', key: 'total', width: 80, defaultSortOrder: 'descend',
      sorter: (a, b) => (a.views + a.previews + a.downloads) - (b.views + b.previews + b.downloads),
      render: (_, r) => <Text style={{ fontWeight: 700, color: '#333' }}>{r.views + r.previews + r.downloads}</Text>,
    },
  ];

  const libraryColumns = [
    { title: '館名', dataIndex: 'library_name', key: 'library_name', render: (name) => <span><BookOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />{name}</span> },
    { title: <span><EyeOutlined style={{ marginRight: 4, color: '#2aabb3' }} />點擊</span>, dataIndex: 'views', key: 'views', width: 90, sorter: (a, b) => a.views - b.views, render: (v) => <Text style={{ color: '#2aabb3', fontWeight: 600 }}>{v}</Text> },
    { title: <span><FilePdfOutlined style={{ marginRight: 4, color: '#e74c3c' }} />預覽</span>, dataIndex: 'previews', key: 'previews', width: 90, sorter: (a, b) => a.previews - b.previews, render: (v) => <Text style={{ color: '#e74c3c', fontWeight: 600 }}>{v}</Text> },
    { title: <span><DownloadOutlined style={{ marginRight: 4, color: '#fa8c16' }} />下載</span>, dataIndex: 'downloads', key: 'downloads', width: 90, sorter: (a, b) => a.downloads - b.downloads, render: (v) => <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{v}</Text> },
    {
      title: '總互動', key: 'total', width: 90, defaultSortOrder: 'descend',
      sorter: (a, b) => (a.views + a.previews + a.downloads) - (b.views + b.previews + b.downloads),
      render: (_, r) => <Text style={{ fontWeight: 700 }}>{r.views + r.previews + r.downloads}</Text>,
    },
  ];

  const summary = stats?.summary || { total_views: 0, total_previews: 0, total_downloads: 0 };
  const totalInteractions = summary.total_views + summary.total_previews + summary.total_downloads;

  const sortedLibraryData = [...(stats?.by_library || [])].sort(
    (a, b) => (b[trendMetric] || 0) - (a[trendMetric] || 0)
  );

  const metricConfig = {
    views: { color: '#2aabb3' },
    downloads: { color: '#fa8c16' },
    previews: { color: '#e74c3c' },
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <BarChartOutlined style={{ marginRight: 8 }} />
          圖書館使用統計
        </h2>
      </div>

      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <Space wrap>
          {isSuperAdmin && (
            <Select
              placeholder="選擇國家"
              value={selectedCountry || displayCountry}
              onChange={setSelectedCountry}
              style={{ minWidth: 140 }}
              options={countries.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
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
          <Button type="primary" icon={<ReloadOutlined />} onClick={fetchStats} loading={loading} style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}>
            重新整理
          </Button>
        </Space>
      </Card>

      <Spin spinning={loading} tip="載入統計資料中...">
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title={<span><RiseOutlined style={{ marginRight: 6, color: '#2aabb3' }} />總互動次數</span>} value={totalInteractions} valueStyle={{ color: '#2aabb3', fontWeight: 700 }} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title={<span><EyeOutlined style={{ marginRight: 6, color: '#1890ff' }} />文件點擊次數</span>} value={summary.total_views} valueStyle={{ color: '#1890ff' }} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title={<span><FilePdfOutlined style={{ marginRight: 6, color: '#e74c3c' }} />PDF 預覽次數</span>} value={summary.total_previews} valueStyle={{ color: '#e74c3c' }} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title={<span><DownloadOutlined style={{ marginRight: 6, color: '#fa8c16' }} />文件下載次數</span>} value={summary.total_downloads} valueStyle={{ color: '#fa8c16' }} /></Card>
          </Col>
        </Row>

        {/* 以館為主的每日趨勢折線圖 */}
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span><RiseOutlined style={{ marginRight: 8, color: 'var(--primary-color)' }} />各館每日使用趨勢</span>
              <Segmented
                value={trendChartMetric}
                onChange={setTrendChartMetric}
                size="small"
                options={[
                  { value: 'views', label: <span><EyeOutlined style={{ marginRight: 4 }} />點擊</span> },
                  { value: 'downloads', label: <span><DownloadOutlined style={{ marginRight: 4 }} />下載</span> },
                ]}
              />
            </div>
          }
          style={{ marginBottom: 16 }}
        >
          <LibraryTrendChart
            data={stats?.daily_trend_by_library || []}
            metric={trendChartMetric}
            onDayClick={handleDayClick}
          />
        </Card>

        {/* Tab 切換 */}
        <Card
          title={
            <Segmented
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: 'docs', label: <span><FileTextOutlined style={{ marginRight: 6 }} />文件排行榜</span> },
                { value: 'libraries', label: <span><BookOutlined style={{ marginRight: 6 }} />各館統計</span> },
                { value: 'chart', label: <span><BarChartOutlined style={{ marginRight: 6 }} />長條圖</span> },
              ]}
            />
          }
        >
          {activeTab === 'docs' && (
            <Table columns={docColumns} dataSource={stats?.top_docs || []} rowKey={(r) => r.doc_id || r.doc_name} pagination={{ pageSize: 10, showSizeChanger: false }} size="small" locale={{ emptyText: <Empty description="暫無資料" /> }} />
          )}
          {activeTab === 'libraries' && (
            <Table columns={libraryColumns} dataSource={stats?.by_library || []} rowKey="library_name" pagination={{ pageSize: 10, showSizeChanger: false }} size="small" locale={{ emptyText: <Empty description="暫無資料" /> }} />
          )}
          {activeTab === 'chart' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text strong style={{ fontSize: 14 }}>
                  <BookOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
                  各館使用統計
                </Text>
                <Segmented
                  value={trendMetric}
                  onChange={setTrendMetric}
                  options={[
                    { value: 'views', label: <span><EyeOutlined style={{ marginRight: 4 }} />點擊</span> },
                    { value: 'downloads', label: <span><DownloadOutlined style={{ marginRight: 4 }} />下載</span> },
                    { value: 'previews', label: <span><FilePdfOutlined style={{ marginRight: 4 }} />預覽</span> },
                  ]}
                />
              </div>
              <SimpleBarChart
                data={sortedLibraryData}
                valueKey={trendMetric}
                labelKey="library_name"
                color={metricConfig[trendMetric].color}
                maxItems={15}
              />
            </div>
          )}
        </Card>
      </Spin>

      {/* 每日明細 Modal */}
      <Modal
        title={<span><ClockCircleOutlined style={{ marginRight: 8, color: 'var(--primary-color)' }} />{dailyDetailDate} 文件使用明細</span>}
        open={dailyDetailVisible}
        onCancel={() => { setDailyDetailVisible(false); setDailyDetailData(null); }}
        footer={null}
        width={800}
        destroyOnClose
      >
        <Spin spinning={dailyDetailLoading}>
          {dailyDetailData ? (
            <>
              <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                <Col span={8}>
                  <Card size="small" bodyStyle={{ textAlign: 'center' }}>
                    <Statistic title={<span style={{ fontSize: 12 }}><EyeOutlined style={{ color: '#2aabb3', marginRight: 4 }} />點擊</span>} value={dailyDetailData.docs?.reduce((s, d) => s + d.views, 0) || 0} valueStyle={{ color: '#2aabb3', fontSize: 20 }} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" bodyStyle={{ textAlign: 'center' }}>
                    <Statistic title={<span style={{ fontSize: 12 }}><FilePdfOutlined style={{ color: '#e74c3c', marginRight: 4 }} />預覽</span>} value={dailyDetailData.docs?.reduce((s, d) => s + d.previews, 0) || 0} valueStyle={{ color: '#e74c3c', fontSize: 20 }} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" bodyStyle={{ textAlign: 'center' }}>
                    <Statistic title={<span style={{ fontSize: 12 }}><DownloadOutlined style={{ color: '#fa8c16', marginRight: 4 }} />下載</span>} value={dailyDetailData.docs?.reduce((s, d) => s + d.downloads, 0) || 0} valueStyle={{ color: '#fa8c16', fontSize: 20 }} />
                  </Card>
                </Col>
              </Row>
              <Table
                columns={dailyDetailColumns}
                dataSource={dailyDetailData.docs || []}
                rowKey={(r) => r.doc_id || r.doc_name}
                pagination={false}
                size="small"
                scroll={{ y: 400 }}
                locale={{ emptyText: <Empty description="當天無任何文件互動記錄" /> }}
                expandable={{
                  expandedRowRender: (record) => (
                    <div style={{ padding: '4px 0' }}>
                      <Text strong style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>操作記錄：</Text>
                      {(record.records || []).map((r, i) => {
                        const actionMap = { 'library.view': { label: '點擊', color: '#2aabb3' }, 'library.preview': { label: '預覽', color: '#e74c3c' }, 'library.download': { label: '下載', color: '#fa8c16' } };
                        const info = actionMap[r.action] || { label: r.action, color: '#999' };
                        return (
                          <div key={i} style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Tag color={info.color} style={{ fontSize: 11, margin: 0 }}>{info.label}</Tag>
                            <span style={{ color: '#666' }}>{r.user}</span>
                            <span style={{ color: '#999', marginLeft: 'auto' }}>{r.time}</span>
                          </div>
                        );
                      })}
                    </div>
                  ),
                  rowExpandable: (record) => record.records && record.records.length > 0,
                }}
              />
            </>
          ) : (
            !dailyDetailLoading && <Empty description="無法載入明細資料" />
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default LibraryStats;
