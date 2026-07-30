import pytest
import pytest_asyncio
import asyncio
from httpx import AsyncClient, ASGITransport
import fakeredis.aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from database import get_db_session
from middleware.budget_gate import BudgetGate
from app.adapters.groq_adapter import GroqAdapter

@pytest_asyncio.fixture
async def async_client(fake_redis, session_factory):
    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_get_db

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
async def test_demo_run_produces_all_four_outcomes_deterministically(async_client):
    """
    Test calling POST /demo/run with small values (e.g. 4 agents, 3 requests each)
    and assert that the summary contains at least one event of each type:
    (allow, warn, block, reroute).
    """
    payload = {
        "num_agents": 5,
        "requests_per_agent": 3,
        "team_budget_usd": 2.00,
        "agent_budget_usd": 0.30,
        "session_budget_usd": 0.05,
        "concurrency": True,
    }

    response = await async_client.post("/demo/run", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    assert "team_id" in data
    assert "agents" in data
    assert len(data["agents"]) >= 4

    # Aggregate outcome totals across all agents
    all_outcomes = {"allow": 0, "warn": 0, "block": 0, "reroute": 0}
    for agent in data["agents"]:
        oc = agent.get("outcomes", {})
        for k in all_outcomes:
            all_outcomes[k] += oc.get(k, 0)

    # Assert that the scenario produces all 4 outcome types deterministically
    assert all_outcomes["allow"] > 0, "Expected at least one ALLOW outcome"
    assert all_outcomes["warn"] > 0, "Expected at least one WARN outcome"
    assert all_outcomes["block"] > 0, "Expected at least one BLOCK outcome"
    assert all_outcomes["reroute"] > 0, "Expected at least one REROUTE outcome"

    # Assert summary section schema
    summary = data["summary"]
    assert "total_requests" in summary
    assert summary["total_requests"] > 0
    assert "total_spend_usd" in summary
    assert "any_budget_exceeded" in summary
    assert summary["any_budget_exceeded"] is False
    assert "duration_seconds" in summary


@pytest.mark.asyncio
async def test_demo_cleanup_endpoint(async_client):
    """
    Test calling DELETE /demo/cleanup removes all demo-* teams, agents, sessions,
    and associated spend events.
    """
    # 1. First run demo
    run_resp = await async_client.post("/demo/run", json={"num_agents": 4, "requests_per_agent": 2})
    assert run_resp.status_code == 200

    # 2. Call cleanup
    cleanup_resp = await async_client.delete("/demo/cleanup")
    assert cleanup_resp.status_code == 200
    cleanup_data = cleanup_resp.json()
    assert cleanup_data["status"] == "success"

    # 3. Verify spend counters reset in dashboard
    dash_resp = await async_client.get("/dashboard/spend")
    assert dash_resp.status_code == 200
