import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Tag, Spin, message, List, Input, Pagination, Empty } from 'antd';
import {
  SoundOutlined,
  RobotOutlined,
  BookOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined,
  LinkOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  EyeOutlined,
  LoadingOutlined,
  FileOutlined,
  HistoryOutlined,
  SearchOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { announcementAPI, agentAPI, libraryAPI } from '../services/api';
import { adaptAnnouncements, adaptAgents, adaptLibraryDocsFlat } from '../utils/adapters';
import { announcements as mockAnnouncements, agents as mockAgents, libraries as mockLibraries } from '../data/mockData';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import PdfThumbnail from '../components/PdfThumbnail';
import './Home.css';

/** 判斷檔名是否為 PDF */
const isPdfFile = (filename) => {
  if (!filename) return false;
  return filename.toLowerCase().endsWith('.pdf');
};

/** 根據檔名取得對應的檔案圖示 */
const getFileIcon = (filename) => {
  if (!filename) return <FileOutlined style={{ color: '#999' }} />;
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#e74c3c' }} />;
    case 'doc':
    case 'docx':
    case 'odt':
    case 'rtf':
      return <FileWordOutlined style={{ color: '#2b579a' }} />;
    case 'xls':
    case 'xlsx':
    case 'ods':
    case 'csv':
      return <FileExcelOutlined style={{ color: '#217346' }} />;
    case 'ppt':
    case 'pptx':
    case 'odp':
      return <FilePptOutlined style={{ color: '#d24726' }} />;
    case 'txt':
      return <FileTextOutlined style={{ color: '#666' }} />;
    default:
      return <FileOutlined style={{ color: '#999' }} />;
  }
};

const Home = () => {
  const navigate = useNavigate();
  const { effectiveCountry } = useCountry();
  const { t } = useLanguage();

  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [agents, setAgents] = useState([]);
  const [latestDocs, setLatestDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 圖書館文件 PDF 縮圖 blob URL map: { docId: blobUrl }
  const [docThumbnails, setDocThumbnails] = useState({});

  // PDF 縮圖用的 blob URL（用於 PdfThumbnail 渲染第一頁）
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  // 完整預覽 Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFilename, setPreviewFilename] = useState(null);
  // 下載檔案彈窗
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  // 全部公告 Modal
  const [allAnnouncementsModal, setAllAnnouncementsModal] = useState(false);
  const [allAnnouncements, setAllAnnouncements] = useState([]);
  const [allAnnouncementsLoading, setAllAnnouncementsLoading] = useState(false);
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [announcementPage, setAnnouncementPage] = useState(1);
  const ANNOUNCEMENTS_PER_PAGE = 4;
  const HOME_ANNOUNCEMENTS_LIMIT = 5;

  const fetchData = async (country) => {
    setLoading(true);

    // 公告
    try {
      const res = await announcementAPI.list(country);
      setAnnouncements(adaptAnnouncements(res.data));
    } catch (err) {
      console.warn('公告 API 失敗，使用 mock 資料', err);
      setAnnouncements(mockAnnouncements);
    }

    // Agent（全球共用，不受國家影響）
    try {
      const res = await agentAPI.list();
      setAgents(adaptAgents(res.data));
    } catch (err) {
      console.warn('Agent API 失敗，使用 mock 資料', err);
      setAgents(mockAgents);
    }

    // 圖書館（最新 4 筆）
    let docs = [];
    try {
      const res = await libraryAPI.latest(country, 4);
      docs = adaptLibraryDocsFlat(res.data);
      setLatestDocs(docs);
    } catch (err) {
      console.warn('圖書館 API 失敗，使用 mock 資料', err);
      docs = mockLibraries[0]?.documents?.slice(0, 4) || [];
      setLatestDocs(docs);
    }

    // 為有 PDF 檔案的文件載入縮圖
    const thumbnails = {};
    await Promise.allSettled(
      docs.map(async (doc) => {
        // 找到第一個 PDF 檔案
        const pdfFile = doc.files?.find((f) =>
          f.filename?.toLowerCase().endsWith('.pdf')
        );
        if (!pdfFile) return;
        try {
          const res = await libraryAPI.preview(doc.id, country, pdfFile.filename);
          const blob = new Blob([res.data], { type: 'application/pdf' });
          thumbnails[doc.id] = URL.createObjectURL(blob);
        } catch (err) {
          console.warn(`文件 ${doc.id} PDF 縮圖載入失敗:`, err);
        }
      })
    );
    setDocThumbnails((prev) => {
      // 清理舊的 blob URL
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return thumbnails;
    });

    setLoading(false);
  };

  useEffect(() => {
    fetchData(effectiveCountry);
  }, [effectiveCountry]);

  // 載入 PDF blob URL（用於縮圖）
  const loadThumbnail = useCallback(async (announcement) => {
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      setThumbnailUrl(null);
    }

    if (!announcement?.attachments?.length) return;

    // 找到第一個 PDF 附件
    const firstPdf = announcement.attachments.find((a) => isPdfFile(a.name));
    if (!firstPdf) return;

    setThumbnailLoading(true);
    try {
      const res = await announcementAPI.preview(announcement.id, effectiveCountry, firstPdf.name);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setThumbnailUrl(url);
    } catch (err) {
      console.error('PDF 縮圖載入失敗:', err);
      setThumbnailUrl(null);
    } finally {
      setThumbnailLoading(false);
    }
  }, [thumbnailUrl, effectiveCountry]);

  // 載入完整預覽（開新 Modal 時用）
  const loadFullPreview = useCallback(async (announcement, filename) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    if (!announcement?.attachments?.length) return;

    const targetFilename = filename || announcement.attachments.find((a) => isPdfFile(a.name))?.name;
    if (!targetFilename || !isPdfFile(targetFilename)) return;

    setPreviewFilename(targetFilename);
    setPreviewLoading(true);
    try {
      const res = await announcementAPI.preview(announcement.id, effectiveCountry, targetFilename);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (err) {
      console.error('PDF 預覽載入失敗:', err);
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewUrl, effectiveCountry]);

  // 選擇公告時自動載入縮圖
  useEffect(() => {
    if (selectedAnnouncement?.attachments?.length > 0) {
      loadThumbnail(selectedAnnouncement);
    }
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAnnouncement?.id]);

  // 點擊縮圖 → 開新的預覽 Modal
  const handleOpenPreviewModal = (announcement, filename) => {
    setPreviewModalOpen(true);
    loadFullPreview(announcement, filename);
  };

  // 關閉預覽 Modal
  const handleClosePreviewModal = () => {
    setPreviewModalOpen(false);
    setPreviewFilename(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  // 關閉公告 Modal
  const handleCloseAnnouncement = () => {
    setSelectedAnnouncement(null);
    setDownloadModalOpen(false);
    handleClosePreviewModal();
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      setThumbnailUrl(null);
    }
  };

  // 開啟全部公告 Modal（載入所有公告，含歷史）
  const handleOpenAllAnnouncements = async () => {
    setAllAnnouncementsModal(true);
    setAllAnnouncementsLoading(true);
    setAnnouncementSearch('');
    setAnnouncementPage(1);
    try {
      const res = await announcementAPI.list(effectiveCountry);
      setAllAnnouncements(adaptAnnouncements(res.data));
    } catch (err) {
      console.warn('載入全部公告失敗', err);
      setAllAnnouncements(announcements);
    } finally {
      setAllAnnouncementsLoading(false);
    }
  };

  // 下載公告附件
  const handleDownloadAttachment = async (announcement, filename) => {
    try {
      const res = await announcementAPI.download(announcement.id, effectiveCountry, filename);
      let downloadName = filename || announcement.attachment?.name || 'attachment';
      const disposition = res.headers['content-disposition'];
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=utf-8''(.+)/i);
        const plainMatch = disposition.match(/filename="?([^";\n]+)"?/i);
        if (utf8Match) downloadName = decodeURIComponent(utf8Match[1]);
        else if (plainMatch) downloadName = plainMatch[1];
      }
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      message.error(t('home.downloadFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  if (loading) {
    return (
      <div className="home-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip={t('common.loading')} />
      </div>
    );
  }

  return (
    <div className="home-page">
      {/* ===== 公告欄 ===== */}
      <div className="home-section announcement-section">
        <h2 className="section-title">
          <SoundOutlined style={{ marginRight: 8 }} />
          {t('home.announcementTitle')}
          <span className="section-subtitle">{t('home.announcementSubtitle')}</span>
        </h2>
        <div className="announcement-list">
          {announcements.slice(0, HOME_ANNOUNCEMENTS_LIMIT).map((item) => (
            <div
              key={item.id}
              className="announcement-item"
              onClick={() => setSelectedAnnouncement(item)}
            >
              <span className="announcement-dot">•</span>
              {item.isNew && <Tag color="red" className="announcement-new-tag">NEW</Tag>}
              <span className="announcement-date">{item.date}</span>
              <span className="announcement-subject">{item.subject}</span>
              {item.attachments?.length > 0 && (
                <PaperClipOutlined style={{ color: '#999', marginLeft: 4 }} />
              )}
            </div>
          ))}
          {announcements.length === 0 && (
            <div style={{ color: '#999', padding: '12px 0' }}>{t('home.noNewAnnouncements')}</div>
          )}
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <Button type="link" onClick={handleOpenAllAnnouncements} style={{ color: 'var(--primary-color)' }}>
              {t('home.viewAllAnnouncements')}
            </Button>
          </div>
        </div>
      </div>

      {/* ===== 公告彈出視窗 ===== */}
      <Modal
        title={selectedAnnouncement?.subject}
        open={!!selectedAnnouncement}
        onCancel={handleCloseAnnouncement}
        footer={[
          selectedAnnouncement?.attachments?.length > 0 && (
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
              onClick={() => {
                if (selectedAnnouncement.attachments.length === 1) {
                  handleDownloadAttachment(selectedAnnouncement, selectedAnnouncement.attachments[0].name);
                } else {
                  setDownloadModalOpen(true);
                }
              }}
            >
              {t('home.downloadFile')}
            </Button>
          ),
          <Button key="close" onClick={handleCloseAnnouncement}>
            {t('common.close')}
          </Button>,
        ]}
        width={640}
        centered
      >
        {selectedAnnouncement && (
          <div className="announcement-modal-content">
            <div className="announcement-modal-date">
              <CalendarOutlined style={{ marginRight: 6 }} />
              {selectedAnnouncement.date}
            </div>
            <p className="announcement-modal-text">
              {selectedAnnouncement.content}
            </p>

            {/* 附件區域 */}
            {selectedAnnouncement.attachments?.length > 0 ? (
              <div className="announcement-modal-attachment-area">
                {/* PDF 縮圖封面 */}
                {selectedAnnouncement.attachments.some((a) => isPdfFile(a.name)) ? (
                  <div className="announcement-cover">
                    {thumbnailLoading ? (
                      <div className="announcement-thumbnail-loading">
                        <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                        <span>{t('home.loadingPreview')}</span>
                      </div>
                    ) : thumbnailUrl ? (
                      <PdfThumbnail
                        url={thumbnailUrl}
                        width={200}
                        onClick={() => handleOpenPreviewModal(selectedAnnouncement)}
                        className="announcement-thumbnail"
                      />
                    ) : (
                      <div className="announcement-thumbnail-fallback">
                        <FilePdfOutlined style={{ fontSize: 48, color: '#e74c3c' }} />
                      </div>
                    )}
                    <div className="announcement-cover-info">
                      <span className="announcement-cover-filename">
                        {selectedAnnouncement.attachments[0]?.name}
                      </span>
                      {selectedAnnouncement.attachments.length > 1 && (
                        <Tag color="blue" style={{ marginTop: 4 }}>
                          {t('home.totalAttachments', { count: selectedAnnouncement.attachments.length })}
                        </Tag>
                      )}
                      <span
                        className="announcement-cover-hint"
                        onClick={() => handleOpenPreviewModal(selectedAnnouncement)}
                      >
                        <EyeOutlined style={{ marginRight: 4 }} />
                        {t('home.clickPreviewPdf')}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* 非 PDF 附件：顯示檔案圖示 */
                  <div className="announcement-cover" style={{ cursor: 'default' }}>
                    {React.cloneElement(
                      getFileIcon(selectedAnnouncement.attachments[0]?.name),
                      { style: { fontSize: 48 } }
                    )}
                    <div className="announcement-cover-info">
                      <span className="announcement-cover-filename">
                        {selectedAnnouncement.attachments[0]?.name}
                      </span>
                      {selectedAnnouncement.attachments.length > 1 && (
                        <Tag color="blue" style={{ marginTop: 4 }}>
                          {t('home.totalAttachments', { count: selectedAnnouncement.attachments.length })}
                        </Tag>
                      )}
                      <span className="announcement-cover-hint" style={{ color: '#999' }}>
                        {t('home.formatNotSupported')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="announcement-modal-attachment">
                <div style={{ color: '#999', padding: '12px 0' }}>
                  <PaperClipOutlined style={{ marginRight: 4 }} />
                  {t('home.noAttachment')}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ===== PDF 完整預覽 Modal（獨立大視窗） ===== */}
      <Modal
        title={
          <span>
            <FilePdfOutlined style={{ marginRight: 8, color: '#e74c3c' }} />
            {t('home.pdfPreview')}
            {previewFilename && <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 13, color: '#999' }}>{previewFilename}</span>}
          </span>
        }
        open={previewModalOpen}
        onCancel={handleClosePreviewModal}
        footer={null}
        width="90vw"
        centered
        style={{ maxHeight: 'calc(100vh - 40px)', paddingBottom: 0 }}
        styles={{ body: { padding: 0, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
        wrapClassName="no-scroll-modal"
      >
        {/* 多 PDF 檔案切換 */}
        {selectedAnnouncement?.attachments?.filter((a) => isPdfFile(a.name)).length > 1 && (
          <div className="preview-modal-tabs">
            {selectedAnnouncement.attachments.filter((a) => isPdfFile(a.name)).map((a, i) => (
              <Tag
                key={i}
                color={previewFilename === a.name ? 'blue' : 'default'}
                className="announcement-file-tag"
                onClick={() => loadFullPreview(selectedAnnouncement, a.name)}
                style={{ cursor: 'pointer' }}
              >
                {a.name}
              </Tag>
            ))}
          </div>
        )}
        {previewLoading ? (
          <div className="preview-modal-loading">
            <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
            <p>{t('home.loadingPdf')}</p>
          </div>
        ) : previewUrl ? (
          <iframe
            src={previewUrl}
            className="preview-modal-iframe"
            title="PDF Full Preview"
          />
        ) : (
          <div className="preview-modal-loading">
            <FilePdfOutlined style={{ fontSize: 48, color: '#e74c3c' }} />
            <p>{t('home.cannotLoadPdf')}</p>
          </div>
        )}
      </Modal>

      {/* ===== 公告下載檔案彈窗 ===== */}
      <Modal
        title={
          <span>
            <DownloadOutlined style={{ marginRight: 8 }} />
            {t('home.downloadAttachment')}
          </span>
        }
        open={downloadModalOpen}
        onCancel={() => setDownloadModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDownloadModalOpen(false)}>
            {t('common.close')}
          </Button>,
        ]}
        width={480}
        centered
      >
        <List
          dataSource={selectedAnnouncement?.attachments || []}
          renderItem={(item) => (
            <List.Item
              className="download-list-item"
              onClick={() => handleDownloadAttachment(selectedAnnouncement, item.name)}
              style={{ cursor: 'pointer', padding: '12px 16px', borderRadius: 6 }}
            >
              <List.Item.Meta
                avatar={React.cloneElement(getFileIcon(item.name), { style: { fontSize: 24 } })}
                title={item.name}
                description={item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(1)} MB` : ''}
              />
              <DownloadOutlined style={{ fontSize: 18, color: 'var(--primary-color)' }} />
            </List.Item>
          )}
        />
      </Modal>

      {/* ===== 全部公告 Modal ===== */}
      <Modal
        title={
          <span>
            <HistoryOutlined style={{ marginRight: 8 }} />
            {t('home.allAnnouncementsTitle')}
          </span>
        }
        open={allAnnouncementsModal}
        onCancel={() => setAllAnnouncementsModal(false)}
        footer={[
          <Button key="close" onClick={() => setAllAnnouncementsModal(false)}>
            {t('common.close')}
          </Button>,
        ]}
        width={700}
        centered
        styles={{ body: { overflow: 'hidden' } }}
        wrapClassName="no-scroll-modal"
      >
        <Input
          placeholder={t('home.searchAnnouncements')}
          prefix={<SearchOutlined />}
          value={announcementSearch}
          onChange={(e) => { setAnnouncementSearch(e.target.value); setAnnouncementPage(1); }}
          style={{ marginBottom: 16 }}
          allowClear
        />
        {allAnnouncementsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
          </div>
        ) : (() => {
          const filtered = allAnnouncements.filter((a) =>
            !announcementSearch ||
            a.subject?.toLowerCase().includes(announcementSearch.toLowerCase()) ||
            a.content?.toLowerCase().includes(announcementSearch.toLowerCase())
          );
          const startIdx = (announcementPage - 1) * ANNOUNCEMENTS_PER_PAGE;
          const paged = filtered.slice(startIdx, startIdx + ANNOUNCEMENTS_PER_PAGE);
          return (
            <>
              {filtered.length === 0 ? (
                <Empty description={t('common.noData')} />
              ) : (
                <List
                  dataSource={paged}
                  renderItem={(item) => (
                    <List.Item
                      className="all-announcement-item"
                      onClick={() => { setAllAnnouncementsModal(false); setSelectedAnnouncement(item); }}
                      style={{ cursor: 'pointer', padding: '8px 16px', borderRadius: 6 }}
                    >
                      <List.Item.Meta
                        title={
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {item.isNew && <Tag color="red" style={{ fontSize: 11 }}>NEW</Tag>}
                            <span>{item.subject}</span>
                          </span>
                        }
                        description={
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{item.date}</span>
                            {item.attachments?.length > 0 && (
                              <span><PaperClipOutlined /> {item.attachments.length}</span>
                            )}
                          </span>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
              {filtered.length > ANNOUNCEMENTS_PER_PAGE && (
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <Pagination
                    current={announcementPage}
                    total={filtered.length}
                    pageSize={ANNOUNCEMENTS_PER_PAGE}
                    onChange={setAnnouncementPage}
                    showSizeChanger={false}
                    size="small"
                  />
                </div>
              )}
            </>
          );
        })()}
      </Modal>

      {/* ===== Agent Store 預覽 ===== */}
      <div className="home-section agent-section">
        <h2 className="section-title">
          <RobotOutlined style={{ marginRight: 8 }} />
          Agent Store
        </h2>
        <div className="agent-preview-list">
          {agents.slice(0, 2).map((agent) => (
            <div key={agent.id} className="agent-preview-card">
              <div
                className="agent-preview-icon"
                style={{ background: agent.color + '20', color: agent.color }}
              >
                {agent.iconType === 'image_url' && agent.icon ? (
                  <img src={agent.icon} alt={agent.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                ) : (
                  agent.icon || '🤖'
                )}
              </div>
              <div className="agent-preview-info">
                <div className="agent-preview-name">{agent.name}</div>
                <div className="agent-preview-meta">
                  <span className="agent-model">{agent.model}</span>
                  <Tag color="green" style={{ marginLeft: 8 }}>{agent.status}</Tag>
                </div>
              </div>
              <Button
                type="primary"
                size="small"
                style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                onClick={() => navigate(`/agent-store/chat?agent=${agent.id}`)}
              >
                {t('common.chat')}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 線上圖書館預覽 ===== */}
      <div className="home-section library-section">
        <h2 className="section-title">
          <BookOutlined style={{ marginRight: 8 }} />
          {t('home.libraryTitle')}
          <span className="section-subtitle">{t('home.librarySubtitle')}</span>
        </h2>
        <div className="library-preview-grid">
          {latestDocs.map((doc) => (
            <div
              key={doc.id}
              className="library-preview-card"
              onClick={() => navigate(`/library?doc=${doc.id}`)}
            >
              <div className="library-preview-cover">
                {docThumbnails[doc.id] ? (
                  <PdfThumbnail
                    url={docThumbnails[doc.id]}
                    width={200}
                    className="library-card-thumbnail"
                  />
                ) : doc.files?.some((f) => f.filename?.toLowerCase().endsWith('.pdf')) ? (
                  <>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <span>{t('common.loading')}</span>
                  </>
                ) : (
                  <>
                    <FileOutlined style={{ fontSize: 36, color: '#bbb' }} />
                    <span>{t('home.noPreview')}</span>
                  </>
                )}
              </div>
              <div className="library-preview-name">{doc.name}</div>
              {doc.libraryName && (
                <div className="library-preview-lib-name">{doc.libraryName}</div>
              )}
            </div>
          ))}
          {latestDocs.length === 0 && (
            <div style={{ color: '#999', padding: '12px 0' }}>{t('home.noLibraryDocs')}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;
