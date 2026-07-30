import pytest
import asyncio
from middleware.types import EventType

@pytest.mark.asyncio
async def test_concurrency_50_plus_simultaneous_calls(budget_gate, fake_redis, seeded_entities):
    """
    Concurrency test:
    Fires 60 simultaneous calls (via asyncio.gather) to budget_gate for one agent
    against a tight agent budget of $1.00.

    Asserts:
    1. Total recorded spend in Redis never exceeds budget by more than one request's worth.
    2. Over-budget requests are correctly rolled back or rerouted.
    """
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]
    session_id = "sess-concurrency"

    agent_budget = 1.00
    request_estimate = 0.10  # 10 requests allowed before hitting $1.00 limit

    # Disable runaway detector for concurrency testing of core budgeting limits
    budget_gate.runaway_enabled = False

    async def single_call(index: int):
        return await budget_gate.check_and_reserve(
            session_id=f"{session_id}-{index}",
            agent_id=agent_id,
            team_id=team_id,
            estimated_cost_usd=request_estimate,
            session_budget_override=100.0,
            agent_budget_override=agent_budget,
            team_budget_override=100.0,
        )

    # Launch 60 concurrent requests
    num_requests = 60
    tasks = [single_call(i) for i in range(num_requests)]
    results = await asyncio.gather(*tasks)

    # Classify results
    allowed = [r for r in results if r.event_type in (EventType.ALLOW, EventType.WARN)]
    rerouted = [r for r in results if r.event_type == EventType.REROUTE]

    # Total spend approved must not exceed agent_budget + request_estimate
    approved_spend = len(allowed) * request_estimate

    # 1. Total approved spend must be <= agent_budget + 1 request's worth
    assert approved_spend <= agent_budget + request_estimate, (
        f"Approved spend ${approved_spend:.2f} exceeded limit ${agent_budget:.2f} "
        f"by more than one request's worth (${request_estimate:.2f})"
    )

    # 2. Redis final agent spend counter must equal approved_spend
    final_redis_spend = float(await fake_redis.get(f"spend:agent:{agent_id}") or 0.0)
    assert round(final_redis_spend, 4) == round(approved_spend, 4), (
        f"Redis counter state ({final_redis_spend}) does not match approved spend ({approved_spend})"
    )

    # 3. Exactly 10 requests should be allowed ($1.00 / $0.10 = 10), remaining 50 should be rerouted
    assert len(allowed) == 10
    assert len(rerouted) == 50
