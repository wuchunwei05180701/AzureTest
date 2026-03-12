import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { agentAPI, chatAPI } from '../services/api';
import { adaptAgents, adaptSessionList, adaptSessionDetail } from '../utils/adapters';
import { agents as mockAgents } from '../data/mockData';
import { useLanguage } from '../contexts/LanguageContext';
import './AgentChat.css';

const { TextArea } = Input;

const AgentChat = () => {
  const { t, language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  // Agent 列表
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Session 列表
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // 對話狀態
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // 圖片上傳狀態
  const [selectedImages, setSelectedImages] = useState([]); // [{ file, base64, preview, name }]
  const fileInputRef = useRef(null);

  // Refs
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);

  // 時間格式 locale
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

  // 載入 Agent 列表
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await agentAPI.list();
        setAgents(adaptAgents(res.data));
      } catch (err) {
        console.warn('Agent API 失敗，使用 mock 資料', err);
        setAgents(mockAgents);
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, []);

  // 當選擇 Agent 時載入該 Agent 的 Session 列表
  const fetchSessions = useCallback(async (agentId) => {
    if (!agentId) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      const res = await chatAPI.sessions({ agent_id: agentId, page_size: 50 });
      const adapted = adaptSessionList(res.data);
      setSessions(adapted.sessions);
    } catch (err) {
      console.warn('載入 Session 列表失敗', err);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      fetchSessions(selectedAgent.id);
    } else {
      setSessions([]);
    }
  }, [selectedAgent, fetchSessions]);

  // 從 URL 參數載入（支援兩種情境）：
  // 1. ChatHistory 跳轉：?session=xxx&agent=xxx → 載入歷史訊息
  // 2. Home Agent 卡片：?agent=xxx → 自動選擇 Agent，開始新對話
  useEffect(() => {
    if (loading || agents.length === 0) return;

    const urlSession = searchParams.get('session');
    const urlAgent = searchParams.get('agent');

    if (urlAgent) {
      const agent = agents.find((a) => a.id === urlAgent);
      if (agent) {
        setSelectedAgent(agent);

        if (urlSession) {
          // 情境 1：從 ChatHistory 繼續對話
          setSessionId(urlSession);

          // 載入歷史訊息
          const loadHistory = async () => {
            try {
              const res = await chatAPI.sessionDetail(urlSession);
              const detail = adaptSessionDetail(res.data);
              if (detail?.messages?.length > 0) {
                setMessages(
                  detail.messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                    time: msg.time || '',
                    isStreaming: false,
                  }))
                );
              }
            } catch (err) {
              console.warn('載入歷史訊息失敗', err);
            }
          };
          loadHistory();
        } else {
          // 情境 2：從 Home 頁面點擊 Agent 卡片，開始新對話
          setMessages([]);
          setSessionId(null);
        }
      }

      // 清除 URL 參數（避免重新整理時重複載入）
      setSearchParams({}, { replace: true });
    }
  }, [loading, agents, searchParams, setSearchParams]);

  // 自動捲動到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 元件卸載時中斷串流
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }
    };
  }, []);

  // 選擇 Agent
  const handleSelectAgent = useCallback(
    (agentId) => {
      // 如果正在串流，先中斷
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }

      const agent = agents.find((a) => a.id === agentId);
      setSelectedAgent(agent);
      setMessages([]);
      setSessionId(null);
      setIsStreaming(false);
      setInputValue('');
    },
    [agents],
  );

  // 選擇 Session（載入歷史訊息）
  const handleSelectSession = useCallback(async (session) => {
    if (!session) return;

    // 如果正在串流，先中斷
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }

    setSessionId(session.sessionId);
    setIsStreaming(false);
    setInputValue('');

    // 載入歷史訊息
    try {
      const res = await chatAPI.sessionDetail(session.sessionId);
      const detail = adaptSessionDetail(res.data);
      if (detail?.messages?.length > 0) {
        setMessages(
          detail.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            time: msg.time || '',
            isStreaming: false,
          }))
        );
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.warn('載入歷史訊息失敗', err);
      setMessages([]);
    }
  }, []);

  // 刪除 Session
  const handleDeleteSession = useCallback(async (sid, e) => {
    e?.stopPropagation();
    try {
      await chatAPI.deleteSession(sid);
      antdMessage.success(t('agentChat.sessionDeleted'));
      // 如果刪除的是當前 session，清空對話
      if (sessionId === sid) {
        setMessages([]);
        setSessionId(null);
      }
      // 重新載入 session 列表
      if (selectedAgent) {
        fetchSessions(selectedAgent.id);
      }
    } catch {
      antdMessage.error(t('agentChat.sessionDeleteFailed'));
    }
  }, [sessionId, selectedAgent, fetchSessions, t]);

  // 新對話
  const handleNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setMessages([]);
    setSessionId(null);
    setIsStreaming(false);
  }, []);

  // 中斷串流
  const handleStopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // ===== 圖片上傳相關 =====
  const handleImageSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_IMAGES = 5;

    // 檢查數量限制
    if (selectedImages.length + files.length > MAX_IMAGES) {
      antdMessage.warning(t('agentChat.maxImagesWarning', { max: MAX_IMAGES }));
      return;
    }

    const validImages = [];
    for (const file of files) {
      // 檢查是否為圖片
      if (!file.type.startsWith('image/')) {
        antdMessage.warning(t('agentChat.notImageFile', { name: file.name }));
        continue;
      }
      // 檢查大小
      if (file.size > MAX_IMAGE_SIZE) {
        antdMessage.warning(t('agentChat.imageTooLarge', { name: file.name }));
        continue;
      }
      // 轉 base64
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

    // 清空 input 以便重複選擇同一檔案
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [selectedImages, t]);

  const handleRemoveImage = useCallback((index) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleOpenFilePicker = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // 發送訊息（Streaming）
  const handleSend = useCallback(() => {
    if ((!inputValue.trim() && selectedImages.length === 0) || !selectedAgent || isStreaming) return;

    const userContent = inputValue.trim() || (selectedImages.length > 0 ? t('agentChat.imageMessage') : '');
    const now = new Date().toLocaleTimeString(timeLocale, {
      hour: '2-digit',
      minute: '2-digit',
    });

    // 加入使用者訊息（含圖片預覽）
    const userMsg = {
      role: 'user',
      content: userContent,
      time: now,
      images: selectedImages.length > 0 ? selectedImages.map((img) => ({ preview: img.preview, name: img.name })) : undefined,
    };

    // 加入空的 assistant 訊息（等待串流填充）
    const assistantMsg = {
      role: 'assistant',
      content: '',
      time: '',
      isStreaming: true,
    };

    // 準備圖片 base64 陣列
    const imageData = selectedImages.length > 0
      ? selectedImages.map((img) => img.base64)
      : undefined;

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputValue('');
    setSelectedImages([]);
    setIsStreaming(true);

    // 呼叫 streaming API
    const abort = chatAPI.stream(
      {
        agent_id: selectedAgent.id,
        message: userContent,
        session_id: sessionId,
        images: imageData,
      },
      // onMessage
      (eventData) => {
        if (eventData.type === 'content') {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: eventData.accumulated || updated[lastIdx].content + (eventData.data || ''),
              };
            }
            return updated;
          });
        } else if (eventData.type === 'complete') {
          const newSessionId = eventData.session_id;
          const newThreadId = eventData.thread_id;

          if (newSessionId) {
            setSessionId(newSessionId);
          } else if (newThreadId) {
            setSessionId(newThreadId);
          }

          const completeTime = new Date().toLocaleTimeString(timeLocale, {
            hour: '2-digit',
            minute: '2-digit',
          });
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: eventData.content || updated[lastIdx].content,
                time: completeTime,
                isStreaming: false,
              };
            }
            return updated;
          });
          setIsStreaming(false);
          abortRef.current = null;

          // 對話完成後重新載入 Session 列表
          if (selectedAgent) {
            fetchSessions(selectedAgent.id);
          }
        }
      },
      // onComplete
      () => {
        setIsStreaming(false);
        abortRef.current = null;
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
            const completeTime = new Date().toLocaleTimeString(timeLocale, {
              hour: '2-digit',
              minute: '2-digit',
            });
            updated[lastIdx] = {
              ...updated[lastIdx],
              time: completeTime,
              isStreaming: false,
            };
          }
          return updated;
        });
      },
      // onError
      (error) => {
        console.error('❌ Chat stream error:', error);
        setIsStreaming(false);
        abortRef.current = null;

        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: t('agentChat.errorReply'),
              time: new Date().toLocaleTimeString(timeLocale, {
                hour: '2-digit',
                minute: '2-digit',
              }),
              isStreaming: false,
              isError: true,
            };
          }
          return updated;
        });

        antdMessage.error(error.message || t('agentChat.errorReply'));
      },
    );

    abortRef.current = abort;
  }, [inputValue, selectedAgent, isStreaming, sessionId, timeLocale, t, fetchSessions, selectedImages]);

  // Loading 狀態
  if (loading) {
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
      <div className="chat-session-panel">
        <div className="session-panel-header">
          <span className="session-panel-title">
            <SelectOutlined style={{ marginRight: 6 }} />
            {t('agentChat.chatSessions')}
          </span>
          {selectedAgent && (
            <Button
              icon={<PlusOutlined />}
              onClick={handleNewChat}
              disabled={isStreaming}
              size="small"
              type="text"
              title={t('agentChat.newChat')}
            />
          )}
        </div>
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
          ) : sessions.length === 0 ? (
            <div className="session-empty-hint">
              {t('agentChat.noSessions')}
            </div>
          ) : (
            sessions.map((session) => (
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
            >
              {t('common.send')}
            </Button>
          )}
        </div>
      </div>

      {/* 右側 Agent 列表（恢復原本樣式） */}
      <div className="chat-agent-panel">
        <div className="agent-panel-header">
          <span className="agent-panel-title">
            {t('agentChat.availableAgents')}
          </span>
          <span className="agent-panel-view-all">{t('common.viewAll')}</span>
        </div>
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
                {agent.iconType === 'image_url' && agent.icon ? (
                  <img src={agent.icon} alt={agent.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                ) : (
                  agent.icon || '🤖'
                )}
              </div>
              <div className="agent-panel-info">
                <div className="agent-panel-name">{agent.name}</div>
                <div className="agent-panel-meta">
                  <span>{agent.model}</span>
                  <Tag
                    color="green"
                    style={{ marginLeft: 6, fontSize: 11 }}
                  >
                    {agent.status}
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
      </div>
    </div>
  );
};

export default AgentChat;
