import React, { useState, useEffect, useCallback, memo } from 'react';
import { Table, Button, Modal, Form, Input, Select, Upload, Popconfirm, Tag, message, Space, Spin, Divider, Tooltip, Segmented, Dropdown, Empty } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, DatabaseOutlined, UserOutlined, GlobalOutlined, FolderAddOutlined, FolderOutlined, EditOutlined, PaperClipOutlined, CloudUploadOutlined, PictureOutlined, InboxOutlined, FileTextOutlined, SearchOutlined, MoreOutlined } from '@ant-design/icons';
import { libraryAPI, piiAPI } from '../../services/api';
import { adaptLibraryDocs, adaptCatalogs } from '../../utils/adapters';
import { libraries as mockLibraries, userList } from '../../data/mockData';
import { useCountry } from '../../contexts/CountryContext';
import { useLanguage } from '../../contexts/LanguageContext';
import '../Settings.css';

const CatalogCoverImage = memo(({ catalogId, country }) => {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let url = null, cancelled = false;
    setLoading(true);
    libraryAPI.getCatalogImage(catalogId, country)
      .then((res) => { if (!cancelled) { url = URL.createObjectURL(res.data); setSrc(url); } })
      .catch(() => { if (!cancelled) setSrc(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [catalogId, country]);
  if (loading) return <div className="catalog-card-img-placeholder"><Spin size="small" /></div>;
  if (!src) return <div className="catalog-card-img-placeholder"><PictureOutlined style={{ fontSize: 36, color: '#d9d9d9' }} /></div>;
  return <img src={src} alt="cover" className="catalog-card-img" />;
});
CatalogCoverImage.displayName = 'CatalogCoverImage';

const LibrarySettings = () => {
  const { effectiveCountry, countries, isSuperAdmin, displayCountry } = useCountry();
  const { t } = useLanguage();
  const [libraries, setLibraries] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [permModal, setPermModal] = useState(null);
  const [permUsers, setPermUsers] = useState([]);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('catalogs');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [docFilterLibrary, setDocFilterLibrary] = useState(null);
  const [addCatalogModal, setAddCatalogModal] = useState(false);
  const [addCatalogName, setAddCatalogName] = useState('');
  const [addCatalogLoading, setAddCatalogLoading] = useState(false);
  const [modalCatalogs, setModalCatalogs] = useState([]);
  const [modalLibLoading, setModalLibLoading] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();
  const [editFileList, setEditFileList] = useState([]);
  const [imageModal, setImageModal] = useState(null);
  const [imageFileList, setImageFileList] = useState([]);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [existingImageUrl, setExistingImageUrl] = useState(null);
  const [piiScanning, setPiiScanning] = useState(false);

  const handlePiiScan = async (newFileList, setListFn) => {
    if (!newFileList || newFileList.length === 0) return true;
    const exts = ['.pdf', '.doc', '.docx', '.txt', '.csv'];
    const scannable = newFileList.filter((f) => exts.some((ext) => (f.originFileObj?.name || f.name || '').toLowerCase().endsWith(ext)));
    if (scannable.length === 0) return true;
    setPiiScanning(true);
    try {
      const fd = new FormData();
      scannable.forEach((f) => fd.append('file', f.originFileObj || f));
      const res = await piiAPI.scanFiles(fd);
      if (res.data.has_pii) {
        const piiFiles = (res.data.files || []).filter((f) => f.has_pii);
        Modal.warning({
          title: t('pii.detectedTitle'),
          content: (
            <div>
              <p>{t('pii.detectedMessage')}</p>
              <ul style={{ paddingLeft: 20 }}>
                {piiFiles.map((pf, i) => (
                  <li key={i} style={{ color: '#cf1322' }}>
                    {t('pii.entityFile', { filename: pf.filename, count: pf.entity_count, types: pf.entity_types.join(', ') })}
                  </li>
                ))}
              </ul>
            </div>
          ),
          okText: t('pii.understood'),
          width: 520,
        });
        if (setListFn) setListFn([]);
        return false;
      }
      return true;
    } catch { return true; } finally { setPiiScanning(false); }
  };

  const fetchLibrary = async (country) => {
    setLoading(true);
    try {
      const [docsRes, catRes] = await Promise.all([
        libraryAPI.listAll(country),
        libraryAPI.listCatalogs(country).catch(() => ({ data: [] })),
      ]);
      let cats = adaptCatalogs(catRes.data);
      const libs = adaptLibraryDocs(docsRes.data, cats.length > 0 ? cats : undefined);
      if (cats.length === 0 && libs.length > 0) {
        cats = libs.map((lib) => ({ catalogId: lib.id, name: lib.name, description: '', docCount: lib.documents.length, createdAt: null }));
      }
      setCatalogs(cats);
      setLibraries(libs);
    } catch (err) {
      console.warn('API fail', err);
      setLibraries(mockLibraries);
      setCatalogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLibrary(effectiveCountry); }, [effectiveCountry]);

  const fetchModalLibraries = useCallback(async (country) => {
    setModalLibLoading(true);
    try {
      const cats = adaptCatalogs((await libraryAPI.listCatalogs(isSuperAdmin ? country : undefined)).data);
      if (cats.length > 0) setModalCatalogs(cats);
      else {
        const fb = libraries.map((l) => ({ catalogId: l.id, name: l.name, docCount: l.documents.length }));
        setModalCatalogs(fb.length > 0 ? fb : catalogs);
      }
    } catch {
      const fb = libraries.map((l) => ({ catalogId: l.id, name: l.name, docCount: l.documents.length }));
      setModalCatalogs(fb.length > 0 ? fb : catalogs);
    } finally { setModalLibLoading(false); }
  }, [isSuperAdmin, catalogs, libraries]);

  const allDocs = libraries.flatMap((lib) => lib.documents.map((doc) => ({ ...doc, libraryName: lib.name, libraryId: lib.id })));

  const filteredDocs = allDocs.filter((d) => {
    if (docFilterLibrary && d.libraryName !== docFilterLibrary) return false;
    if (!docSearch.trim()) return true;
    const kw = docSearch.toLowerCase();
    return d.name?.toLowerCase().includes(kw) || d.description?.toLowerCase().includes(kw) || d.libraryName?.toLowerCase().includes(kw);
  });

  const filteredCatalogs = catalogs.filter((c) => !catalogSearch.trim() || c.name?.toLowerCase().includes(catalogSearch.toLowerCase()));
  const libraryStats = catalogs.map((c) => ({ catalogId: c.catalogId, name: c.name, imageUrl: c.imageUrl || null, docCount: c.docCount ?? 0 }));

  const handleAddCatalog = async () => {
    const n = addCatalogName.trim();
    if (!n) return;
    if (catalogs.some((c) => c.name === n)) { message.warning(t('librarySettings.libraryExists')); return; }
    setAddCatalogLoading(true);
    try {
      await libraryAPI.createCatalog({ library_name: n }, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.libraryAdded', { name: n }));
      setAddCatalogModal(false);
      setAddCatalogName('');
      fetchLibrary(effectiveCountry);
    } catch (e) {
      message.error(t('librarySettings.addLibraryFailed') + ': ' + (e.response?.data?.detail || e.message));
    } finally { setAddCatalogLoading(false); }
  };

  const handleAddNewLibrary = async () => {
    const n = newLibraryName.trim();
    if (!n) return;
    if (modalCatalogs.some((c) => c.name === n)) { message.warning(t('librarySettings.libraryExists')); return; }
    try {
      await libraryAPI.createCatalog({ library_name: n }, isSuperAdmin ? form.getFieldValue('target_country') : undefined);
      setModalCatalogs((p) => [...p, { catalogId: 'new-' + Date.now(), name: n, docCount: 0 }]);
      form.setFieldsValue({ libraryName: n });
      setNewLibraryName('');
      message.success(t('librarySettings.libraryAdded', { name: n }));
    } catch (e) {
      message.error(t('librarySettings.addLibraryFailed') + ': ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleOpenUpload = () => {
    form.resetFields();
    setNewLibraryName('');
    if (isSuperAdmin) {
      form.setFieldsValue({ target_country: displayCountry });
      fetchModalLibraries(displayCountry);
    } else {
      setModalCatalogs(catalogs);
    }
    setUploadModal(true);
  };

  const handleModalCountryChange = (v) => {
    form.setFieldsValue({ target_country: v, libraryName: undefined });
    fetchModalLibraries(v);
  };

  const handleUpload = async () => {
    try {
      const v = await form.validateFields();
      setUploadLoading(true);
      const fd = new FormData();
      if (v.file?.fileList?.length > 0) v.file.fileList.forEach((f) => fd.append('file', f.originFileObj));
      const p = { library_name: v.libraryName, name: v.name, description: v.description || '' };
      if (isSuperAdmin && v.target_country) p.country = v.target_country;
      await libraryAPI.upload(fd, { params: p });
      const fc = v.file?.fileList?.length || 0;
      message.success(fc > 1 ? t('librarySettings.documentUploadedMultiple', { count: fc }) : t('librarySettings.documentUploaded'));
      setUploadModal(false);
      form.resetFields();
      fetchLibrary(effectiveCountry);
    } catch (e) {
      if (e.errorFields) return;
      message.error(t('librarySettings.uploadFailed') + ': ' + (e.response?.data?.detail || e.message));
    } finally { setUploadLoading(false); }
  };

  const handleDelete = async (id) => {
    try {
      if (isSuperAdmin && effectiveCountry) await libraryAPI.delete(id, { params: { country: effectiveCountry } });
      else await libraryAPI.delete(id);
      message.success(t('librarySettings.documentDeleted'));
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.deleteFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  const handleOpenEdit = (doc) => {
    setEditModal(doc);
    setEditFileList([]);
    editForm.setFieldsValue({ name: doc.name, description: doc.description, libraryName: doc.libraryName });
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    try {
      const v = await editForm.validateFields();
      setEditLoading(true);
      const cp = isSuperAdmin ? effectiveCountry : undefined;
      const ud = {};
      if (v.name !== editModal.name) ud.name = v.name;
      if (v.description !== editModal.description) ud.description = v.description;
      if (v.libraryName !== editModal.libraryName) ud.library_name = v.libraryName;
      if (Object.keys(ud).length > 0) await libraryAPI.update(editModal.id, ud, cp);
      if (editFileList.length > 0) {
        const fd = new FormData();
        editFileList.forEach((f) => fd.append('file', f.originFileObj || f));
        try {
          await libraryAPI.uploadFile(editModal.id, fd, cp);
          message.success(t('librarySettings.appendUploaded', { count: editFileList.length }));
        } catch (ue) {
          message.warning(t('librarySettings.appendUploadFailed') + ': ' + (ue.response?.data?.detail || ue.message));
        }
      }
      message.success(t('librarySettings.documentUpdated'));
      setEditModal(null);
      setEditFileList([]);
      editForm.resetFields();
      fetchLibrary(effectiveCountry);
    } catch (e) {
      if (e.errorFields) return;
      message.error(t('librarySettings.updateFailed') + ': ' + (e.response?.data?.detail || e.message));
    } finally { setEditLoading(false); }
  };

  const handleDeleteFile = async (docId, fn) => {
    try {
      await libraryAPI.deleteFile(docId, fn, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.attachmentDeleted', { name: fn }));
      setEditModal((p) => p ? { ...p, files: p.files.filter((f) => f.filename !== fn) } : p);
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.attachmentDeleteFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  const openPermModal = (doc) => { setPermUsers([1, 2]); setPermModal(doc); };

  const handlePermSave = async () => {
    if (!permModal) return;
    try {
      await libraryAPI.updateAuth(permModal.id, { authorized_roles: [], authorized_users: permUsers, exception_list: [] });
      message.success(t('librarySettings.permissionUpdated'));
      setPermModal(null);
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.updateFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  const handleDeleteLibrary = async (name) => {
    try {
      await libraryAPI.deleteLibrary(name, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.libraryDeleted', { name }));
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.deleteFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  const handleOpenImageModal = async (cat) => {
    setImageModal(cat); setImageFileList([]); setImagePreview(null); setExistingImageUrl(null);
    if (cat.imageUrl) {
      try {
        const r = await libraryAPI.getCatalogImage(cat.catalogId, isSuperAdmin ? effectiveCountry : undefined);
        setExistingImageUrl(URL.createObjectURL(r.data));
      } catch { /* ignore */ }
    }
  };

  const handleCloseImageModal = () => {
    setImageModal(null); setImageFileList([]); setImagePreview(null);
    if (existingImageUrl) { URL.revokeObjectURL(existingImageUrl); setExistingImageUrl(null); }
  };

  const handleUploadImage = async () => {
    if (!imageModal || imageFileList.length === 0) return;
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', imageFileList[0].originFileObj);
      await libraryAPI.uploadCatalogImage(imageModal.catalogId, fd, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.coverImageUploaded'));
      handleCloseImageModal();
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.coverImageUploadFailed') + ': ' + (e.response?.data?.detail || e.message)); }
    finally { setImageUploading(false); }
  };

  const handleDeleteImage = async () => {
    if (!imageModal) return;
    try {
      await libraryAPI.deleteCatalogImage(imageModal.catalogId, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.coverImageDeleted'));
      handleCloseImageModal();
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.coverImageDeleteFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  const editLibraryOptions = catalogs.map((c) => ({ value: c.name, label: c.name }));
  const modalLibraryOptions = modalCatalogs.map((c) => ({ value: c.name, label: c.name }));

  const columns = [
    {
      title: t('librarySettings.libraryName'), dataIndex: 'libraryName', key: 'libraryName', width: 160,
      render: (name) => (
        <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => setDocFilterLibrary(name)}>
          <FolderOutlined style={{ marginRight: 4 }} />{name}
        </Tag>
      ),
    },
    { title: t('librarySettings.documentName'), dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: t('common.files'), dataIndex: 'hasFile', key: 'hasFile', width: 120,
      render: (hasFile, r) => {
        const fc = r.files?.length || 0;
        return hasFile
          ? <Tag color="green">{t('librarySettings.fileUploaded')}{fc > 1 ? ' (' + fc + ')' : ''}</Tag>
          : <Tag color="default">{t('librarySettings.fileNotUploaded')}</Tag>;
      },
    },
    {
      title: t('common.actions'), key: 'actions', width: 80,
      render: (_, r) => (
        <Dropdown
          menu={{
            items: [
              { key: 'edit', icon: <EditOutlined />, label: t('common.edit'), onClick: () => handleOpenEdit(r) },
              { key: 'perm', icon: <UserOutlined />, label: t('common.permissions'), onClick: () => openPermModal(r) },
              { type: 'divider' },
              {
                key: 'del', icon: <DeleteOutlined />, label: t('common.delete'), danger: true,
                onClick: () => Modal.confirm({
                  title: t('librarySettings.deleteDocument'),
                  onOk: () => handleDelete(r.id),
                  okText: t('common.confirm'),
                  cancelText: t('common.cancel'),
                  okButtonProps: { danger: true },
                }),
              },
            ],
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button type="text" icon={<MoreOutlined />} style={{ fontSize: 18 }} />
        </Dropdown>
      ),
    },
  ];

  const fileUploadValueHandler = (e) => {
    if (!e || !e.fileList) return e;
    const totalSize = e.fileList.reduce((sum, f) => sum + (f.originFileObj?.size || f.size || 0), 0);
    if (totalSize > 100 * 1024 * 1024) {
      message.error(t('librarySettings.fileSizeExceeded', { size: (totalSize / 1024 / 1024).toFixed(1) }));
      return { fileList: e.fileList.slice(0, -1) };
    }
    if (e.fileList.length > 0) {
      handlePiiScan(e.fileList, (cleared) => { form.setFieldsValue({ file: { fileList: cleared } }); });
    }
    return e;
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="page-title">
          <DatabaseOutlined style={{ marginRight: 8 }} />
          {t('librarySettings.title')}
        </h2>
      </div>

      <div className="lib-tab-bar">
        <Segmented
          value={activeTab}
          onChange={setActiveTab}
          options={[
            {
              value: 'catalogs',
              label: (
                <span className="lib-tab-label">
                  <FolderOutlined style={{ marginRight: 6 }} />
                  {t('librarySettings.libraryManagement')}
                  <Tag className="lib-tab-count" color={activeTab === 'catalogs' ? 'blue' : 'default'}>{catalogs.length}</Tag>
                </span>
              ),
            },
            {
              value: 'documents',
              label: (
                <span className="lib-tab-label">
                  <FileTextOutlined style={{ marginRight: 6 }} />
                  {t('librarySettings.documentManagement')}
                  <Tag className="lib-tab-count" color={activeTab === 'documents' ? 'blue' : 'default'}>{allDocs.length}</Tag>
                </span>
              ),
            },
          ]}
          size="large"
          block
        />
      </div>

      <div className="lib-tab-content">
        <Spin spinning={loading} tip={t('common.loading')}>
          {activeTab === 'catalogs' ? (
            <div className="catalog-view">
              <div className="lib-toolbar">
                <Input
                  placeholder={t('librarySettings.searchLibraryPlaceholder')}
                  prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  allowClear
                  className="lib-toolbar-search"
                />
                <Button
                  type="primary"
                  icon={<FolderAddOutlined />}
                  onClick={() => setAddCatalogModal(true)}
                  style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                >
                  {t('librarySettings.addNewLibrary')}
                </Button>
              </div>

              {filteredCatalogs.length === 0 ? (
                <Empty description={catalogSearch ? t('common.noData') : t('librarySettings.noCatalogs')} style={{ padding: '60px 0' }} />
              ) : (
                <div className="catalog-grid">
                  {filteredCatalogs.map((cat) => {
                    const stat = libraryStats.find((s) => s.name === cat.name) || cat;
                    return (
                      <div key={cat.catalogId || cat.name} className="catalog-card">
                        <div className="catalog-card-image-area">
                          {stat.imageUrl ? (
                            <CatalogCoverImage catalogId={cat.catalogId} country={effectiveCountry} />
                          ) : (
                            <div className="catalog-card-img-placeholder">
                              <PictureOutlined style={{ fontSize: 36, color: '#d9d9d9' }} />
                            </div>
                          )}
                        </div>
                        <div className="catalog-card-body">
                          <div className="catalog-card-name">
                            <FolderOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
                            {cat.name}
                          </div>
                          <div className="catalog-card-stat">
                            <Tag color={stat.docCount > 0 ? 'blue' : 'default'}>
                              {t('librarySettings.documentCount', { count: stat.docCount })}
                            </Tag>
                          </div>
                        </div>
                        <div className="catalog-card-actions">
                          <Button
                            type="text"
                            icon={<PictureOutlined />}
                            onClick={() => handleOpenImageModal(stat)}
                            size="small"
                            style={{ color: stat.imageUrl ? 'var(--primary-color)' : '#999' }}
                          >
                            {stat.imageUrl ? t('librarySettings.changeImage') : t('librarySettings.uploadImage')}
                          </Button>
                          {stat.docCount === 0 ? (
                            <Popconfirm
                              title={t('librarySettings.deleteLibraryConfirm', { name: cat.name })}
                              onConfirm={() => handleDeleteLibrary(cat.name)}
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
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="document-view">
              <div className="lib-toolbar">
                <div className="lib-toolbar-filters">
                  <Select
                    placeholder={t('librarySettings.filterByLibrary')}
                    value={docFilterLibrary}
                    onChange={setDocFilterLibrary}
                    allowClear
                    style={{ minWidth: 180 }}
                    options={catalogs.map((c) => ({ value: c.name, label: c.name }))}
                  />
                  <Input
                    placeholder={t('librarySettings.searchDocPlaceholder')}
                    prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    allowClear
                    className="lib-toolbar-search"
                  />
                </div>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={handleOpenUpload}
                  style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                >
                  {t('librarySettings.uploadDocument')}
                </Button>
              </div>

              {docFilterLibrary && (
                <div className="lib-filter-tag">
                  <span>{t('librarySettings.filteringBy')}</span>
                  <Tag closable onClose={() => setDocFilterLibrary(null)} color="blue">
                    <FolderOutlined style={{ marginRight: 4 }} />{docFilterLibrary}
                  </Tag>
                </div>
              )}

              <Table
                columns={columns}
                dataSource={filteredDocs}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: t('librarySettings.noDocuments') }}
              />
            </div>
          )}
        </Spin>
      </div>

      {/* Add Catalog Modal */}
      <Modal
        title={<span><FolderAddOutlined style={{ marginRight: 8 }} />{t('librarySettings.addNewLibrary')}</span>}
        open={addCatalogModal}
        onCancel={() => { setAddCatalogModal(false); setAddCatalogName(''); }}
        onOk={handleAddCatalog}
        confirmLoading={addCatalogLoading}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }, disabled: !addCatalogName.trim() }}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>{t('librarySettings.addNewLibraryHint')}</p>
        <Input
          placeholder={t('librarySettings.newLibraryPlaceholder')}
          value={addCatalogName}
          onChange={(e) => setAddCatalogName(e.target.value)}
          onPressEnter={handleAddCatalog}
          prefix={<FolderOutlined style={{ color: '#bbb' }} />}
          size="large"
        />
      </Modal>

      {/* Upload Document Modal */}
      <Modal
        title={t('librarySettings.uploadDocument')}
        open={uploadModal}
        onCancel={() => { setUploadModal(false); form.resetFields(); setNewLibraryName(''); }}
        onOk={handleUpload}
        confirmLoading={uploadLoading}
        okText={t('common.upload')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        <Form form={form} layout="vertical">
          {isSuperAdmin && (
            <Form.Item
              name="target_country"
              label={<span><GlobalOutlined style={{ marginRight: 4 }} />{t('announcementSettings.targetCountry')}</span>}
              rules={[{ required: true, message: t('announcementSettings.targetCountryRequired') }]}
            >
              <Select
                placeholder={t('announcementSettings.targetCountryPlaceholder')}
                options={countries.map((c) => ({ value: c.code, label: (t('countries.' + c.code) || c.name) + ' (' + c.code + ')' }))}
                onChange={handleModalCountryChange}
              />
            </Form.Item>
          )}
          <Form.Item name="libraryName" label={t('librarySettings.libraryName')} rules={[{ required: true, message: t('librarySettings.libraryNameRequired') }]}>
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
          <Form.Item name="name" label={t('librarySettings.documentName')} rules={[{ required: true, message: t('librarySettings.documentNameRequired') }]}>
            <Input placeholder={t('librarySettings.documentNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('librarySettings.descriptionLabel')} rules={[{ required: true, message: t('librarySettings.descriptionRequired') }]}>
            <Input.TextArea rows={3} placeholder={t('librarySettings.descriptionPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="file"
            label={t('librarySettings.uploadFile')}
            valuePropName="file"
            extra={piiScanning ? t('pii.scanningFiles') : t('librarySettings.uploadFileHint')}
            getValueFromEvent={fileUploadValueHandler}
          >
            <Upload
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"
              beforeUpload={() => false}
            >
              <Button icon={<UploadOutlined />} loading={piiScanning}>
                {piiScanning ? t('pii.scanningFiles') : t('common.selectFile')}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Document Modal */}
      <Modal
        title={t('librarySettings.editDocument')}
        open={!!editModal}
        onCancel={() => { setEditModal(null); setEditFileList([]); editForm.resetFields(); }}
        onOk={handleEditSave}
        confirmLoading={editLoading}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
        width={560}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="libraryName" label={t('librarySettings.libraryName')} rules={[{ required: true, message: t('librarySettings.libraryNameRequired') }]}>
            <Select placeholder={t('librarySettings.libraryNamePlaceholder')} options={editLibraryOptions} showSearch />
          </Form.Item>
          <Form.Item name="name" label={t('librarySettings.documentName')} rules={[{ required: true, message: t('librarySettings.documentNameRequired') }]}>
            <Input placeholder={t('librarySettings.documentNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('librarySettings.descriptionLabel')}>
            <Input.TextArea rows={3} placeholder={t('librarySettings.descriptionPlaceholder')} />
          </Form.Item>

          {editModal?.files?.length > 0 && (
            <Form.Item label={t('librarySettings.currentAttachments')}>
              {editModal.files.map((f) => (
                <div key={f.filename} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', marginBottom: 4, background: '#f5f5f5', borderRadius: 4, fontSize: 13 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <PaperClipOutlined style={{ marginRight: 6, color: '#1890ff' }} />
                    {f.filename}
                    {f.file_size ? ' (' + (f.file_size / 1024).toFixed(0) + ' KB)' : ''}
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

          <Form.Item label={t('librarySettings.appendUpload')} extra={piiScanning ? t('pii.scanningFiles') : t('librarySettings.appendUploadHint')}>
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
                if (newFileList.length > 0) handlePiiScan(newFileList, setEditFileList);
              }}
              beforeUpload={() => false}
            >
              <Button icon={<CloudUploadOutlined />} loading={piiScanning}>
                {piiScanning ? t('pii.scanningFiles') : t('common.selectFile')}
              </Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Permission Modal */}
      <Modal
        title={t('librarySettings.permissionTitle', { name: permModal?.name })}
        open={!!permModal}
        onCancel={() => setPermModal(null)}
        onOk={handlePermSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>{t('librarySettings.permissionHint')}</p>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder={t('librarySettings.selectUsers')}
          value={permUsers}
          onChange={setPermUsers}
          options={userList.map((u) => ({ value: u.id, label: u.name + ' (' + (t('departments.' + u.department) || u.department) + ')' }))}
        />
      </Modal>

      {/* Cover Image Modal */}
      <Modal
        title={<span><PictureOutlined style={{ marginRight: 8 }} />{t('librarySettings.coverImageTitle', { name: imageModal?.name })}</span>}
        open={!!imageModal}
        onCancel={handleCloseImageModal}
        footer={[
          imageModal?.imageUrl && (
            <Popconfirm key="delete" title={t('librarySettings.deleteCoverImageConfirm')} onConfirm={handleDeleteImage} okText={t('common.confirm')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}>
              <Button danger icon={<DeleteOutlined />}>{t('librarySettings.deleteImage')}</Button>
            </Popconfirm>
          ),
          <Button key="cancel" onClick={handleCloseImageModal}>{t('common.cancel')}</Button>,
          <Button key="upload" type="primary" onClick={handleUploadImage} loading={imageUploading} disabled={imageFileList.length === 0} style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}>{t('common.upload')}</Button>,
        ]}
        width={520}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>{t('librarySettings.coverImageHint')}</p>

        {existingImageUrl && !imagePreview && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <p style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>{t('librarySettings.currentCoverImage')}</p>
            <img src={existingImageUrl} alt="current cover" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: '1px solid #d9d9d9', objectFit: 'contain' }} />
          </div>
        )}

        <Upload.Dragger
          accept=".png,.jpg,.jpeg"
          maxCount={1}
          fileList={imageFileList}
          beforeUpload={(file) => {
            if (file.size > 5 * 1024 * 1024) {
              message.error(t('librarySettings.imageSizeExceeded'));
              return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = (e) => setImagePreview(e.target.result);
            reader.readAsDataURL(file);
            return false;
          }}
          onChange={({ fileList }) => {
            setImageFileList(fileList.slice(-1));
            if (fileList.length === 0) setImagePreview(null);
          }}
          onRemove={() => setImagePreview(null)}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{t('librarySettings.dragImageHint')}</p>
          <p className="ant-upload-hint">{t('librarySettings.imageFormatHint')}</p>
        </Upload.Dragger>

        {imagePreview && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ marginBottom: 8, fontWeight: 500, color: '#333' }}>{t('librarySettings.imagePreview')}</p>
            <img src={imagePreview} alt="preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: '1px solid #d9d9d9', objectFit: 'contain' }} />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LibrarySettings;
