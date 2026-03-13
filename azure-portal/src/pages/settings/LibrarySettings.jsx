import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Upload,
  Popconfirm,
  Tag,
  message,
  Space,
  Spin,
  Divider,
  Card,
  Tooltip,
  Image,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  UploadOutlined,
  DatabaseOutlined,
  SettingOutlined,
  GlobalOutlined,
  FolderAddOutlined,
  FolderOutlined,
  EditOutlined,
  PaperClipOutlined,
  CloudUploadOutlined,
  PictureOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { libraryAPI, piiAPI } from '../../services/api';
import { adaptLibraryDocs, adaptCatalogs } from '../../utils/adapters';
import { libraries as mockLibraries, userList } from '../../data/mockData';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import '../Settings.css';

const LibrarySettings = () => {
  const { effectiveCountry, countries, isSuperAdmin, displayCountry } = useCountry();
  const { t } = useLanguage();

  const [libraries, setLibraries] = useState([]);
  const [catalogs, setCatalogs] = useState([]); // 館名目錄（從 catalog API 取得）
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [permModal, setPermModal] = useState(null);
  const [permUsers, setPermUsers] = useState([]);
  const [form] = Form.useForm();

  // Modal 中的館名選項（根據 Modal 中選擇的目標國家動態載入）
  const [modalCatalogs, setModalCatalogs] = useState([]);
  const [modalLibLoading, setModalLibLoading] = useState(false);

  // 新增館名
  const [newLibraryName, setNewLibraryName] = useState('');

  // 編輯文件 Modal
  const [editModal, setEditModal] = useState(null); // null 或 doc 物件
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();
  const [editFileList, setEditFileList] = useState([]); // 追加上傳的檔案列表

  // 圖片上傳 Modal
  const [imageModal, setImageModal] = useState(null); // 當前要上傳圖片的 catalog
  const [imageFileList, setImageFileList] = useState([]);
  const [imagePreview, setImagePreview] = useState(null); // 預覽 URL (base64)
  const [imageUploading, setImageUploading] = useState(false);
  const [existingImageUrl, setExistingImageUrl] = useState(null); // 已有圖片的 blob URL

  // PII 預掃描
  const [piiScanning, setPiiScanning] = useState(false);

  // PII 預掃描：選擇檔案後自動檢查
  const handlePiiScan = async (newFileList, setListFn) => {
    if (!newFileList || newFileList.length === 0) return true;

    const supportedExts = ['.pdf', '.doc', '.docx', '.txt', '.csv'];
    const scannable = newFileList.filter((f) => {
      const name = (f.originFileObj?.name || f.name || '').toLowerCase();
      return supportedExts.some((ext) => name.endsWith(ext));
    });

    if (scannable.length === 0) return true;

    setPiiScanning(true);
    try {
      const formData = new FormData();
      scannable.forEach((f) => {
        const file = f.originFileObj || f;
        formData.append('file', file);
      });

      const res = await piiAPI.scanFiles(formData);
      const result = res.data;

      if (result.has_pii) {
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
        if (setListFn) setListFn([]);
        return false;
      }
      return true;
    } catch (err) {
      console.error('PII 預掃描失敗', err);
      return true; // 掃描失敗不阻擋（後端還有第二道防線）
    } finally {
      setPiiScanning(false);
    }
  };

  // 從後端載入圖書館資料（列表頁面用）— 同時載入 catalogs + 文件
  const fetchLibrary = async (country) => {
    setLoading(true);
    try {
      const [docsRes, catRes] = await Promise.all([
        libraryAPI.listAll(country),
        libraryAPI.listCatalogs(country).catch(() => ({ data: [] })),
      ]);
      let cats = adaptCatalogs(catRes.data);
      const libs = adaptLibraryDocs(docsRes.data, cats.length > 0 ? cats : undefined);
      // 若 catalog 表尚未建立或為空，從文件資料中提取館名作為 fallback
      if (cats.length === 0 && libs.length > 0) {
        cats = libs.map((lib) => ({
          catalogId: lib.id,
          name: lib.name,
          description: '',
          docCount: lib.documents.length,
          createdAt: null,
        }));
      }
      setCatalogs(cats);
      setLibraries(libs);
    } catch (err) {
      console.warn('圖書館 API 失敗，使用 mock 資料', err);
      setLibraries(mockLibraries);
      setCatalogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary(effectiveCountry);
  }, [effectiveCountry]);

  // 載入特定國家的館名列表（Modal 用）— 優先用 catalog API，fallback 到文件列表
  const fetchModalLibraries = useCallback(async (country) => {
    setModalLibLoading(true);
    try {
      const countryParam = isSuperAdmin ? country : undefined;
      const catRes = await libraryAPI.listCatalogs(countryParam);
      const cats = adaptCatalogs(catRes.data);
      if (cats.length > 0) {
        setModalCatalogs(cats);
      } else {
        // catalog 表為空時，從文件列表中提取館名作為 fallback
        const fallback = libraries.map((lib) => ({ catalogId: lib.id, name: lib.name, docCount: lib.documents.length }));
        setModalCatalogs(fallback.length > 0 ? fallback : catalogs);
      }
    } catch {
      // API 失敗時使用列表頁面的資料
      const fallback = libraries.map((lib) => ({ catalogId: lib.id, name: lib.name, docCount: lib.documents.length }));
      setModalCatalogs(fallback.length > 0 ? fallback : catalogs);
    } finally {
      setModalLibLoading(false);
    }
  }, [isSuperAdmin, catalogs, libraries]);

  // 扁平化所有文件
  const allDocs = libraries.flatMap((lib) =>
    lib.documents.map((doc) => ({ ...doc, libraryName: lib.name, libraryId: lib.id }))
  );

  // Modal 中的館名選項（從 catalog 取得）
  const modalLibraryOptions = modalCatalogs.map((cat) => ({ value: cat.name, label: cat.name }));

  const handleAddNewLibrary = async () => {
    const trimmed = newLibraryName.trim();
    if (!trimmed) return;
    // 檢查是否已存在
    if (modalCatalogs.some((cat) => cat.name === trimmed)) {
      message.warning(t('librarySettings.libraryExists'));
      return;
    }
    // 呼叫後端 API 建立 catalog
    try {
      const countryParam = isSuperAdmin ? form.getFieldValue('target_country') : undefined;
      await libraryAPI.createCatalog({ library_name: trimmed }, countryParam);
      // 加入到 modalCatalogs 選項中，並設定到表單
      setModalCatalogs((prev) => [...prev, { catalogId: `new-${Date.now()}`, name: trimmed, docCount: 0 }]);
      form.setFieldsValue({ libraryName: trimmed });
      setNewLibraryName('');
      message.success(t('librarySettings.libraryAdded', { name: trimmed }));
    } catch (err) {
      message.error(t('librarySettings.addLibraryFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  const handleOpenUpload = () => {
    form.resetFields();
    setNewLibraryName('');

    if (isSuperAdmin) {
      const targetCountry = displayCountry;
      form.setFieldsValue({ target_country: targetCountry });
      // 載入目標國家的館名
      fetchModalLibraries(targetCountry);
    } else {
      // 非 super_admin 載入自己國家的館名
      setModalCatalogs(catalogs);
    }
    setUploadModal(true);
  };

  // Modal 中目標國家變更時，重新載入館名
  const handleModalCountryChange = (value) => {
    form.setFieldsValue({ target_country: value, libraryName: undefined });
    fetchModalLibraries(value);
  };

  const handleUpload = async () => {
    try {
      const values = await form.validateFields();
      setUploadLoading(true);

      const formData = new FormData();
      // 支援多檔案上傳：迴圈 append 同名 "file"
      if (values.file && values.file.fileList && values.file.fileList.length > 0) {
        values.file.fileList.forEach((f) => {
          formData.append('file', f.originFileObj);
        });
      }

      const params = {
        library_name: values.libraryName,
        name: values.name,
        description: values.description || '',
      };
      if (isSuperAdmin && values.target_country) {
        params.country = values.target_country;
      }

      await libraryAPI.upload(formData, { params });

      const fileCount = values.file?.fileList?.length || 0;
      message.success(fileCount > 1 ? t('librarySettings.documentUploadedMultiple', { count: fileCount }) : t('librarySettings.documentUploaded'));
      setUploadModal(false);
      form.resetFields();
      fetchLibrary(effectiveCountry);
    } catch (err) {
      if (err.errorFields) return;
      message.error(t('librarySettings.uploadFailed') + '：' + (err.response?.data?.detail || err.message));
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDelete = async (docId) => {
    try {
      if (isSuperAdmin && effectiveCountry) {
        await libraryAPI.delete(docId, { params: { country: effectiveCountry } });
      } else {
        await libraryAPI.delete(docId);
      }
      message.success(t('librarySettings.documentDeleted'));
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.deleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 編輯文件 =====
  const handleOpenEdit = (doc) => {
    setEditModal(doc);
    setEditFileList([]);
    editForm.setFieldsValue({
      name: doc.name,
      description: doc.description,
      libraryName: doc.libraryName,
    });
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);

      const countryParam = isSuperAdmin ? effectiveCountry : undefined;

      // 更新文件資訊
      const updateData = {};
      if (values.name !== editModal.name) updateData.name = values.name;
      if (values.description !== editModal.description) updateData.description = values.description;
      if (values.libraryName !== editModal.libraryName) updateData.library_name = values.libraryName;

      if (Object.keys(updateData).length > 0) {
        await libraryAPI.update(editModal.id, updateData, countryParam);
      }

      // 追加上傳新檔案
      if (editFileList.length > 0) {
        const formData = new FormData();
        editFileList.forEach((f) => {
          const file = f.originFileObj || f;
          formData.append('file', file);
        });
        try {
          await libraryAPI.uploadFile(editModal.id, formData, countryParam);
          message.success(t('librarySettings.appendUploaded', { count: editFileList.length }));
        } catch (uploadErr) {
          console.error('追加上傳失敗', uploadErr);
          message.warning(t('librarySettings.appendUploadFailed') + '：' + (uploadErr.response?.data?.detail || uploadErr.message));
        }
      }

      message.success(t('librarySettings.documentUpdated'));
      setEditModal(null);
      setEditFileList([]);
      editForm.resetFields();
      fetchLibrary(effectiveCountry);
    } catch (err) {
      if (err.errorFields) return;
      message.error(t('librarySettings.updateFailed') + '：' + (err.response?.data?.detail || err.message));
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteFile = async (docId, filename) => {
    try {
      const countryParam = isSuperAdmin ? effectiveCountry : undefined;
      await libraryAPI.deleteFile(docId, filename, countryParam);
      message.success(t('librarySettings.attachmentDeleted', { name: filename }));
      // 更新 editModal 的附件列表
      setEditModal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          files: prev.files.filter((f) => f.filename !== filename),
        };
      });
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.attachmentDeleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  const openPermModal = (doc) => {
    setPermUsers([1, 2]);
    setPermModal(doc);
  };

  const handlePermSave = async () => {
    if (!permModal) return;
    try {
      const authData = {
        authorized_roles: [],
        authorized_users: permUsers,
        exception_list: [],
      };
      await libraryAPI.updateAuth(permModal.id, authData);
      message.success(t('librarySettings.permissionUpdated'));
      setPermModal(null);
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.updateFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 刪除館 =====
  const handleDeleteLibrary = async (libraryName) => {
    try {
      await libraryAPI.deleteLibrary(libraryName, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.libraryDeleted', { name: libraryName }));
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.deleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // ===== 圖片上傳 =====
  const handleOpenImageModal = async (cat) => {
    setImageModal(cat);
    setImageFileList([]);
    setImagePreview(null);
    setExistingImageUrl(null);

    // 如果已有圖片，載入預覽
    if (cat.imageUrl) {
      try {
        const countryParam = isSuperAdmin ? effectiveCountry : undefined;
        const res = await libraryAPI.getCatalogImage(cat.catalogId, countryParam);
        const url = URL.createObjectURL(res.data);
        setExistingImageUrl(url);
      } catch {
        // 圖片載入失敗，忽略
      }
    }
  };

  const handleCloseImageModal = () => {
    setImageModal(null);
    setImageFileList([]);
    setImagePreview(null);
    if (existingImageUrl) {
      URL.revokeObjectURL(existingImageUrl);
      setExistingImageUrl(null);
    }
  };

  const handleUploadImage = async () => {
    if (!imageModal || imageFileList.length === 0) return;
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', imageFileList[0].originFileObj);
      const countryParam = isSuperAdmin ? effectiveCountry : undefined;
      await libraryAPI.uploadCatalogImage(imageModal.catalogId, formData, countryParam);
      message.success(t('librarySettings.coverImageUploaded'));
      handleCloseImageModal();
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.coverImageUploadFailed') + '：' + (err.response?.data?.detail || err.message));
    } finally {
      setImageUploading(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!imageModal) return;
    try {
      const countryParam = isSuperAdmin ? effectiveCountry : undefined;
      await libraryAPI.deleteCatalogImage(imageModal.catalogId, countryParam);
      message.success(t('librarySettings.coverImageDeleted'));
      handleCloseImageModal();
      fetchLibrary(effectiveCountry);
    } catch (err) {
      message.error(t('librarySettings.coverImageDeleteFailed') + '：' + (err.response?.data?.detail || err.message));
    }
  };

  // 館名管理統計（從 catalogs 取得，確保空館也出現）
  const libraryStats = catalogs.map((cat) => ({
    catalogId: cat.catalogId,
    name: cat.name,
    imageUrl: cat.imageUrl || null,
    docCount: cat.docCount ?? 0,
  }));

  // 編輯 Modal 中的館名選項（從 catalogs 取得）
  const editLibraryOptions = catalogs.map((cat) => ({ value: cat.name, label: cat.name }));

  const columns = [
    {
      title: t('librarySettings.libraryName'),
      dataIndex: 'libraryName',
      key: 'libraryName',
      width: 160,
      render: (name) => <Tag color="blue">{name}</Tag>,
    },
    {
      title: t('librarySettings.documentName'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('common.files'),
      dataIndex: 'hasFile',
      key: 'hasFile',
      width: 120,
      render: (hasFile, record) => {
        const fileCount = record.files?.length || 0;
        if (hasFile) {
          return (
            <Tag color="green">
              {t('librarySettings.fileUploaded')}{fileCount > 1 ? ` (${fileCount})` : ''}
            </Tag>
          );
        }
        return <Tag color="default">{t('librarySettings.fileNotUploaded')}</Tag>;
      },
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 260,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleOpenEdit(record)}
            style={{ color: 'var(--primary-color)' }}
          >
            {t('common.edit')}
          </Button>
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={() => openPermModal(record)}
            style={{ color: 'var(--primary-color)' }}
          >
            {t('common.permissions')}
          </Button>
          <Popconfirm
            title={t('librarySettings.deleteDocument')}
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
          <DatabaseOutlined style={{ marginRight: 8 }} />
          {t('librarySettings.title')}
        </h2>
        <div className="settings-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleOpenUpload}
            style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
          >
            {t('librarySettings.uploadDocument')}
          </Button>
        </div>
      </div>

      <div className="settings-content">
        {/* 館名管理區塊 */}
        {libraryStats.length > 0 && (
          <Card
            size="small"
            title={
              <span>
                <FolderOutlined style={{ marginRight: 6 }} />
                {t('librarySettings.libraryManagement')}
              </span>
            }
            style={{ marginBottom: 20 }}
          >
            <Table
              size="small"
              dataSource={libraryStats}
              rowKey="name"
              pagination={false}
              columns={[
                {
                  title: t('librarySettings.libraryName'),
                  dataIndex: 'name',
                  key: 'name',
                  render: (name) => (
                    <span>
                      <FolderOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
                      {name}
                    </span>
                  ),
                },
                {
                  title: t('common.documents'),
                  dataIndex: 'docCount',
                  key: 'docCount',
                  width: 100,
                  render: (count) => (
                    <Tag color={count > 0 ? 'blue' : 'default'}>
                      {t('librarySettings.documentCount', { count })}
                    </Tag>
                  ),
                },
                {
                  title: t('librarySettings.coverImage'),
                  key: 'image',
                  width: 120,
                  render: (_, record) => (
                    <Button
                      type="text"
                      icon={<PictureOutlined />}
                      onClick={() => handleOpenImageModal(record)}
                      style={{ color: record.imageUrl ? 'var(--primary-color)' : '#999' }}
                      size="small"
                    >
                      {record.imageUrl ? t('librarySettings.changeImage') : t('librarySettings.uploadImage')}
                    </Button>
                  ),
                },
                {
                  title: t('common.actions'),
                  key: 'action',
                  width: 120,
                  render: (_, record) =>
                    record.docCount === 0 ? (
                      <Popconfirm
                        title={t('librarySettings.deleteLibraryConfirm', { name: record.name })}
                        onConfirm={() => handleDeleteLibrary(record.name)}
                        okText={t('librarySettings.confirmDelete')}
                        cancelText={t('common.cancel')}
                        okButtonProps={{ danger: true }}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} size="small">
                          {t('librarySettings.deleteLibraryBtn')}
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Tooltip title={t('librarySettings.deleteLibraryDisabledHint')}>
                        <Button type="text" icon={<DeleteOutlined />} size="small" disabled style={{ color: '#ccc' }}>
                          {t('librarySettings.deleteLibraryBtn')}
                        </Button>
                      </Tooltip>
                    ),
                },
              ]}
            />
          </Card>
        )}

        <Spin spinning={loading} tip={t('common.loading')}>
          <Table
            columns={columns}
            dataSource={allDocs}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: t('librarySettings.noDocuments') }}
          />
        </Spin>
      </div>

      {/* 上傳文件 Modal */}
      <Modal
        title={t('librarySettings.uploadDocument')}
        open={uploadModal}
        onCancel={() => {
          setUploadModal(false);
          form.resetFields();
          setNewLibraryName('');
        }}
        onOk={handleUpload}
        confirmLoading={uploadLoading}
        okText={t('common.upload')}
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
                onChange={handleModalCountryChange}
              />
            </Form.Item>
          )}
          <Form.Item
            name="libraryName"
            label={t('librarySettings.libraryName')}
            rules={[{ required: true, message: t('librarySettings.libraryNameRequired') }]}
          >
            <Select
              placeholder={modalLibLoading ? t('librarySettings.loadingLibraries') : t('librarySettings.libraryNamePlaceholder')}
              options={modalLibraryOptions}
              loading={modalLibLoading}
              showSearch
              allowClear
              notFoundContent={modalLibLoading ? <Spin size="small" /> : t('librarySettings.noLibraryForCountry')}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ display: 'flex', gap: 8, padding: '0 8px 8px' }}>
                    <Input
                      placeholder={t('librarySettings.newLibraryPlaceholder')}
                      value={newLibraryName}
                      onChange={(e) => setNewLibraryName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      style={{ flex: 1 }}
                    />
                    <Button
                      type="primary"
                      icon={<FolderAddOutlined />}
                      onClick={handleAddNewLibrary}
                      style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                    >
                      {t('librarySettings.addLibrary')}
                    </Button>
                  </div>
                </>
              )}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('librarySettings.documentName')}
            rules={[{ required: true, message: t('librarySettings.documentNameRequired') }]}
          >
            <Input placeholder={t('librarySettings.documentNamePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('librarySettings.descriptionLabel')}
            rules={[{ required: true, message: t('librarySettings.descriptionRequired') }]}
          >
            <Input.TextArea rows={3} placeholder={t('librarySettings.descriptionPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="file"
            label={t('librarySettings.uploadFile')}
            valuePropName="file"
            extra={piiScanning ? t('pii.scanningFiles') : t('librarySettings.uploadFileHint')}
            getValueFromEvent={(e) => {
              if (!e || !e.fileList) return e;
              const totalSize = e.fileList.reduce((sum, f) => sum + (f.originFileObj?.size || f.size || 0), 0);
              if (totalSize > 100 * 1024 * 1024) {
                message.error(t('librarySettings.fileSizeExceeded', { size: (totalSize / 1024 / 1024).toFixed(1) }));
                return { fileList: e.fileList.slice(0, -1) };
              }
              // 選擇檔案後自動做 PII 預掃描
              if (e.fileList.length > 0) {
                handlePiiScan(e.fileList, (cleared) => {
                  form.setFieldsValue({ file: { fileList: cleared } });
                });
              }
              return e;
            }}
          >
            <Upload
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"
              beforeUpload={() => false}
            >
              <Button icon={<UploadOutlined />} loading={piiScanning}>{piiScanning ? t('pii.scanningFiles') : t('common.selectFile')}</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* 編輯文件 Modal */}
      <Modal
        title={t('librarySettings.editDocument')}
        open={!!editModal}
        onCancel={() => {
          setEditModal(null);
          setEditFileList([]);
          editForm.resetFields();
        }}
        onOk={handleEditSave}
        confirmLoading={editLoading}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
        width={560}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="libraryName"
            label={t('librarySettings.libraryName')}
            rules={[{ required: true, message: t('librarySettings.libraryNameRequired') }]}
          >
            <Select
              placeholder={t('librarySettings.libraryNamePlaceholder')}
              options={editLibraryOptions}
              showSearch
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('librarySettings.documentName')}
            rules={[{ required: true, message: t('librarySettings.documentNameRequired') }]}
          >
            <Input placeholder={t('librarySettings.documentNamePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('librarySettings.descriptionLabel')}
          >
            <Input.TextArea rows={3} placeholder={t('librarySettings.descriptionPlaceholder')} />
          </Form.Item>

          {/* 已有附件列表 */}
          {editModal?.files?.length > 0 && (
            <Form.Item label={t('librarySettings.currentAttachments')}>
              {editModal.files.map((f) => (
                <div
                  key={f.filename}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    marginBottom: 4,
                    background: '#f5f5f5',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <PaperClipOutlined style={{ marginRight: 6, color: '#1890ff' }} />
                    {f.filename}
                    {f.file_size ? ` (${(f.file_size / 1024).toFixed(0)} KB)` : ''}
                  </span>
                  <Popconfirm
                    title={t('librarySettings.deleteAttachmentConfirm', { name: f.filename })}
                    onConfirm={() => handleDeleteFile(editModal.id, f.filename)}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                  </Popconfirm>
                </div>
              ))}
            </Form.Item>
          )}

          {/* 追加上傳新檔案 */}
          <Form.Item
            label={t('librarySettings.appendUpload')}
            extra={piiScanning ? t('pii.scanningFiles') : t('librarySettings.appendUploadHint')}
          >
            <Upload
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"
              fileList={editFileList}
              onChange={({ fileList: newFileList }) => {
                const totalSize = newFileList.reduce((sum, f) => sum + (f.originFileObj?.size || f.size || 0), 0);
                if (totalSize > 100 * 1024 * 1024) {
                  message.error(t('librarySettings.fileSizeExceeded', { size: (totalSize / 1024 / 1024).toFixed(1) }));
                  return;
                }
                setEditFileList(newFileList);
                // 選擇檔案後自動做 PII 預掃描
                if (newFileList.length > 0) {
                  handlePiiScan(newFileList, setEditFileList);
                }
              }}
              beforeUpload={() => false}
            >
              <Button icon={<CloudUploadOutlined />} loading={piiScanning}>{piiScanning ? t('pii.scanningFiles') : t('common.selectFile')}</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* 權限設定 Modal */}
      <Modal
        title={t('librarySettings.permissionTitle', { name: permModal?.name })}
        open={!!permModal}
        onCancel={() => setPermModal(null)}
        onOk={handlePermSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>
          {t('librarySettings.permissionHint')}
        </p>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder={t('librarySettings.selectUsers')}
          value={permUsers}
          onChange={setPermUsers}
          options={userList.map((u) => ({
            value: u.id,
            label: `${u.name} (${t(`departments.${u.department}`) || u.department})`,
          }))}
        />
      </Modal>

      {/* 封面圖片上傳 Modal */}
      <Modal
        title={
          <span>
            <PictureOutlined style={{ marginRight: 8 }} />
            {t('librarySettings.coverImageTitle', { name: imageModal?.name })}
          </span>
        }
        open={!!imageModal}
        onCancel={handleCloseImageModal}
        footer={[
          imageModal?.imageUrl && (
            <Popconfirm
              key="delete"
              title={t('librarySettings.deleteCoverImageConfirm')}
              onConfirm={handleDeleteImage}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t('librarySettings.deleteImage')}
              </Button>
            </Popconfirm>
          ),
          <Button key="cancel" onClick={handleCloseImageModal}>
            {t('common.cancel')}
          </Button>,
          <Button
            key="upload"
            type="primary"
            onClick={handleUploadImage}
            loading={imageUploading}
            disabled={imageFileList.length === 0}
            style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
          >
            {t('common.upload')}
          </Button>,
        ]}
        width={520}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>
          {t('librarySettings.coverImageHint')}
        </p>

        {/* 已有圖片預覽 */}
        {existingImageUrl && !imagePreview && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <p style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>
              {t('librarySettings.currentCoverImage')}
            </p>
            <img
              src={existingImageUrl}
              alt="current cover"
              style={{
                maxWidth: '100%',
                maxHeight: 200,
                borderRadius: 8,
                border: '1px solid #d9d9d9',
                objectFit: 'contain',
              }}
            />
          </div>
        )}

        <Upload.Dragger
          accept=".png,.jpg,.jpeg"
          maxCount={1}
          fileList={imageFileList}
          beforeUpload={(file) => {
            // 檢查檔案大小
            if (file.size > 5 * 1024 * 1024) {
              message.error(t('librarySettings.imageSizeExceeded'));
              return Upload.LIST_IGNORE;
            }
            // 產生預覽
            const reader = new FileReader();
            reader.onload = (e) => setImagePreview(e.target.result);
            reader.readAsDataURL(file);
            return false; // 阻止自動上傳
          }}
          onChange={({ fileList }) => {
            setImageFileList(fileList.slice(-1)); // 只保留最後一個
            if (fileList.length === 0) setImagePreview(null);
          }}
          onRemove={() => {
            setImagePreview(null);
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t('librarySettings.dragImageHint')}</p>
          <p className="ant-upload-hint">{t('librarySettings.imageFormatHint')}</p>
        </Upload.Dragger>

        {/* 新圖片預覽 */}
        {imagePreview && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>
              {t('librarySettings.imagePreview')}
            </p>
            <img
              src={imagePreview}
              alt="preview"
              style={{
                maxWidth: '100%',
                maxHeight: 200,
                borderRadius: 8,
                border: '1px solid #d9d9d9',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LibrarySettings;
