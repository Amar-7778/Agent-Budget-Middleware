import pytest
import pytest_asyncio
import asyncio

from httpx import AsyncClient, ASGITransport
import fakeredis.aioredis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from models.base import Base
from middleware.budget_gate import BudgetGate
from app.adapters.groq_adapter import GroqAdapter
from app.main import app

from database import get_db_session

@pytest_asyncio.fixture
async def async_client(fake_redis, session_factory):
    # Override database session dependency to use test in-memory SQLite session factory
    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_get_db

    # Attach dependencies to app.state
    gate = BudgetGate(
        redis_client=fake_redis,
        session_factory=session_factory,
        warning_percentage=0.80,
    )
    groq_adapter = GroqAdapter(api_key="mock_key")

    app.state.redis = fake_redis
    app.state.budget_gate = gate
    app.state.groq_adapter = groq_adapter

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_health_live_endpoint(async_client):
    response = await async_client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "live"}

@pytest.mark.asyncio
async def test_health_readiness_endpoint(async_client):
    response = await async_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["redis"] == "ok"
    assert data["postgres"] == "ok"

@pytest.mark.asyncio
async def test_budget_crud_and_chat_flow(async_client):
    # 1. Create Team ($100 budget)
    team_resp = await async_client.post("/budgets/teams", json={
        "name": "Data Science",
        "monthly_budget_usd": 100.0,
    })
    assert team_resp.status_code == 201
    team_id = team_resp.json()["id"]

    # 2. Create Agent ($10 budget, preferred: llama-3.3-70b-versatile, fallback: llama-3.1-8b-instant)
    agent_resp = await async_client.post("/budgets/agents", json={
        "team_id": team_id,
        "name": "Research Agent",
        "monthly_budget_usd": 10.0,
        "preferred_model": "llama-3.3-70b-versatile",
        "fallback_model": "llama-3.1-8b-instant",
    })
    assert agent_resp.status_code == 201
    agent_id = agent_resp.json()["id"]

    # 3. Create Session ($2 budget)
    sess_resp = await async_client.post("/budgets/sessions", json={
        "agent_id": agent_id,
        "budget_usd": 2.0,
    })
    assert sess_resp.status_code == 201
    session_id = sess_resp.json()["id"]

    # 4. Call /v1/chat
    headers = {"x-correlation-id": "test-corr-id-123"}
    chat_resp = await async_client.post("/v1/chat", json={
        "session_id": session_id,
        "agent_id": agent_id,
        "message": "Explain quantum entanglement briefly.",
    }, headers=headers)

    assert chat_resp.status_code == 200
    chat_data = chat_resp.json()
    assert "Mock response" in chat_data["response"]
    assert chat_data["model_used"] == "llama-3.3-70b-versatile"
    assert chat_data["event_type"] in ("allow", "warn")
    assert chat_data["correlation_id"] == "test-corr-id-123"

    # Allow background spend event save task to commit
    await asyncio.sleep(0.05)

    # 5. Check Dashboard Spend
    dash_resp = await async_client.get("/dashboard/spend")
    assert dash_resp.status_code == 200
    dash_data = dash_resp.json()
    assert len(dash_data["teams"]) >= 1
    assert len(dash_data["agents"]) >= 1

    # 6. Check Audit Logs (ensure background task completes)
    if hasattr(app.state, "budget_gate") and app.state.budget_gate._background_tasks:
        await asyncio.gather(*list(app.state.budget_gate._background_tasks))

    audit_resp = await async_client.get("/audit", params={"agent_id": agent_id})
    assert audit_resp.status_code == 200
    audit_logs = audit_resp.json()
    assert len(audit_logs) >= 1
    assert audit_logs[0]["agent_id"] == agent_id





@pytest.mark.asyncio
async def test_chat_budget_blocked(async_client):
    # Create Agent with tiny budget ($0.00001)
    team_resp = await async_client.post("/budgets/teams", json={"name": "Tiny Team", "monthly_budget_usd": 1.0})
    team_id = team_resp.json()["id"]

    agent_resp = await async_client.post("/budgets/agents", json={
        "team_id": team_id,
        "name": "Tiny Agent",
        "monthly_budget_usd": 1.0,
    })
    agent_id = agent_resp.json()["id"]

    # Session with tiny budget ($0.00001)
    sess_resp = await async_client.post("/budgets/sessions", json={
        "agent_id": agent_id,
        "budget_usd": 0.00001,
    })
    session_id = sess_resp.json()["id"]

    # Call chat -> should be blocked
    chat_resp = await async_client.post("/v1/chat", json={
        "session_id": session_id,
        "agent_id": agent_id,
        "message": "This request exceeds tiny session budget.",
    })
    assert chat_resp.status_code == 429
    detail = chat_resp.json()["detail"]
    assert detail["error"] == "Budget limit exceeded"
    assert detail["reason"] == "session_budget_exceeded"

@pytest.mark.asyncio
async def test_ui_endpoints(async_client):
    resp_root = await async_client.get("/")
    assert resp_root.status_code == 200
    assert "Agent Budget Middleware" in resp_root.text

    resp_ui = await async_client.get("/ui")
    assert resp_ui.status_code == 200
    assert "Agent Budget Middleware" in resp_ui.text

@pytest.mark.asyncio
async def test_demo_scenario_endpoints(async_client):
    # Test POST /demo/run
    run_resp = await async_client.post("/demo/run", json={"num_agents": 4, "requests_per_agent": 2})
    assert run_resp.status_code == 200
    data = run_resp.json()
    assert "team_id" in data
    assert "agents" in data
    assert "summary" in data

    # Test DELETE /demo/cleanup
    cleanup_resp = await async_client.delete("/demo/cleanup")
    assert cleanup_resp.status_code == 200
    cleanup_data = cleanup_resp.json()
    assert cleanup_data["status"] == "success"



