import React, { useState, useEffect, useCallback, memo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal, Button, Pagination, Empty, Spin, message, Tag, List } from 'antd';
import {
  BookOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileTextOutlined,
  DownloadOutlined,
  EyeOutlined,
  LeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileOutlined,
  LoadingOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { libraryAPI } from '../services/api';
import { adaptLibraryDocs, adaptCatalogs } from '../utils/adapters';
import { libraries as mockLibraries } from '../data/mockData';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import PdfThumbnail from '../components/PdfThumbnail';
import './Library.css';

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

const DOCS_PER_PAGE = 5;

/** 館封面圖片元件（需要 auth 的圖片載入） */
const LibraryCoverImage = memo(({ catalogId, country }) => {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    setLoading(true);

    libraryAPI.getCatalogImage(catalogId, country)
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [catalogId, country]);

  if (loading) {
    return (
      <div className="library-card-image-placeholder">
        <Spin size="small" />
      </div>
    );
  }

  if (!src) {
    return (
      <div className="library-card-image-placeholder">
        <PictureOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
      </div>
    );
  }

  return <img src={src} alt="library cover" />;
});

LibraryCoverImage.displayName = 'LibraryCoverImage';

const Library = () => {
  const { effectiveCountry } = useCountry();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLibrary, setSelectedLibrary] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [pageMap, setPageMap] = useState({});

  // PDF 縮圖用的 blob URL
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  // 完整預覽 Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFilename, setPreviewFilename] = useState(null);
  // 下載檔案彈窗
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  // 用 ref 追蹤最新的 blob URL，避免 stale closure 問題
  const thumbnailUrlRef = React.useRef(null);
  const previewUrlRef = React.useRef(null);

  const fetchLibrary = async (country) => {
    setLoading(true);
    try {
      const [docsRes, catRes] = await Promise.all([
        libraryAPI.list(country),
        libraryAPI.listCatalogs(country).catch(() => ({ data: [] })),
      ]);
      const cats = adaptCatalogs(catRes.data);
      const libs = adaptLibraryDocs(docsRes.data, cats.length > 0 ? cats : undefined);
      setLibraries(libs);
      return libs;
    } catch (err) {
      console.warn('圖書館 API 失敗，使用 mock 資料', err);
      setLibraries(mockLibraries);
      return mockLibraries;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedLibrary(null);
    fetchLibrary(effectiveCountry).then((libs) => {
      // 從 URL 參數自動打開文件（從 Home 頁面點擊圖書館卡片跳轉）
      const urlDocId = searchParams.get('doc');
      if (urlDocId && libs?.length > 0) {
        for (const lib of libs) {
          const doc = lib.documents?.find((d) => String(d.id) === urlDocId);
          if (doc) {
            setSelectedLibrary(lib);
            setSelectedDoc(doc);
            break;
          }
        }
        // 清除 URL 參數（避免重新整理時重複觸發）
        setSearchParams({}, { replace: true });
      }
    });
  }, [effectiveCountry]);

  const getPage = (libId) => pageMap[libId] || 1;
  const setPage = (libId, page) => setPageMap((prev) => ({ ...prev, [libId]: page }));

  // 載入 PDF blob URL（用於縮圖，不記錄稽核日誌）
  const loadThumbnail = useCallback(async (doc) => {
    // 使用 ref 取得最新 URL，避免 stale closure
    if (thumbnailUrlRef.current) {
      URL.revokeObjectURL(thumbnailUrlRef.current);
      thumbnailUrlRef.current = null;
      setThumbnailUrl(null);
    }

    if (!doc?.hasFile) return;

    // 找到第一個 PDF 檔案
    const firstPdf = doc.files?.find((f) => isPdfFile(f.filename));
    if (!firstPdf) return;

    setThumbnailLoading(true);
    try {
      // record=false：縮圖載入不計入預覽統計
      const res = await libraryAPI.preview(doc.id, effectiveCountry, firstPdf.filename, false);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      thumbnailUrlRef.current = url;
      setThumbnailUrl(url);
    } catch (err) {
      console.error('PDF 縮圖載入失敗:', err);
      thumbnailUrlRef.current = null;
      setThumbnailUrl(null);
    } finally {
      setThumbnailLoading(false);
    }
  }, [effectiveCountry]);

  // 載入完整預覽（開新 Modal 時用），record=true 記錄稽核日誌
  const loadFullPreview = useCallback(async (doc, filename) => {
    // 使用 ref 取得最新 URL，避免 stale closure
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }

    if (!doc?.hasFile) return;

    const targetFilename = filename || doc.files?.find((f) => isPdfFile(f.filename))?.filename;
    if (!targetFilename || !isPdfFile(targetFilename)) return;

    setPreviewFilename(targetFilename);
    setPreviewLoading(true);
    try {
      // record=true（預設）：記錄預覽稽核日誌
      const res = await libraryAPI.preview(doc.id, effectiveCountry, targetFilename, true);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      console.error('PDF 完整預覽載入失敗:', err);
      message.error(t('libraryPage.pdfPreviewFailed'));
      previewUrlRef.current = null;
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [effectiveCountry, t]);

  // 選擇文件時自動載入縮圖
  useEffect(() => {
    if (selectedDoc?.hasFile) {
      loadThumbnail(selectedDoc);
    }
    return () => {
      if (thumbnailUrlRef.current) {
        URL.revokeObjectURL(thumbnailUrlRef.current);
        thumbnailUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc?.id]);

  // 點擊縮圖 → 開新的預覽 Modal
  const handleOpenPreviewModal = (doc, filename) => {
    setPreviewModalOpen(true);
    loadFullPreview(doc, filename);
  };

  // 關閉預覽 Modal
  const handleClosePreviewModal = () => {
    setPreviewModalOpen(false);
    setPreviewFilename(null);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
  };

  // 關閉文件 Modal 時清理
  const handleCloseModal = () => {
    setSelectedDoc(null);
    setDownloadModalOpen(false);
    handleClosePreviewModal();
    if (thumbnailUrlRef.current) {
      URL.revokeObjectURL(thumbnailUrlRef.current);
      thumbnailUrlRef.current = null;
      setThumbnailUrl(null);
    }
  };

  // 記錄文件點擊（開啟 Modal 時呼叫）
  const handleDocClick = (doc) => {
    setSelectedDoc(doc);
    // 背景記錄點擊，不阻塞 UI
    libraryAPI.recordView(doc.id, effectiveCountry).catch(() => {});
  };

  // 下載檔案
  const handleDownload = async (doc, filename) => {
    if (!doc) return;
    try {
      const res = await libraryAPI.download(doc.id, effectiveCountry, filename);
      // 從 content-disposition header 取得原始檔名
      let downloadName = filename || doc.name || 'download';
      const disposition = res.headers['content-disposition'];
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=utf-8''(.+)/i);
        const plainMatch = disposition.match(/filename="?([^";\n]+)"?/i);
        if (utf8Match) {
          downloadName = decodeURIComponent(utf8Match[1]);
        } else if (plainMatch) {
          downloadName = plainMatch[1];
        }
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
      message.error(t('libraryPage.downloadFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  if (loading) {
    return (
      <div className="library-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" tip={t('libraryPage.loadingLibrary')} />
      </div>
    );
  }

  return (
    <div className="library-page">
      <div className="library-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {selectedLibrary && (
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={() => setSelectedLibrary(null)}
              style={{ marginRight: 8 }}
            >
              {t('common.back')}
            </Button>
          )}
          <h2 className="page-title" style={{ margin: 0 }}>
            <BookOutlined style={{ marginRight: 8 }} />
            {t('libraryPage.title')}
            <span className="section-subtitle">{t('libraryPage.subtitle')}</span>
          </h2>
        </div>
      </div>

      {!selectedLibrary ? (
        /* ===== 館名卡片概覽 ===== */
        <div className="library-grid">
          {libraries.length === 0 && (
            <Empty description={t('libraryPage.noLibraryForCountry')} style={{ gridColumn: '1 / -1', padding: '40px 0' }} />
          )}
          {libraries.map((lib) => {
            const currentPage = getPage(lib.id);
            const startIdx = (currentPage - 1) * DOCS_PER_PAGE;
            const pagedDocs = lib.documents.slice(startIdx, startIdx + DOCS_PER_PAGE);

            return (
              <div key={lib.id} className="library-card">
                {/* 卡片上半部 - 封面圖片 */}
                <div
                  className="library-card-image"
                  onClick={() => setSelectedLibrary(lib)}
                >
                  {lib.imageUrl ? (
                    <LibraryCoverImage catalogId={lib.id} country={effectiveCountry} />
                  ) : (
                    <div className="library-card-image-placeholder">
                      <PictureOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                    </div>
                  )}
                </div>
                {/* 館名 header（換頁不動） */}
                <div
                  className="library-card-header"
                  onClick={() => setSelectedLibrary(lib)}
                >
                  <BookOutlined style={{ marginRight: 8, color: 'var(--primary-color)' }} />
                  <span className="library-card-name">{lib.name}</span>
                  <span className="library-card-count">({t('libraryPage.documentsCount', { count: lib.documents.length })})</span>
                </div>
                <div className="library-card-docs">
                  {pagedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="library-card-doc-item"
                      onClick={() => handleDocClick(doc)}
                    >
                      {getFileIcon(doc.files?.[0]?.filename || doc.name)}
                      <span style={{ marginRight: 8 }} />
                      <span>{doc.name}</span>
                      {doc.files?.length > 1 && (
                        <Tag size="small" style={{ marginLeft: 6, fontSize: 11 }}>
                          {t('libraryPage.filesCount', { count: doc.files.length })}
                        </Tag>
                      )}
                    </div>
                  ))}
                </div>
                <div className="library-card-pagination">
                  {lib.documents.length > DOCS_PER_PAGE && (
                    <Pagination
                      size="small"
                      current={currentPage}
                      total={lib.documents.length}
                      pageSize={DOCS_PER_PAGE}
                      onChange={(page) => setPage(lib.id, page)}
                      showSizeChanger={false}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ===== 展開館名 - 卡片式文件 ===== */
        <div className="library-expanded">
          <h3 className="library-expanded-title">{selectedLibrary.name}</h3>
          <div className="library-doc-grid">
            {selectedLibrary.documents.map((doc) => (
              <div
                key={doc.id}
                className="library-doc-card"
                onClick={() => handleDocClick(doc)}
              >
                <div className="library-doc-card-icon">
                  {React.cloneElement(getFileIcon(doc.files?.[0]?.filename || doc.name), { style: { fontSize: 36 } })}
                </div>
                <div className="library-doc-card-name">{doc.name}</div>
                <div className="library-doc-card-desc">{doc.description}</div>
                {doc.files?.length > 1 && (
                  <div className="library-doc-card-badge">
                    <Tag size="small" color="blue">{t('libraryPage.multipleFiles', { count: doc.files.length })}</Tag>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== 文件資訊 Modal ===== */}
      <Modal
        title={
          <span>
            {selectedDoc && getFileIcon(selectedDoc.files?.[0]?.filename || selectedDoc.name)}
            <span style={{ marginLeft: 8 }}>{selectedDoc?.name}</span>
          </span>
        }
        open={!!selectedDoc}
        onCancel={handleCloseModal}
        footer={[
          selectedDoc?.hasFile && (
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
              onClick={() => {
                if (selectedDoc.files?.length === 1) {
                  handleDownload(selectedDoc, selectedDoc.files[0].filename);
                } else if (selectedDoc.files?.length > 1) {
                  setDownloadModalOpen(true);
                } else {
                  handleDownload(selectedDoc);
                }
              }}
            >
              {t('home.downloadFile')}
            </Button>
          ),
          <Button key="close" onClick={handleCloseModal}>
            {t('common.close')}
          </Button>,
        ]}
        width={680}
        centered
      >
        {selectedDoc && (
          <div className="pdf-preview-area">
            {/* 文件資訊 */}
            <div className="pdf-preview-info">
              <p><strong>{t('libraryPage.description')}：</strong>{selectedDoc.description}</p>
              <p>
                <strong>{t('libraryPage.fileStatus')}：</strong>
                {selectedDoc.hasFile ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    {t('libraryPage.uploaded')}{selectedDoc.files?.length > 1 ? ` (${selectedDoc.files.length} ${t('common.files')})` : ''}
                  </Tag>
                ) : (
                  <Tag icon={<CloseCircleOutlined />} color="default">{t('libraryPage.notUploaded')}</Tag>
                )}
              </p>
            </div>

            {/* 附件區域 — 縮圖封面 */}
            {selectedDoc.hasFile ? (
              <div className="pdf-cover">
                {selectedDoc.files?.some((f) => isPdfFile(f.filename)) ? (
                  /* PDF 縮圖 */
                  <>
                    {thumbnailLoading ? (
                      <div className="pdf-thumbnail-loading-box">
                        <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                        <span>{t('home.loadingPreview')}</span>
                      </div>
                    ) : thumbnailUrl ? (
                      <PdfThumbnail
                        url={thumbnailUrl}
                        width={200}
                        onClick={() => handleOpenPreviewModal(selectedDoc)}
                        className="pdf-thumbnail"
                      />
                    ) : (
                      <div className="pdf-thumbnail-fallback">
                        <FilePdfOutlined style={{ fontSize: 48, color: '#e74c3c' }} />
                      </div>
                    )}
                    <div className="pdf-cover-info">
                      <span className="pdf-cover-filename">
                        {selectedDoc.files?.[0]?.filename || selectedDoc.name}
                      </span>
                      {selectedDoc.files?.length > 1 && (
                        <Tag color="blue" style={{ marginTop: 4 }}>
                          {t('libraryPage.multipleFiles', { count: selectedDoc.files.length })}
                        </Tag>
                      )}
                      <span
                        className="pdf-cover-hint"
                        onClick={() => handleOpenPreviewModal(selectedDoc)}
                      >
                        <EyeOutlined style={{ marginRight: 4 }} />
                        {t('home.clickPreviewPdf')}
                      </span>
                    </div>
                  </>
                ) : (
                  /* 非 PDF 檔案 */
                  <>
                    {React.cloneElement(
                      getFileIcon(selectedDoc.files?.[0]?.filename || selectedDoc.name),
                      { style: { fontSize: 48 } }
                    )}
                    <div className="pdf-cover-info">
                      <span className="pdf-cover-filename">
                        {selectedDoc.files?.[0]?.filename || selectedDoc.name}
                      </span>
                      {selectedDoc.files?.length > 1 && (
                        <Tag color="blue" style={{ marginTop: 4 }}>
                          {t('libraryPage.multipleFiles', { count: selectedDoc.files.length })}
                        </Tag>
                      )}
                      <span className="pdf-cover-hint" style={{ color: '#999' }}>
                        {t('home.formatNotSupported')}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="pdf-cover" style={{ cursor: 'default' }}>
                <EyeOutlined style={{ fontSize: 48, color: '#ccc' }} />
                <div className="pdf-cover-info">
                  <span className="pdf-cover-filename" style={{ color: '#999' }}>{t('libraryPage.noFileUploaded')}</span>
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
        {selectedDoc?.files?.filter((f) => isPdfFile(f.filename)).length > 1 && (
          <div className="preview-modal-tabs">
            {selectedDoc.files.filter((f) => isPdfFile(f.filename)).map((f, i) => (
              <Tag
                key={i}
                color={previewFilename === f.filename ? 'blue' : 'default'}
                className="pdf-file-tag"
                onClick={() => loadFullPreview(selectedDoc, f.filename)}
                style={{ cursor: 'pointer' }}
              >
                {f.filename}
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

      {/* ===== 下載檔案彈窗 ===== */}
      <Modal
        title={
          <span>
            <DownloadOutlined style={{ marginRight: 8 }} />
            {t('home.downloadFile')}
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
          dataSource={selectedDoc?.files || []}
          renderItem={(item) => (
            <List.Item
              className="download-list-item"
              onClick={() => handleDownload(selectedDoc, item.filename)}
              style={{ cursor: 'pointer', padding: '12px 16px', borderRadius: 6 }}
            >
              <List.Item.Meta
                avatar={React.cloneElement(getFileIcon(item.filename), { style: { fontSize: 24 } })}
                title={item.filename}
                description={item.file_size ? `${(item.file_size / 1024 / 1024).toFixed(1)} MB` : ''}
              />
              <DownloadOutlined style={{ fontSize: 18, color: 'var(--primary-color)' }} />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default Library;
