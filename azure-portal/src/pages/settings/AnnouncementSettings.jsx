import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  Upload,
  Select,
  Tag,
  Popconfirm,
  message,
  Space,
  Spin,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  NotificationOutlined,
  SearchOutlined,
  GlobalOutlined,
  PaperClipOutlined,
  BookOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { announcementAPI, libraryAPI, piiAPI } from '../../services/api';
import { adaptAnnouncements, adaptLibraryDocsFlat, adaptCatalogs, toAnnouncementCreate, toAnnouncementUpdate } from '../../utils/adapters';
import { announcements as mockAnnouncements } from '../../data/mockData';
import { useAuth } from '../../contexts/AuthContext';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import '../Settings.css';

const { TextArea } = Input;

const AnnouncementSettings = () => {
  const { user } = useAuth();
  const { effectiveCountry, countries, isSuperAdmin, displayCountry } = useCountry();
  const { t } = useLanguage();

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [fileList, setFileList] = useState([]);
  const [piiScanning, setPiiScanning] = useState(false);
  const [piiPassed, setPiiPassed] = useState(true); // true = 通過或未掃描
  const [form] = Form.useForm();

  // 圖書館文件選擇相關（先選館→再選文件）
  const [libCatalogs, setLibCatalogs] = useState([]); // 館名列表
  const [libCatalogsLoading, setLibCatalogsLoading] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState(null); // 選中的館名
  const [libraryDocs, setLibraryDocs] = useState([]); // 該館下的文件列表
  const [libraryDocsLoading, setLibraryDocsLoading] = useState(false);
  const [allLibraryDocs, setAllLibraryDocs] = useState([]); // 所有文件（用於回顯已選）

  // PII 預掃描：選擇檔案後自動檢查
  const handlePiiScan = async (newFileList) => {
    if (!newFileList || newFileList.length === 0) {
      setPiiPassed(true);
      return;
    }

    // 只掃描支援的格式
    const supportedExts = ['.pdf', '.doc', '.docx', '.txt', '.csv'];
    const scannable = newFileList.filter((f) => {
      const name = (f.originFileObj?.name || f.name || '').toLowerCase();
      return supportedExts.some((ext) => name.endsWith(ext));
    });

    if (scannable.length === 0) {
      setPiiPassed(true);
      return;
    }

    setPiiScanning(true);
    setPiiPassed(false);
    try {
      const formData = new FormData();
      scannable.forEach((f) => {
        const file = f.originFileObj || f;
        formData.append('file', file);
      });

      const res = await piiAPI.scanFiles(formData);
      const result = res.data;

      if (result.has_pii) {
        // 偵測到 PII → 彈出提示視窗
        const piiFiles = (result.files || []).filter((f) => f.has_pii);
        const details = piiFiles.map((pf) =>
          t('pii.entityFile', {
            filename: pf.filename,
            count: pf.entity_count,
            types: pf.entity_types.join(', '),
          })
        );

        Modal.warning({
          title: t('pii.detectedTitle'),
          content: (
            <div>
              <p>{t('pii.detectedMessage')}</p>
              <p style={{ marginTop: 12, fontWeight: 500 }}>{t('pii.detectedDetail')}</p>
              <ul style={{ paddingLeft: 20 }}>
                {details.map((d, i) => (
                  <li key={i} style={{ color: '#cf1322', marginBottom: 4 }}>{d}</li>
                ))}
              </ul>
            </div>
          ),
          okText: t('pii.understood'),
          width: 520,
        });

        // 清除檔案列表
        setFileList([]);
        setPiiPassed(false);
      } else {
        setPiiPassed(true);
      }
    } catch (err) {
      console.error('PII 預掃描失敗', err);
      // 掃描失敗不阻擋上傳（後端還有第二道防線）
      setPiiPassed(true);
    } finally {
      setPiiScanning(false);
    }
  };

  const fetchAnnouncements = async (country) => {
    setLoading(true);
    try {
      const res = await announcementAPI.listAll(country);
      setData(adaptAnnouncements(res.data));
    } catch (err) {
      console.warn('公告 API 失敗，使用 mock 資料', err);
      setData(mockAnnouncements);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements(effectiveCountry);
  }, [effectiveCountry]);

  // 載入館名列表 + 所有文件（供選擇器使用），回傳所有文件供 handleEdit 使用
  const fetchLibraryCatalogs = useCallback(async (country) => {
    setLibCatalogsLoading(true);
    setLibraryDocsLoading(true);
    try {
      const [catRes, docsRes] = await Promise.all([
        libraryAPI.listCatalogs(country).catch(() => ({ data: [] })),
        libraryAPI.listAll(country).catch(() => ({ data: [] })),
      ]);
      const cats = adaptCatalogs(catRes.data);
      const docs = adaptLibraryDocsFlat(docsRes.data);
      setLibCatalogs(cats);
      setAllLibraryDocs(docs);
      // 預設不選館，文件列表為空
      setLibraryDocs([]);
      setSelectedCatalog(null);
      return docs; // 回傳供 handleEdit 使用
    } catch (err) {
      console.warn('載入圖書館資料失敗', err);
      setLibCatalogs([]);
      setAllLibraryDocs([]);
      setLibraryDocs([]);
      return [];
    } finally {
      setLibCatalogsLoading(false);
      setLibraryDocsLoading(false);
    }
  }, []);

  // 選擇館名後，篩選該館下的文件
  const handleCatalogChange = useCallback((catalogName, clearSelection = true) => {
    setSelectedCatalog(catalogName);
    if (!catalogName) {
      setLibraryDocs([]);
      if (clearSelection) form.setFieldsValue({ library_docs: [] });
      return;
    }
    const filtered = allLibraryDocs.filter((doc) => doc.libraryName === catalogName);
    setLibraryDocs(filtered);
    // 換館時清除已選的文件（編輯回填時不清除）
    if (clearSelection) {
      form.setFieldsValue({ library_docs: [] });
    }
  }, [allLibraryDocs, form]);

  const handleAdd = () => {
    setEditingItem(null);
    setFileList([]);
    setSelectedCatalog(null);
    setLibraryDocs([]);
    form.resetFields();
    form.setFieldsValue({
      publish_status: 'published',
      library_docs: [],
      // super_admin 預設選中當前顯示的國家
      ...(isSuperAdmin ? { target_country: displayCountry } : {}),
    });
    // 載入圖書館館名 + 文件
    fetchLibraryCatalogs(effectiveCountry);
    setModalOpen(true);
  };

  const handleEdit = (record) => {
    setEditingItem(record);
    setFileList([]);
    // 還原已選的圖書館文件 ID
    const existingDocIds = (record.libraryDocs || []).map((d) => d.docId);
    form.setFieldsValue({
      subject: record.subject,
      content: record.content,
      publish_status: record.publish_status || 'draft',
      library_docs: existingDocIds,
      // 編輯時使用當前顯示的國家
      ...(isSuperAdmin ? { target_country: displayCountry } : {}),
    });
    // 載入圖書館館名 + 文件，載入完成後自動推斷已選的館並篩選文件
    fetchLibraryCatalogs(effectiveCountry).then((loadedDocs) => {
      if (record.libraryDocs?.length > 0) {
        const firstLib = record.libraryDocs[0].libraryName;
        if (firstLib) {
          setSelectedCatalog(firstLib);
          // 手動篩選該館的文件（不清除已選）
          const filtered = (loadedDocs || []).filter((doc) => doc.libraryName === firstLib);
          setLibraryDocs(filtered);
        }
      }
    });
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    try {
      await announcementAPI.delete(id, effectiveCountry);
      message.success(t('announcementSettings.deleted'));
      fetchAnnouncements(effectiveCountry);
    } catch (err) {
      console.error('刪除公告失敗', err);
      message.error(t('announcementSettings.deleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();

      // 將選中的圖書館文件 ID 轉換為完整的 libraryDocs 物件（從 allLibraryDocs 查找）
      const selectedDocIds = values.library_docs || [];
      const libraryDocsData = selectedDocIds.map((docId) => {
        const doc = allLibraryDocs.find((d) => d.id === docId);
        return doc ? { docId: doc.id, name: doc.name, libraryName: doc.libraryName } : null;
      }).filter(Boolean);

      const adapterData = {
        subject: values.subject,
        content: values.content,
        publishStatus: values.publish_status,
        libraryDocs: libraryDocsData,
      };

      // super_admin 使用表單中選擇的目標國家
      const countryParam = isSuperAdmin ? values.target_country : undefined;

      let noticeId;
      if (editingItem) {
        await announcementAPI.update(editingItem.id, toAnnouncementUpdate(adapterData), countryParam);
        noticeId = editingItem.id;
        message.success(t('announcementSettings.updated'));
      } else {
        const res = await announcementAPI.create(toAnnouncementCreate(adapterData), countryParam);
        noticeId = res.data?.detail;
        message.success(t('announcementSettings.created'));
      }

      // 如果有選擇檔案，上傳附件（支援多檔）
      if (fileList.length > 0 && noticeId) {
        const formData = new FormData();
        fileList.forEach((f) => {
          const file = f.originFileObj || f;
          formData.append('file', file);
        });
        try {
          await announcementAPI.uploadFile(noticeId, formData, countryParam);
          message.success(t('announcementSettings.uploadedCount', { count: fileList.length }));
        } catch (uploadErr) {
          console.error('上傳附件失敗', uploadErr);
          // PII 被擋（422）或其他上傳失敗：如果是新增模式，回滾刪除剛建立的公告
          if (!editingItem && noticeId) {
            try {
              await announcementAPI.delete(noticeId, countryParam);
              console.log('已回滾刪除公告', noticeId);
            } catch (delErr) {
              console.error('回滾刪除公告失敗', delErr);
            }
          }
          message.error(t('announcementSettings.uploadFailed') + '：' + (uploadErr.response?.data?.detail || uploadErr.message));
          // 不關閉 Modal，讓使用者可以修改後重試
          fetchAnnouncements(effectiveCountry);
          return;
        }
      }

      setModalOpen(false);
      setFileList([]);
      form.resetFields();
      fetchAnnouncements(effectiveCountry);
    } catch (err) {
      if (err.errorFields) return;
      console.error('儲存公告失敗', err);
      message.error(t('announcementSettings.saveFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  const filteredData = data.filter(
    (item) =>
      !searchText ||
      item.subject.includes(searchText) ||
      item.content.includes(searchText)
  );

  const columns = [
    {
      title: t('announcementSettings.date'),
      dataIndex: 'date',
      key: 'date',
      width: 120,
    },
    {
      title: t('announcementSettings.subject'),
      dataIndex: 'subject',
      key: 'subject',
    },
    {
      title: t('common.status'),
      dataIndex: 'publish_status',
      key: 'publish_status',
      width: 100,
      render: (status) =>
        status === 'published' ? (
          <Tag color="green">{t('common.published')}</Tag>
        ) : (
          <Tag>{t('common.draft')}</Tag>
        ),
    },
    {
      title: t('announcementSettings.attachment'),
      dataIndex: 'attachments',
      key: 'attachments',
      width: 120,
      render: (attachments) => {
        if (!attachments || attachments.length === 0) return '-';
        return (
          <Tag color="blue">
            {attachments.length > 1 ? t('announcementSettings.attachmentsCount', { count: attachments.length }) : t('announcementSettings.hasAttachment')}
          </Tag>
        );
      },
    },
    {
      title: t('announcementSettings.libraryDocsLabel'),
      dataIndex: 'libraryDocs',
      key: 'libraryDocs',
      width: 140,
      render: (docs) => {
        if (!docs || docs.length === 0) return '-';
        return (
          <Tag color="purple" icon={<BookOutlined />}>
            {t('announcementSettings.libraryDocsCount', { count: docs.length })}
          </Tag>
        );
      },
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            style={{ color: 'var(--primary-color)' }}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('announcementSettings.deleteConfirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button type="text" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <NotificationOutlined style={{ marginRight: 8 }} />
          {t('announcementSettings.title')}
        </h2>
        <div className="settings-actions">
          <Input
            placeholder={t('announcementSettings.searchPlaceholder')}
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
          >
            {t('announcementSettings.addAnnouncement')}
          </Button>
        </div>
      </div>

      <div className="settings-content">
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: t('announcementSettings.noAnnouncements') }}
        />
      </div>

      <Modal
        title={editingItem ? t('announcementSettings.editAnnouncement') : t('announcementSettings.addAnnouncement')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        <Form form={form} layout="vertical">
          {/* super_admin 選擇目標國家 */}
          {isSuperAdmin && (
            <Form.Item
              name="target_country"
              label={
                <span>
                  <GlobalOutlined style={{ marginRight: 4 }} />
                  {t('announcementSettings.targetCountry')}
                </span>
              }
              rules={[{ required: true, message: t('announcementSettings.targetCountryRequired') }]}
            >
              <Select
                placeholder={t('announcementSettings.targetCountryPlaceholder')}
                options={countries.map((c) => ({ value: c.code, label: `${t(`countries.${c.code}`) || c.name} (${c.code})` }))}
              />
            </Form.Item>
          )}
          <Form.Item
            name="subject"
            label={t('announcementSettings.subject')}
            rules={[{ required: true, message: t('announcementSettings.subjectRequired') }]}
          >
            <Input placeholder={t('announcementSettings.subjectPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="content"
            label={t('announcementSettings.content')}
            rules={[{ required: true, message: t('announcementSettings.contentRequired') }]}
          >
            <TextArea rows={4} placeholder={t('announcementSettings.contentPlaceholder')} maxLength={300} showCount />
          </Form.Item>
          <Form.Item name="publish_status" label={t('announcementSettings.publishStatus')} initialValue="published">
            <Select>
              <Select.Option value="published">{t('common.published')}</Select.Option>
              <Select.Option value="draft">{t('common.draft')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('announcementSettings.attachmentLabel')} extra={piiScanning ? t('pii.scanningFiles') : t('announcementSettings.attachmentHint')}>
            <Upload
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"
              fileList={fileList}
              onChange={({ fileList: newFileList }) => {
                const totalSize = newFileList.reduce((sum, f) => sum + (f.originFileObj?.size || f.size || 0), 0);
                if (totalSize > 100 * 1024 * 1024) {
                  message.error(t('announcementSettings.fileSizeExceeded', { size: (totalSize / 1024 / 1024).toFixed(1) }));
                  return;
                }
                setFileList(newFileList);
                // 選擇檔案後自動做 PII 預掃描
                if (newFileList.length > 0) {
                  handlePiiScan(newFileList);
                } else {
                  setPiiPassed(true);
                }
              }}
              beforeUpload={() => false}
            >
              <Button icon={<UploadOutlined />} loading={piiScanning}>{piiScanning ? t('pii.scanningFiles') : t('common.selectFile')}</Button>
            </Upload>
            {editingItem?.attachments?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 4, color: '#666', fontSize: 12 }}>
                  <PaperClipOutlined style={{ marginRight: 4 }} />
                  {t('announcementSettings.currentAttachments')}：
                </div>
                {editingItem.attachments.map((a) => (
                  <div
                    key={a.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      marginBottom: 4,
                      background: '#f5f5f5',
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <PaperClipOutlined style={{ marginRight: 4, color: '#1890ff' }} />
                      {a.name}
                      {a.fileSize ? ` (${(a.fileSize / 1024).toFixed(0)} KB)` : ''}
                    </span>
                    <Popconfirm
                      title={t('announcementSettings.deleteAttachmentConfirm', { name: a.name })}
                      onConfirm={async () => {
                        try {
                          const countryParam = isSuperAdmin ? displayCountry : undefined;
                          await announcementAPI.deleteFile(editingItem.id, a.name, countryParam);
                          message.success(t('announcementSettings.attachmentDeleted', { name: a.name }));
                          // 重新載入公告列表
                          await fetchAnnouncements(effectiveCountry);
                          // 更新 editingItem 的附件列表
                          setEditingItem((prev) => ({
                            ...prev,
                            attachments: prev.attachments.filter((att) => att.name !== a.name),
                          }));
                        } catch (err) {
                          message.error(t('announcementSettings.attachmentDeleteFailed') + '：' + (err.response?.data?.detail || err.message));
                        }
                      }}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
          </Form.Item>
          {/* 圖書館資料選擇器：先選館→再選文件 */}
          <Divider style={{ margin: '16px 0 8px' }}>
            <span style={{ fontSize: 13, color: '#722ed1' }}>
              <BookOutlined style={{ marginRight: 4 }} />
              {t('announcementSettings.libraryDocsLabel')}
            </span>
          </Divider>
          <Form.Item
            label={
              <span>
                <FolderOutlined style={{ marginRight: 4 }} />
                {t('announcementSettings.selectCatalogLabel')}
              </span>
            }
            extra={t('announcementSettings.selectCatalogHint')}
          >
            <Select
              placeholder={libCatalogsLoading ? t('announcementSettings.libraryDocsLoading') : t('announcementSettings.selectCatalogPlaceholder')}
              loading={libCatalogsLoading}
              value={selectedCatalog}
              onChange={(val) => handleCatalogChange(val)}
              allowClear
              showSearch
              optionFilterProp="label"
              notFoundContent={libCatalogsLoading ? <Spin size="small" /> : t('announcementSettings.noCatalogs')}
              options={libCatalogs.map((cat) => ({
                value: cat.name,
                label: `${cat.name}（${cat.docCount || 0} ${t('announcementSettings.docsUnit')}）`,
              }))}
              optionRender={(option) => {
                const cat = libCatalogs.find((c) => c.name === option.value);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FolderOutlined style={{ color: '#722ed1', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{cat?.name || option.label}</div>
                      <div style={{ fontSize: 12, color: '#999' }}>
                        {cat?.docCount || 0} {t('announcementSettings.docsUnit')}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
          </Form.Item>
          <Form.Item
            name="library_docs"
            label={
              <span>
                <BookOutlined style={{ marginRight: 4 }} />
                {t('announcementSettings.selectDocsLabel')}
              </span>
            }
            extra={t('announcementSettings.libraryDocsHint')}
          >
            <Select
              mode="multiple"
              placeholder={
                !selectedCatalog
                  ? t('announcementSettings.selectCatalogFirst')
                  : libraryDocsLoading
                    ? t('announcementSettings.libraryDocsLoading')
                    : t('announcementSettings.libraryDocsPlaceholder')
              }
              disabled={!selectedCatalog}
              loading={libraryDocsLoading}
              showSearch
              allowClear
              optionFilterProp="label"
              notFoundContent={
                libraryDocsLoading ? <Spin size="small" /> : t('announcementSettings.libraryDocsEmpty')
              }
              options={libraryDocs.map((doc) => ({
                value: doc.id,
                label: doc.name,
              }))}
              optionRender={(option) => {
                const doc = libraryDocs.find((d) => d.id === option.value);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BookOutlined style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc?.name || option.label}
                      </div>
                      {doc?.description && (
                        <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AnnouncementSettings;
