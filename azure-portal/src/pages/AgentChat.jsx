import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'; // useMemo 保留供 filteredSessions
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Tag, Input, Select, Empty, Spin, Popconfirm, Tooltip, message as antdMessage } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  StopOutlined,
  LoadingOutlined,
  PlusOutlined,
  SelectOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  DeleteOutlined,
  PaperClipOutlined,
  CloseCircleFilled,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useChat } from '../contexts/ChatContext';
import { useLanguage } from '../contexts/LanguageContext';
import './AgentChat.css';

const { TextArea } = Input;

const AgentChat = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── 從 ChatContext 取得所有共享狀態與操作 ──────────────────
  const {
    agents,
    agentsLoading,
    selectedAgent,
    handleSelectAgent,
    sessions,
    sessionsLoading,
    sessionId,
    handleSelectSession,
    handleDeleteSession: ctxDeleteSession,
    messages,
    isStreaming,
    handleSend: ctxHandleSend,
    handleNewChat,
    handleStopStreaming,
    selectedImages,
    setSelectedImages,
    loadFromUrlParams,
  } = useChat();

  // ── 本地 UI 狀態（不需要跨頁面保留）──────────────────────
  const [inputValue, setInputValue] = useState('');
  const [sessionSearchText, setSessionSearchText] = useState('');
  const [sessionPanelCollapsed, setSessionPanelCollapsed] = useState(false);
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);

  // ── Refs ─────────────────────────────────────────────────────
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── 時間格式 locale ──────────────────────────────────────────
  const timeLocale =
    language === 'ja'
      ? 'ja-JP'
      : language === 'th'
        ? 'th-TH'
        : language === 'vi'
          ? 'vi-VN'
          : language === 'en'
            ? 'en-US'
            : 'zh-TW';

  // ── Session 搜尋過濾 ─────────────────────────────────────
  const filteredSessions = useMemo(() => {
    if (!sessionSearchText.trim()) return sessions;
    const text = sessionSearchText.trim().toLowerCase();
    return sessions.filter((s) =>
      (s.lastMessagePreview || '').toLowerCase().includes(text) ||
      (s.title || '').toLowerCase().includes(text)
    );
  }, [sessions, sessionSearchText]);

  // ── 從 URL 參數載入（支援兩種情境）：
  // 1. ChatHistory 跳轉：?session=xxx&agent=xxx → 載入歷史訊息
  // 2. Home Agent 卡片：?agent=xxx → 自動選擇 Agent，開始新對話
  useEffect(() => {
    if (agentsLoading || agents.length === 0) return;

    const urlSession = searchParams.get('session');
    const urlAgent = searchParams.get('agent');

    if (urlAgent) {
      loadFromUrlParams(urlAgent, urlSession);
      // 清除 URL 參數（避免重新整理時重複載入）
      setSearchParams({}, { replace: true });
    }
  }, [agentsLoading, agents, searchParams, setSearchParams, loadFromUrlParams]);

  // ── 自動捲動到底部 ───────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── 刪除 Session（含 UI 提示）───────────────────────────────
  const handleDeleteSession = useCallback(
    async (sid, e) => {
      e?.stopPropagation();
      try {
        await ctxDeleteSession(sid);
        antdMessage.success(t('agentChat.sessionDeleted'));
      } catch {
        antdMessage.error(t('agentChat.sessionDeleteFailed'));
      }
    },
    [ctxDeleteSession, t],
  );

  // ── 圖片上傳相關 ─────────────────────────────────────────────
  const handleImageSelect = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
      const MAX_IMAGES = 5;

      if (selectedImages.length + files.length > MAX_IMAGES) {
        antdMessage.warning(t('agentChat.maxImagesWarning', { max: MAX_IMAGES }));
        return;
      }

      const validImages = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          antdMessage.warning(t('agentChat.notImageFile', { name: file.name }));
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          antdMessage.warning(t('agentChat.imageTooLarge', { name: file.name }));
          continue;
        }
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          validImages.push({ file, base64, preview: base64, name: file.name });
        } catch {
          antdMessage.error(t('agentChat.imageReadFailed', { name: file.name }));
        }
      }

      if (validImages.length > 0) {
        setSelectedImages((prev) => [...prev, ...validImages]);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [selectedImages, setSelectedImages, t],
  );

  const handleRemoveImage = useCallback(
    (index) => {
      setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    },
    [setSelectedImages],
  );

  const handleOpenFilePicker = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // ── 發送訊息（委派給 ChatContext）───────────────────────────
  const handleSend = useCallback(() => {
    if ((!inputValue.trim() && selectedImages.length === 0) || !selectedAgent || isStreaming) return;
    ctxHandleSend(inputValue, timeLocale, t);
    setInputValue('');
  }, [inputValue, selectedImages, selectedAgent, isStreaming, ctxHandleSend, timeLocale, t]);

  // ── Loading 狀態 ─────────────────────────────────────────────
  if (agentsLoading) {
    return (
      <div
        className="agent-chat-page"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 300,
        }}
      >
        <Spin size="large" tip={t('agentChat.loadingAgents')} />
      </div>
    );
  }

  return (
    <div className="agent-chat-page">
      {/* 左側 Session 面板 */}
      <div className={`chat-session-panel${sessionPanelCollapsed ? ' chat-panel-collapsed' : ''}`}>
        <div className="session-panel-header">
          {!sessionPanelCollapsed && (
            <span className="session-panel-title">
              <SelectOutlined style={{ marginRight: 6 }} />
              {t('agentChat.chatSessions')}
            </span>
          )}
          <div className="session-panel-header-actions">
            {!sessionPanelCollapsed && selectedAgent && (
              <Button
                icon={<PlusOutlined />}
                onClick={handleNewChat}
                disabled={isStreaming}
                size="small"
                type="text"
                title={t('agentChat.newChat')}
              />
            )}
            <Button
              icon={sessionPanelCollapsed ? <RightOutlined /> : <LeftOutlined />}
              onClick={() => setSessionPanelCollapsed(!sessionPanelCollapsed)}
              size="small"
              type="text"
              title={sessionPanelCollapsed ? t('agentChat.chatSessions') : t('common.collapse')}
            />
          </div>
        </div>
        {/* 折疊時在 header 下方顯示新對話按鈕 */}
        {sessionPanelCollapsed && selectedAgent && (
          <div className="session-panel-collapsed-actions">
            <Button
              icon={<PlusOutlined />}
              onClick={handleNewChat}
              disabled={isStreaming}
              size="small"
              type="text"
              title={t('agentChat.newChat')}
            />
          </div>
        )}
        {/* 搜尋列 */}
        {!sessionPanelCollapsed && selectedAgent && (
          <div className="session-search-bar">
            <Input
              size="small"
              placeholder={t('agentChat.searchSession')}
              value={sessionSearchText}
              onChange={(e) => setSessionSearchText(e.target.value)}
              allowClear
              style={{ width: '100%' }}
            />
          </div>
        )}
        {sessionPanelCollapsed && (
          <div
            className="panel-collapsed-label"
            onClick={() => setSessionPanelCollapsed(false)}
          >
            {t('agentChat.chatSessions')}
          </div>
        )}
        {!sessionPanelCollapsed && (
          <div className="session-panel-list">
            {!selectedAgent ? (
              <div className="session-empty-hint">
                {t('agentChat.selectAgentForSessions')}
              </div>
            ) : sessionsLoading ? (
              <div className="session-loading">
                <Spin size="small" />
                <span style={{ marginLeft: 8 }}>{t('agentChat.loadingSessions')}</span>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="session-empty-hint">
                {sessions.length === 0 ? t('agentChat.noSessions') : t('common.noData')}
              </div>
            ) : (
              filteredSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className={`session-panel-item ${sessionId === session.sessionId ? 'active' : ''}`}
                  onClick={() => handleSelectSession(session)}
                >
                  <div className="session-item-content">
                    <div className="session-item-title">
                      <MessageOutlined style={{ marginRight: 6, fontSize: 12, opacity: 0.6 }} />
                      {session.lastMessagePreview || session.title || t('agentChat.untitledSession')}
                    </div>
                    <div className="session-item-meta">
                      <ClockCircleOutlined style={{ marginRight: 4, fontSize: 11 }} />
                      <span>{session.formattedTime}</span>
                      {session.messageCount > 0 && (
                        <Tag color="blue" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px' }}>
                          {session.messageCount} {t('agentChat.messagesUnit')}
                        </Tag>
                      )}
                    </div>
                  </div>
                  <div className="session-item-actions" onClick={(e) => e.stopPropagation()}>
                    <Popconfirm
                      title={t('agentChat.confirmDeleteSession')}
                      onConfirm={(e) => handleDeleteSession(session.sessionId, e)}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                    >
                      <DeleteOutlined className="session-delete-btn" />
                    </Popconfirm>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 主聊天區 */}
      <div className="chat-main">
        <div className="chat-header">
          <RobotOutlined style={{ fontSize: 20 }} />
          <Select
            placeholder={t('agentChat.selectAgent')}
            style={{ width: 300 }}
            value={selectedAgent?.id}
            onChange={handleSelectAgent}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
          {selectedAgent && (
            <Button
              icon={<PlusOutlined />}
              onClick={handleNewChat}
              disabled={isStreaming}
              size="small"
            >
              {t('agentChat.newChat')}
            </Button>
          )}
          {sessionId && (
            <Tag color="blue" style={{ marginLeft: 'auto', fontSize: 11 }}>
              {t('agentChat.multiTurn')}
            </Tag>
          )}
        </div>

        <div className="chat-messages">
          {!selectedAgent ? (
            <Empty
              description={t('agentChat.selectAgentFirst')}
              style={{ marginTop: 100 }}
            />
          ) : messages.length === 0 ? (
            <Empty
              description={t('agentChat.selectedAgent', {
                name: selectedAgent.name,
              })}
              style={{ marginTop: 100 }}
            />
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                <div
                  className={`chat-message-bubble ${msg.isError ? 'error' : ''}`}
                >
                  {/* 使用者訊息中的圖片預覽 */}
                  {msg.role === 'user' && msg.images && msg.images.length > 0 && (
                    <div className="chat-message-images">
                      {msg.images.map((img, imgIdx) => (
                        <img
                          key={imgIdx}
                          src={img.preview}
                          alt={img.name || `image-${imgIdx}`}
                          className="chat-message-image-thumb"
                          onClick={() => window.open(img.preview, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                  {msg.role === 'assistant' && msg.isStreaming && !msg.content ? (
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : (
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                      {msg.content}
                      {msg.isStreaming && <span className="streaming-cursor">▊</span>}
                    </p>
                  )}
                  {msg.time && (
                    <span className="chat-message-time">{msg.time}</span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 圖片預覽條 */}
        {selectedImages.length > 0 && (
          <div className="chat-image-preview-strip">
            {selectedImages.map((img, idx) => (
              <div key={idx} className="chat-image-preview-item">
                <img src={img.preview} alt={img.name} className="chat-image-preview-thumb" />
                <CloseCircleFilled
                  className="chat-image-preview-remove"
                  onClick={() => handleRemoveImage(idx)}
                />
                <span className="chat-image-preview-name">{img.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-area">
          {/* 隱藏的檔案選擇器 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImageSelect}
          />

          {/* 上傳圖片按鈕 */}
          <Tooltip title={t('agentChat.uploadImage')}>
            <Button
              type="text"
              icon={<PaperClipOutlined />}
              onClick={handleOpenFilePicker}
              disabled={!selectedAgent || isStreaming}
              className="chat-upload-btn"
            />
          </Tooltip>

          <TextArea
            placeholder={
              selectedAgent
                ? isStreaming
                  ? t('agentChat.waitingReply')
                  : t('agentChat.sendMessage', { name: selectedAgent.name })
                : t('agentChat.selectAgentPlaceholder')
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ minHeight: 36 }}
            disabled={!selectedAgent || isStreaming}
          />
          {isStreaming ? (
            <Button
              type="primary"
              danger
              icon={<StopOutlined />}
              onClick={handleStopStreaming}
              style={{ minWidth: 80 }}
            >
              {t('agentChat.stop')}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={!selectedAgent || (!inputValue.trim() && selectedImages.length === 0)}
              style={{
                background: 'var(--primary-color)',
                borderColor: 'var(--primary-color)',
              }}
            />
          )}
        </div>
      </div>

      {/* 右側 Agent 列表 */}
      <div className={`chat-agent-panel${agentPanelCollapsed ? ' chat-panel-collapsed' : ''}`}>
        <div className="agent-panel-header">
          <Button
            icon={agentPanelCollapsed ? <LeftOutlined /> : <RightOutlined />}
            onClick={() => setAgentPanelCollapsed(!agentPanelCollapsed)}
            size="small"
            type="text"
            title={agentPanelCollapsed ? t('agentChat.availableAgents') : t('common.collapse')}
          />
          {!agentPanelCollapsed && (
            <>
              <span className="agent-panel-title">
                {t('agentChat.availableAgents')}
              </span>
              <span
                className="agent-panel-view-all"
                onClick={() => navigate('/agent-store')}
                style={{ cursor: 'pointer' }}
              >
                {t('common.viewAll')}
              </span>
            </>
          )}
        </div>
        {agentPanelCollapsed && (
          <div
            className="panel-collapsed-label"
            onClick={() => setAgentPanelCollapsed(false)}
          >
            {t('agentChat.availableAgents')}
          </div>
        )}
        {!agentPanelCollapsed && (
          <div className="agent-panel-list">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={`agent-panel-item ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                onClick={() => handleSelectAgent(agent.id)}
              >
                <div
                  className="agent-panel-icon"
                  style={{
                    background: agent.color + '20',
                    color: agent.color,
                  }}
                >
                  {agent.icon}
                </div>
                <div className="agent-panel-info">
                  <div className="agent-panel-name">{agent.name}</div>
                  <div className="agent-panel-meta">
                    <span>{agent.model}</span>
                    <Tag
                      color="green"
                      style={{ marginLeft: 6, fontSize: 11 }}
                    >
                      {t(`agentStore.status_${agent.status}`)}
                    </Tag>
                  </div>
                </div>
                <Button
                  type="primary"
                  size="small"
                  style={{
                    background: 'var(--primary-color)',
                    borderColor: 'var(--primary-color)',
                    fontSize: 12,
                  }}
                >
                  {t('common.chat')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentChat;
