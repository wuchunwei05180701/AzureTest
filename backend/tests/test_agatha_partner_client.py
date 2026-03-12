"""
Tests for Agatha Partner API Client
RED phase: These tests should define expected behavior
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx


# ============================================================
# Unit Tests: agatha_partner_client
# ============================================================


@pytest.fixture
def mock_response():
    """Create a mock httpx.Response"""
    def _make(status_code=200, json_data=None, text=""):
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = status_code
        resp.json.return_value = json_data or {}
        resp.text = text
        resp.raise_for_status = MagicMock()
        if status_code >= 400:
            resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                f"{status_code}", request=MagicMock(), response=resp
            )
        return resp
    return _make


@pytest.fixture
def mock_client(mock_response):
    """Mock the httpx.AsyncClient"""
    client = AsyncMock(spec=httpx.AsyncClient)
    client.is_closed = False
    return client


class TestListAgents:
    @pytest.mark.asyncio
    async def test_returns_agents_list(self, mock_client, mock_response):
        agents_data = {
            "agents": [
                {"agent_id": "abc123", "name": "steven", "agent_type": "autogen"},
                {"agent_id": "def456", "name": "steven2", "agent_type": "autogen"},
            ],
            "total": 2,
        }
        mock_client.get = AsyncMock(return_value=mock_response(200, agents_data))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import list_agents
            result = await list_agents()

        assert len(result) == 2
        assert result[0]["name"] == "steven"
        assert result[1]["name"] == "steven2"

    @pytest.mark.asyncio
    async def test_returns_empty_on_no_agents(self, mock_client, mock_response):
        mock_client.get = AsyncMock(return_value=mock_response(200, {"agents": [], "total": 0}))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import list_agents
            result = await list_agents()

        assert result == []

    @pytest.mark.asyncio
    async def test_raises_on_server_error(self, mock_client, mock_response):
        mock_client.get = AsyncMock(return_value=mock_response(500))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import list_agents
            with pytest.raises(httpx.HTTPStatusError):
                await list_agents()


class TestGetAgent:
    @pytest.mark.asyncio
    async def test_returns_agent_detail(self, mock_client, mock_response):
        agent_data = {"agent_id": "abc123", "name": "steven", "agent_type": "autogen"}
        mock_client.get = AsyncMock(return_value=mock_response(200, agent_data))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import get_agent
            result = await get_agent("abc123")

        assert result["name"] == "steven"

    @pytest.mark.asyncio
    async def test_returns_none_on_404(self, mock_client, mock_response):
        mock_client.get = AsyncMock(return_value=mock_response(404))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import get_agent
            result = await get_agent("nonexistent")

        assert result is None


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_session_with_required_fields(self, mock_client, mock_response):
        session_data = {"session_id": "sess_abc123", "agent_id": "abc123"}
        mock_client.post = AsyncMock(return_value=mock_response(200, session_data))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import create_session
            result = await create_session(agent_id="abc123", external_user_id="user@test.com")

        assert result["session_id"] == "sess_abc123"
        # Verify the payload includes external_user_id
        call_args = mock_client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json")
        assert payload["external_user_id"] == "user@test.com"
        assert payload["agent_id"] == "abc123"

    @pytest.mark.asyncio
    async def test_creates_session_with_metadata(self, mock_client, mock_response):
        session_data = {"session_id": "sess_abc123"}
        mock_client.post = AsyncMock(return_value=mock_response(200, session_data))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import create_session
            await create_session(
                agent_id="abc123",
                external_user_id="user@test.com",
                metadata={"country": "TW"},
            )

        call_args = mock_client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json")
        assert payload["metadata"] == {"country": "TW"}

    @pytest.mark.asyncio
    async def test_raises_on_422(self, mock_client, mock_response):
        mock_client.post = AsyncMock(return_value=mock_response(422))

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import create_session
            with pytest.raises(httpx.HTTPStatusError):
                await create_session(agent_id="abc123", external_user_id="")


class TestChatStream:
    @pytest.mark.asyncio
    async def test_sends_correct_payload(self, mock_client):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_client.build_request = MagicMock(return_value=MagicMock())
        mock_client.send = AsyncMock(return_value=mock_resp)

        with patch("services.agatha_partner_client._get_client", return_value=mock_client):
            from services.agatha_partner_client import chat_stream
            result = await chat_stream("sess_abc123", "hello")

        assert result.status_code == 200
        # Verify build_request was called with correct path
        build_args = mock_client.build_request.call_args
        assert build_args[0][0] == "POST"
        assert "/sessions/sess_abc123/chat" in build_args[0][1]


class TestAgentApiEndpoint:
    """Test the agent_api.py endpoint transforms Partner API data correctly"""

    @pytest.mark.asyncio
    async def test_partner_agent_to_response(self):
        from api.agent_api import _partner_agent_to_response

        agent = {
            "agent_id": "abc123",
            "name": "steven",
            "description": "test agent",
            "agent_type": "autogen",
            "icon": None,
            "capabilities": {"streaming": True, "multi_turn": True},
        }

        result = _partner_agent_to_response(agent)

        assert result.agent_id == "abc123"
        assert result.name == "steven"
        assert result.description == "test agent"
        assert result.is_published is True
        assert result.agent_config_json["agatha_enabled"] is True
        assert result.agent_config_json["agent_type"] == "autogen"
