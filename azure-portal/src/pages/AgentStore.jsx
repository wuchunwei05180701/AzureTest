import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Tag, Spin, Empty, Button } from 'antd';
import {
  RobotOutlined,
  SearchOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { agentAPI } from '../services/api';
import { adaptAgents } from '../utils/adapters';
import { agents as mockAgents } from '../data/mockData';
import { useLanguage } from '../contexts/LanguageContext';
import './AgentStore.css';

const AgentStore = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

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

  // 搜尋過濾
  const filteredAgents = agents.filter((agent) => {
    if (!searchText.trim()) return true;
    const keyword = searchText.toLowerCase();
    return (
      agent.name?.toLowerCase().includes(keyword) ||
      agent.description?.toLowerCase().includes(keyword) ||
      agent.model?.toLowerCase().includes(keyword)
    );
  });

  // 點擊 Agent 卡片 → 導航到對話頁
  const handleSelectAgent = (agent) => {
    navigate(`/agent-store/chat?agent=${agent.id}`);
  };

  if (loading) {
    return (
      <div className="agent-store-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip={t('agentStore.loading')} />
      </div>
    );
  }

  return (
    <div className="agent-store-page">
      {/* 頁面標題 + 搜尋 */}
      <div className="agent-store-header">
        <div className="agent-store-title-row">
          <h2 className="agent-store-title">
            <RobotOutlined style={{ marginRight: 10 }} />
            {t('agentStore.title')}
          </h2>
          <span className="agent-store-count">
            {t('agentStore.totalAgents', { count: filteredAgents.length })}
          </span>
        </div>
        <Input
          placeholder={t('agentStore.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          className="agent-store-search"
        />
      </div>

      {/* 卡牌 Grid */}
      {filteredAgents.length === 0 ? (
        <Empty
          description={searchText ? t('agentStore.noResults') : t('agentStore.noAgents')}
          style={{ marginTop: 80 }}
        />
      ) : (
        <div className="agent-store-grid">
          {filteredAgents.map((agent) => (
            <div
              key={agent.id}
              className="agent-card"
              onClick={() => handleSelectAgent(agent)}
            >
              {/* 卡片頂部色帶 */}
              <div
                className="agent-card-color-bar"
                style={{ background: agent.color || '#2aabb3' }}
              />

              {/* Icon */}
              <div
                className="agent-card-icon"
                style={{
                  background: (agent.color || '#2aabb3') + '15',
                  color: agent.color || '#2aabb3',
                }}
              >
                {agent.iconType === 'image_url' && agent.icon ? (
                  <img src={agent.icon} alt={agent.name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  agent.icon || '🤖'
                )}
              </div>

              {/* 名稱 */}
              <div className="agent-card-name">{agent.name}</div>

              {/* 描述 */}
              <div className="agent-card-description">
                {agent.description || t('agentStore.noDescription')}
              </div>

              {/* 底部資訊 */}
              <div className="agent-card-footer">
                <div className="agent-card-tags">
                  <Tag color="blue" style={{ fontSize: 11 }}>{agent.model}</Tag>
                  <Tag color="green" style={{ fontSize: 11 }}>{agent.status}</Tag>
                </div>
                <Button
                  type="primary"
                  size="small"
                  icon={<MessageOutlined />}
                  className="agent-card-chat-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectAgent(agent);
                  }}
                >
                  {t('agentStore.startChat')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentStore;
