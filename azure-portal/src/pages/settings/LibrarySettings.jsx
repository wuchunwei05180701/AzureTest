import React, { useState, useEffect, useCallback, memo } from 'react';
import { Table, Button, Modal, Form, Input, Select, Upload, Popconfirm, Tag, message, Space, Spin, Divider, Tooltip, Segmented, Dropdown, Empty, Checkbox, Switch, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, DatabaseOutlined, UserOutlined, GlobalOutlined, FolderAddOutlined, FolderOutlined, EditOutlined, PaperClipOutlined, CloudUploadOutlined, PictureOutlined, InboxOutlined, FileTextOutlined, SearchOutlined, MoreOutlined, HomeOutlined } from '@ant-design/icons';
import { libraryAPI, piiAPI, userAPI } from '../../services/api';
import { adaptLibraryDocs, adaptCatalogs } from '../../utils/adapters';
import { libraries as mockLibraries, userList as mockUserList } from '../../data/mockData';
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
  const [permSearch, setPermSearch] = useState('');
  const [permRestricted, setPermRestricted] = useState(false); // 是否啟用存取限制
  const [realUserList, setRealUserList] = useState([]);
  const [userListLoading, setUserListLoading] = useState(false);
  // 編輯館 Modal 狀態
  const [editCatalogModal, setEditCatalogModal] = useState(null); // 目前編輯的 catalog
  const [editCatalogName, setEditCatalogName] = useState('');
  const [editCatalogLoading, setEditCatalogLoading] = useState(false);
  const [editCatalogImageFileList, setEditCatalogImageFileList] = useState([]);
  const [editCatalogImagePreview, setEditCatalogImagePreview] = useState(null);
  const [editCatalogImageUploading, setEditCatalogImageUploading] = useState(false);
  const [editCatalogExistingImageUrl, setEditCatalogExistingImageUrl] = useState(null);
  const [editCatalogDocs, setEditCatalogDocs] = useState([]);
  const [editCatalogDocsLoading, setEditCatalogDocsLoading] = useState(false);

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
    // 如果 PII 掃描還在進行中，阻止上傳
    if (piiScanning) {
      message.warning(t('pii.scanningFiles'));
      return;
    }
    try {
      const v = await form.validateFields();
      setUploadLoading(true);
      const fd = new FormData();
      const fileList = v.file?.fileList || [];
      if (fileList.length > 0) fd.append('file', fileList[0].originFileObj);
      const p = { library_name: v.libraryName, name: v.name, description: v.description || '' };
      if (isSuperAdmin && v.target_country) p.country = v.target_country;
      await libraryAPI.upload(fd, { params: p });
      message.success(t('librarySettings.documentUploaded'));
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
    // 如果 PII 掃描還在進行中，阻止儲存
    if (piiScanning) {
      message.warning(t('pii.scanningFiles'));
      return;
    }
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
        fd.append('file', editFileList[0].originFileObj || editFileList[0]);
        try {
          await libraryAPI.uploadFile(editModal.id, fd, cp);
          message.success(t('librarySettings.documentUploaded'));
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

  const openPermModal = async (doc) => {
    // 先取得最新資料，再開啟 modal（避免 async 覆蓋使用者操作）
    setUserListLoading(true);
    try {
      // 同時取得最新 doc 資料（確保 auth_rules 是最新的）和使用者列表
      const [docsRes, usersRes] = await Promise.allSettled([
        libraryAPI.listAll(isSuperAdmin ? effectiveCountry : undefined),
        userAPI.list(isSuperAdmin ? { country: effectiveCountry } : {}),
      ]);

      // 從最新資料中找到對應的 doc，取得最新的 auth_rules
      let existing = doc.auth_rules?.authorized_users || [];
      if (docsRes.status === 'fulfilled') {
        const latestDocs = Array.isArray(docsRes.value.data) ? docsRes.value.data : [];
        const latestDoc = latestDocs.find((d) => d.doc_id === doc.id);
        existing = latestDoc?.auth_rules?.authorized_users || [];
      }
      setPermUsers(existing);
      setPermRestricted(existing.length > 0);

      // 設定使用者列表
      if (usersRes.status === 'fulfilled') {
        const users = Array.isArray(usersRes.value.data) ? usersRes.value.data : (usersRes.value.data?.users || usersRes.value.data?.items || []);
        setRealUserList(users.length > 0 ? users : mockUserList);
      } else {
        setRealUserList(mockUserList);
      }
    } catch {
      const existing = doc.auth_rules?.authorized_users || [];
      setPermUsers(existing);
      setPermRestricted(existing.length > 0);
      setRealUserList(mockUserList);
    } finally {
      setUserListLoading(false);
      // 資料準備好後才開啟 modal
      setPermModal(doc);
    }
  };

  const handlePermSave = async () => {
    if (!permModal) return;
    // 若開啟限制但未選任何人，阻止儲存
    if (permRestricted && permUsers.length === 0) {
      message.warning('請至少選擇一位使用者，或關閉存取限制開關');
      return;
    }
    // 若關閉限制開關，送空陣列 = 公開給所有人
    const usersToSave = permRestricted ? permUsers : [];
    try {
      await libraryAPI.updateAuth(permModal.id, { authorized_roles: [], authorized_users: usersToSave, exception_list: [] });
      message.success(t('librarySettings.permissionUpdated'));
      setPermModal(null);
      setPermSearch('');
      setPermRestricted(false);
      fetchLibrary(effectiveCountry);
    } catch (e) {
      const detail = e.response?.data?.detail;
      const errMsg = Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join(', ')
        : (detail || e.message);
      message.error(t('librarySettings.updateFailed') + ': ' + errMsg);
    }
  };

  const handleDeleteLibrary = async (name) => {
    try {
      await libraryAPI.deleteLibrary(name, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.libraryDeleted', { name }));
      fetchLibrary(effectiveCountry);
    } catch (e) { message.error(t('librarySettings.deleteFailed') + ': ' + (e.response?.data?.detail || e.message)); }
  };

  // ===== 編輯館 Modal =====
  const handleOpenEditCatalog = async (cat) => {
    setEditCatalogModal(cat);
    setEditCatalogName(cat.name);
    setEditCatalogImageFileList([]);
    setEditCatalogImagePreview(null);
    setEditCatalogExistingImageUrl(null);
    setEditCatalogDocs([]);

    // 載入封面圖片
    if (cat.imageUrl) {
      try {
        const r = await libraryAPI.getCatalogImage(cat.catalogId, isSuperAdmin ? effectiveCountry : undefined);
        setEditCatalogExistingImageUrl(URL.createObjectURL(r.data));
      } catch { /* ignore */ }
    }

    // 載入館內文件
    setEditCatalogDocsLoading(true);
    try {
      const docsRes = await libraryAPI.listAll(isSuperAdmin ? effectiveCountry : undefined);
      const docs = Array.isArray(docsRes.data) ? docsRes.data : [];
      setEditCatalogDocs(docs.filter((d) => d.library_name === cat.name));
    } catch {
      setEditCatalogDocs(
        libraries.find((l) => l.name === cat.name)?.documents?.map((d) => ({
          doc_id: d.id,
          name: d.name,
          library_name: cat.name,
        })) || []
      );
    } finally {
      setEditCatalogDocsLoading(false);
    }
  };

  const handleCloseEditCatalog = () => {
    setEditCatalogModal(null);
    setEditCatalogName('');
    setEditCatalogImageFileList([]);
    setEditCatalogImagePreview(null);
    if (editCatalogExistingImageUrl) {
      URL.revokeObjectURL(editCatalogExistingImageUrl);
      setEditCatalogExistingImageUrl(null);
    }
    setEditCatalogDocs([]);
  };

  const handleSaveEditCatalog = async () => {
    if (!editCatalogModal) return;
    const newName = editCatalogName.trim();
    if (!newName) { message.warning(t('librarySettings.editLibraryNameRequired')); return; }
    if (newName !== editCatalogModal.name && catalogs.some((c) => c.name === newName && c.catalogId !== editCatalogModal.catalogId)) {
      message.warning(t('librarySettings.editLibraryNameExists'));
      return;
    }
    setEditCatalogLoading(true);
    try {
      const updateData = {};
      if (newName !== editCatalogModal.name) updateData.library_name = newName;
      if (Object.keys(updateData).length > 0) {
        await libraryAPI.updateCatalog(editCatalogModal.catalogId, updateData, isSuperAdmin ? effectiveCountry : undefined);
      }
      // 上傳新封面圖片
      if (editCatalogImageFileList.length > 0) {
        const fd = new FormData();
        fd.append('file', editCatalogImageFileList[0].originFileObj);
        await libraryAPI.uploadCatalogImage(editCatalogModal.catalogId, fd, isSuperAdmin ? effectiveCountry : undefined);
      }
      message.success(t('librarySettings.editLibrarySaved', { name: newName }));
      handleCloseEditCatalog();
      fetchLibrary(effectiveCountry);
    } catch (e) {
      message.error(t('librarySettings.editLibrarySaveFailed') + ': ' + (e.response?.data?.detail || e.message));
    } finally {
      setEditCatalogLoading(false);
    }
  };

  const handleEditCatalogUploadImage = async () => {
    if (!editCatalogModal || editCatalogImageFileList.length === 0) return;
    setEditCatalogImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', editCatalogImageFileList[0].originFileObj);
      await libraryAPI.uploadCatalogImage(editCatalogModal.catalogId, fd, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.coverImageUploaded'));
      setEditCatalogImageFileList([]);
      setEditCatalogImagePreview(null);
      // 重新載入圖片
      try {
        const r = await libraryAPI.getCatalogImage(editCatalogModal.catalogId, isSuperAdmin ? effectiveCountry : undefined);
        if (editCatalogExistingImageUrl) URL.revokeObjectURL(editCatalogExistingImageUrl);
        setEditCatalogExistingImageUrl(URL.createObjectURL(r.data));
        // 同步更新 editCatalogModal 的 imageUrl 標記
        setEditCatalogModal((prev) => prev ? { ...prev, imageUrl: 'updated' } : prev);
      } catch { /* ignore */ }
      fetchLibrary(effectiveCountry);
    } catch (e) {
      message.error(t('librarySettings.coverImageUploadFailed') + ': ' + (e.response?.data?.detail || e.message));
    } finally {
      setEditCatalogImageUploading(false);
    }
  };

  const handleEditCatalogDeleteImage = async () => {
    if (!editCatalogModal) return;
    try {
      await libraryAPI.deleteCatalogImage(editCatalogModal.catalogId, isSuperAdmin ? effectiveCountry : undefined);
      message.success(t('librarySettings.coverImageDeleted'));
      if (editCatalogExistingImageUrl) {
        URL.revokeObjectURL(editCatalogExistingImageUrl);
        setEditCatalogExistingImageUrl(null);
      }
      setEditCatalogModal((prev) => prev ? { ...prev, imageUrl: null } : prev);
      fetchLibrary(effectiveCountry);
    } catch (e) {
      message.error(t('librarySettings.coverImageDeleteFailed') + ': ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleEditCatalogDeleteDoc = async (docId, docName) => {
    try {
      if (isSuperAdmin && effectiveCountry) await libraryAPI.delete(docId, { params: { country: effectiveCountry } });
      else await libraryAPI.delete(docId);
      message.success(t('librarySettings.documentDeleted'));
      setEditCatalogDocs((prev) => prev.filter((d) => d.doc_id !== docId));
      fetchLibrary(effectiveCountry);
    } catch (e) {
      message.error(t('librarySettings.deleteFailed') + ': ' + (e.response?.data?.detail || e.message));
    }
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
                  okText: t('common.delete'),
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
    const latestFile = e.fileList.slice(-1);
    const fileSize = latestFile[0]?.originFileObj?.size || latestFile[0]?.size || 0;
    if (fileSize > 100 * 1024 * 1024) {
      message.error(t('librarySettings.fileSizeExceeded', { size: (fileSize / 1024 / 1024).toFixed(1) }));
      return { fileList: [] };
    }
    if (latestFile.length > 0) {
      handlePiiScan(latestFile, (cleared) => { form.setFieldsValue({ file: { fileList: cleared } }); });
    }
    return { fileList: latestFile };
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
                  icon={
                    <span role="img" className="anticon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z" />
                        <line x1="12" y1="9" x2="12" y2="17" />
                        <line x1="8" y1="13" x2="16" y2="13" />
                      </svg>
                    </span>
                  }
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
                            icon={<EditOutlined />}
                            onClick={() => handleOpenEditCatalog(stat)}
                            size="small"
                            style={{ color: 'var(--primary-color)' }}
                          >
                            {t('librarySettings.editLibrary')}
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
        okText={piiScanning ? t('pii.scanningFiles') : t('common.upload')}
        cancelText={t('common.cancel')}
        okButtonProps={{
          style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' },
          disabled: piiScanning,
          loading: piiScanning,
        }}
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
              maxCount={1}
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
        okText={piiScanning ? t('pii.scanningFiles') : t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{
          style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' },
          disabled: piiScanning,
          loading: piiScanning,
        }}
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

          <Form.Item label={t('librarySettings.appendUpload')} extra={piiScanning ? t('pii.scanningFiles') : '選擇新檔案將取代目前的附件'}>
            <Upload
              maxCount={1}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp"
              fileList={editFileList}
              onChange={({ fileList: newFileList }) => {
                const latest = newFileList.slice(-1);
                const fileSize = latest[0]?.originFileObj?.size || latest[0]?.size || 0;
                if (fileSize > 100 * 1024 * 1024) {
                  message.error(t('librarySettings.fileSizeExceeded', { size: (fileSize / 1024 / 1024).toFixed(1) }));
                  return;
                }
                setEditFileList(latest);
                if (latest.length > 0) handlePiiScan(latest, setEditFileList);
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
        onCancel={() => { setPermModal(null); setPermSearch(''); setPermRestricted(false); }}
        onOk={() => { handlePermSave(); setPermSearch(''); }}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
      >
        {/* 啟用存取限制開關 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '12px 16px', background: '#f5f5f5', borderRadius: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>啟用存取限制</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {permRestricted ? '僅限以下勾選的使用者可存取此文件' : '所有人均可存取此文件（公開）'}
            </div>
          </div>
          <Switch
            checked={permRestricted}
            onChange={(checked) => {
              setPermRestricted(checked);
              if (!checked) setPermUsers([]); // 關閉時清空選擇
            }}
            checkedChildren="限定"
            unCheckedChildren="公開"
          />
        </div>

        {/* 僅在啟用限制時顯示使用者清單 */}
        {permRestricted && (
          <>
            {permUsers.length === 0 && (
              <Alert
                message="請至少選擇一位使用者，否則儲存後將視為公開"
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
              />
            )}
            <Input
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder={t('librarySettings.selectUsers')}
              value={permSearch}
              onChange={(e) => setPermSearch(e.target.value)}
              allowClear
              style={{ marginBottom: 8 }}
            />
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 6, padding: '4px 0' }}>
              {userListLoading ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin size="small" /></div>
              ) : realUserList
                .filter((u) => u.role !== 'root')
                .filter((u) => {
                  if (!permSearch.trim()) return true;
                  const kw = permSearch.toLowerCase();
                  return u.name?.toLowerCase().includes(kw) || u.email?.toLowerCase().includes(kw) || u.department?.toLowerCase().includes(kw);
                })
                .map((u) => (
                  <label
                    key={u.email}
                    style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', borderRadius: 4, userSelect: 'none' }}
                  >
                    <Checkbox
                      checked={permUsers.includes(u.email)}
                      style={{ marginRight: 10 }}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setPermUsers((prev) =>
                          checked ? [...prev, u.email] : prev.filter((email) => email !== u.email)
                        );
                      }}
                    />
                    <span style={{ flex: 1 }}>{u.name || u.email}</span>
                    <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{u.email}</span>
                    <Tag style={{ fontSize: 11 }}>{u.department || ''}</Tag>
                  </label>
                ))}
            </div>
            {permUsers.length > 0 && (
              <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                已選擇 {permUsers.length} 人
              </div>
            )}
          </>
        )}
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

      {/* Edit Catalog Modal */}
      <Modal
        title={
          <span>
            <EditOutlined style={{ marginRight: 8 }} />
            {t('librarySettings.editLibraryTitle', { name: editCatalogModal?.name })}
          </span>
        }
        open={!!editCatalogModal}
        onCancel={handleCloseEditCatalog}
        onOk={handleSaveEditCatalog}
        confirmLoading={editCatalogLoading}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ style: { background: 'var(--primary-color)', borderColor: 'var(--primary-color)' } }}
        width={600}
      >
        {/* 館名編輯 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            <FolderOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
            {t('librarySettings.editLibraryNameLabel')}
          </div>
          <Input
            value={editCatalogName}
            onChange={(e) => setEditCatalogName(e.target.value)}
            placeholder={t('librarySettings.editLibraryNamePlaceholder')}
            size="large"
            prefix={<FolderOutlined style={{ color: '#bbb' }} />}
          />
        </div>

        <Divider style={{ margin: '16px 0' }} />

        {/* 封面圖片管理 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            <PictureOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
            {t('librarySettings.coverImage')}
          </div>

          {editCatalogExistingImageUrl && !editCatalogImagePreview && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src={editCatalogExistingImageUrl}
                alt="cover"
                style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #d9d9d9' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{t('librarySettings.currentCoverImage')}</div>
                <Popconfirm
                  title={t('librarySettings.deleteCoverImageConfirm')}
                  onConfirm={handleEditCatalogDeleteImage}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>{t('librarySettings.deleteImage')}</Button>
                </Popconfirm>
              </div>
            </div>
          )}

          <Upload
            accept=".png,.jpg,.jpeg"
            maxCount={1}
            fileList={editCatalogImageFileList}
            beforeUpload={(file) => {
              if (file.size > 5 * 1024 * 1024) {
                message.error(t('librarySettings.imageSizeExceeded'));
                return Upload.LIST_IGNORE;
              }
              const reader = new FileReader();
              reader.onload = (e) => setEditCatalogImagePreview(e.target.result);
              reader.readAsDataURL(file);
              return false;
            }}
            onChange={({ fileList }) => {
              setEditCatalogImageFileList(fileList.slice(-1));
              if (fileList.length === 0) setEditCatalogImagePreview(null);
            }}
            onRemove={() => setEditCatalogImagePreview(null)}
          >
            <Button icon={<PictureOutlined />} size="small">
              {editCatalogExistingImageUrl ? t('librarySettings.changeImage') : t('librarySettings.uploadImage')}
            </Button>
          </Upload>

          {editCatalogImagePreview && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src={editCatalogImagePreview}
                alt="preview"
                style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #d9d9d9' }}
              />
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{t('librarySettings.imagePreview')}</div>
                <Button
                  type="primary"
                  size="small"
                  loading={editCatalogImageUploading}
                  onClick={handleEditCatalogUploadImage}
                  style={{ background: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                >
                  {t('common.upload')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <Divider style={{ margin: '16px 0' }} />

        {/* 館內文件列表 */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            <FileTextOutlined style={{ marginRight: 6, color: 'var(--primary-color)' }} />
            {t('librarySettings.editLibraryDocsTitle')}
            <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>{editCatalogDocs.length}</Tag>
          </div>

          {editCatalogDocsLoading ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin size="small" /></div>
          ) : editCatalogDocs.length === 0 ? (
            <Empty description={t('librarySettings.editLibraryNoDocuments')} style={{ padding: '20px 0' }} />
          ) : (
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
              {editCatalogDocs.map((doc) => (
                <div
                  key={doc.doc_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderBottom: '1px solid #f5f5f5',
                    gap: 8,
                  }}
                >
                  <FileTextOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {doc.name}
                  </span>
                  <Popconfirm
                    title={t('librarySettings.editLibraryDeleteDocConfirm', { name: doc.name })}
                    onConfirm={() => handleEditCatalogDeleteDoc(doc.doc_id, doc.name)}
                    okText={t('librarySettings.confirmDelete')}
                    cancelText={t('common.cancel')}
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default LibrarySettings;
