import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { agentAPI, chatAPI } from '../services/api';
import { adaptAgents, adaptSessionList, adaptSessionDetail } from '../utils/adapters';
import { agents as mockAgents } from '../data/mockData';

const ChatContext = createContext(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

export const ChatProvider = ({ children }) => {
  // ── Agent 列表 ──────────────────────────────────────────────
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);

  // ── Session 列表 ─────────────────────────────────────────────
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // ── 對話狀態 ─────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // ── 圖片上傳狀態 ─────────────────────────────────────────────
  const [selectedImages, setSelectedImages] = useState([]);

  // ── Refs ─────────────────────────────────────────────────────
  // abortRef 存放中斷串流的函式，不放進 state 避免觸發 re-render
  const abortRef = useRef(null);

  // ── 載入 Agent 列表（只在 Provider 掛載時執行一次）──────────
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await agentAPI.list();
        setAgents(adaptAgents(res.data));
      } catch (err) {
        console.warn('Agent API 失敗，使用 mock 資料', err);
        setAgents(mockAgents);
      } finally {
        setAgentsLoading(false);
      }
    };
    fetchAgents();
  }, []);

  // ── 當選擇 Agent 時載入該 Agent 的 Session 列表 ──────────────
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

  // ── 選擇 Agent ───────────────────────────────────────────────
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
      setSelectedImages([]);
    },
    [agents],
  );

  // ── 選擇 Session（載入歷史訊息）─────────────────────────────
  const handleSelectSession = useCallback(async (session) => {
    if (!session) return;

    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }

    setSessionId(session.sessionId);
    setIsStreaming(false);
    setSelectedImages([]);

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

  // ── 從 URL 參數載入（供 AgentChat 呼叫）─────────────────────
  // 回傳 Promise，讓 AgentChat 知道何時完成
  const loadFromUrlParams = useCallback(
    async (urlAgent, urlSession) => {
      if (!urlAgent || agents.length === 0) return;

      const agent = agents.find((a) => a.id === urlAgent);
      if (!agent) return;

      // 若已是同一個 agent + session，不重複載入
      if (
        selectedAgent?.id === urlAgent &&
        sessionId === urlSession
      ) return;

      setSelectedAgent(agent);

      if (urlSession) {
        setSessionId(urlSession);
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
      } else {
        // 新對話：只有在切換 agent 時才清空
        if (selectedAgent?.id !== urlAgent) {
          setMessages([]);
          setSessionId(null);
        }
      }
    },
    [agents, selectedAgent, sessionId],
  );

  // ── 刪除 Session ─────────────────────────────────────────────
  const handleDeleteSession = useCallback(
    async (sid) => {
      await chatAPI.deleteSession(sid);
      if (sessionId === sid) {
        setMessages([]);
        setSessionId(null);
      }
      if (selectedAgent) {
        fetchSessions(selectedAgent.id);
      }
    },
    [sessionId, selectedAgent, fetchSessions],
  );

  // ── 新對話 ───────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setMessages([]);
    setSessionId(null);
    setIsStreaming(false);
    setSelectedImages([]);
  }, []);

  // ── 中斷串流 ─────────────────────────────────────────────────
  const handleStopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // ── 發送訊息（Streaming）────────────────────────────────────
  const handleSend = useCallback(
    (inputValue, timeLocale, t) => {
      if ((!inputValue.trim() && selectedImages.length === 0) || !selectedAgent || isStreaming) return;

      const userContent =
        inputValue.trim() || (selectedImages.length > 0 ? t('agentChat.imageMessage') : '');
      const now = new Date().toLocaleTimeString(timeLocale, {
        hour: '2-digit',
        minute: '2-digit',
      });

      const userMsg = {
        role: 'user',
        content: userContent,
        time: now,
        images:
          selectedImages.length > 0
            ? selectedImages.map((img) => ({ preview: img.preview, name: img.name }))
            : undefined,
      };

      const assistantMsg = {
        role: 'assistant',
        content: '',
        time: '',
        isStreaming: true,
      };

      const imageData =
        selectedImages.length > 0 ? selectedImages.map((img) => img.base64) : undefined;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

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
                  content:
                    eventData.accumulated ||
                    updated[lastIdx].content + (eventData.data || ''),
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
            if (
              lastIdx >= 0 &&
              updated[lastIdx].role === 'assistant' &&
              updated[lastIdx].isStreaming
            ) {
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
        },
      );

      abortRef.current = abort;
    },
    [selectedAgent, isStreaming, sessionId, selectedImages, fetchSessions],
  );

  const value = {
    // Agent
    agents,
    agentsLoading,
    selectedAgent,
    handleSelectAgent,

    // Session
    sessions,
    sessionsLoading,
    sessionId,
    fetchSessions,
    handleSelectSession,
    handleDeleteSession,

    // 對話
    messages,
    isStreaming,
    handleSend,
    handleNewChat,
    handleStopStreaming,

    // 圖片
    selectedImages,
    setSelectedImages,

    // URL 參數載入
    loadFromUrlParams,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export default ChatContext;
