import pytest
import asyncio
from middleware.types import EventType, GateDecision
from repository.session_repository import SessionRepository
from repository.spend_event_repository import SpendEventRepository

@pytest.mark.asyncio
async def test_rollback_leaves_redis_counters_exact(budget_gate, fake_redis, seeded_entities):
    """
    Test that when a request exceeds budget, all 3 Redis counters are rolled back
    to their exact pre-request values.
    """
    session_id = seeded_entities["session_id"]
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]

    # Initial request under budget: $1.00
    res1 = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=1.00,
    )
    assert res1.event_type == EventType.ALLOW

    # Verify counters pre-rollback
    s_val = float(await fake_redis.get(f"spend:session:{session_id}"))
    a_val = float(await fake_redis.get(f"spend:agent:{agent_id}"))
    t_val = float(await fake_redis.get(f"spend:team:{team_id}"))
    assert (s_val, a_val, t_val) == (1.00, 1.00, 1.00)

    # Next request exceeds session budget ($2.00 limit): attempt $1.50 (total would be $2.50)
    res2 = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=1.50,
    )
    assert res2.event_type == EventType.BLOCK
    assert res2.reason == "session_budget_exceeded"

    # Counters MUST be restored to exactly (1.00, 1.00, 1.00)
    s_val_after = float(await fake_redis.get(f"spend:session:{session_id}"))
    a_val_after = float(await fake_redis.get(f"spend:agent:{agent_id}"))
    t_val_after = float(await fake_redis.get(f"spend:team:{team_id}"))
    assert (s_val_after, a_val_after, t_val_after) == (1.00, 1.00, 1.00)

@pytest.mark.asyncio
async def test_reroute_signal_on_agent_budget_exceeded(budget_gate, fake_redis, seeded_entities):
    """
    Test that exceeding agent budget triggers REROUTE with fallback_model,
    rather than a blocking rejection.
    """
    session_id = "session-unlimited"
    agent_id = seeded_entities["agent_id"]  # budget $5.00, pref: llama-3.3-70b-versatile, fallback: llama-3.1-8b-instant
    team_id = seeded_entities["team_id"]     # budget $10.00

    # Agent budget is $5.00. Attempt $5.50 (with no session budget limit)
    res = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=5.50,
        session_budget_override=100.0,
    )

    assert res.event_type == EventType.REROUTE
    assert res.model_to_use == "llama-3.1-8b-instant"
    assert res.reason == "agent_budget_exceeded"

    # Counters rolled back on reroute so actual spend wasn't recorded prematurely
    a_val = float(await fake_redis.get(f"spend:agent:{agent_id}"))
    assert a_val == 0.0

@pytest.mark.asyncio
async def test_boundary_exactly_80_percent_triggers_warning(budget_gate, seeded_entities):
    """
    Boundary test: spend reaching exactly 80% of agent budget triggers ALLOW with should_warn=True.
    Agent budget = $5.00 -> 80% = $4.00.
    """
    session_id = "session-boundary-80"
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]

    res = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=4.00,
        session_budget_override=100.0,
    )

    assert res.should_warn is True
    assert res.event_type in (EventType.WARN, EventType.ALLOW, EventType.PAUSE)
    assert res.model_to_use == "llama-3.3-70b-versatile"

@pytest.mark.asyncio
async def test_boundary_exactly_100_percent_and_cent_under_over(budget_gate, seeded_entities):
    """
    Boundary tests:
    - Exactly 100% of session budget ($2.00): allowed.
    - One cent over session budget ($2.01 total): blocked.
    """
    session_id = seeded_entities["session_id"]  # budget $2.00
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]

    # 1. Exactly $2.00 -> ALLOW
    res_100 = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=2.00,
    )
    assert res_100.event_type in (EventType.ALLOW, EventType.WARN, EventType.PAUSE)

    # 2. 1 cent over -> $0.01 more -> total would be $2.01 -> BLOCK
    res_over = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=0.01,
    )
    assert res_over.event_type == EventType.BLOCK
    assert res_over.reason == "session_budget_exceeded"

@pytest.mark.asyncio
async def test_boundary_one_cent_under_and_over_agent_budget(budget_gate, fake_redis, seeded_entities):
    """
    Boundary tests for agent budget ($5.00):
    - $4.99 (one cent under): ALLOW
    - $0.02 more (total $5.01, one cent over): REROUTE
    """
    session_id = "sess-agent-boundary"
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]

    # $4.99 -> ALLOW
    res_under = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=4.99,
        session_budget_override=100.0,
    )
    assert res_under.event_type in (EventType.ALLOW, EventType.WARN, EventType.PAUSE)

    # $0.02 more -> total $5.01 -> REROUTE
    res_over = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=0.02,
        session_budget_override=100.0,
    )
    assert res_over.event_type == EventType.REROUTE

@pytest.mark.asyncio
async def test_reconcile_spend_adjusts_redis_and_db(budget_gate, fake_redis, session_factory, seeded_entities):
    """
    Test reconciliation adjusts Redis counters by diff (actual - estimate)
    and updates matching SpendEvent in PostgreSQL.
    """
    session_id = seeded_entities["session_id"]
    agent_id = seeded_entities["agent_id"]
    team_id = seeded_entities["team_id"]

    # Initial reserve with estimate = $0.50
    decision = await budget_gate.check_and_reserve(
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=0.50,
    )
    await asyncio.sleep(0.05)  # allow background DB write to finish

    spend_event_id = decision.spend_event_id

    # Post-call actual cost is $0.70 (tokens in: 1000, tokens out: 500) -> diff = +0.20
    diff = await budget_gate.reconcile_spend(
        spend_event_id=spend_event_id,
        session_id=session_id,
        agent_id=agent_id,
        team_id=team_id,
        estimated_cost_usd=0.50,
        actual_tokens_in=1000,
        actual_tokens_out=500,
        actual_cost_usd=0.70,
        model_used="llama-3.3-70b-versatile",
    )
    assert round(diff, 2) == 0.20

    # Redis counter should now reflect $0.70
    s_val = float(await fake_redis.get(f"spend:session:{session_id}"))
    assert round(s_val, 2) == 0.70

    # DB SpendEvent should be updated with actuals
    if spend_event_id:
        await asyncio.sleep(0.05)
        async with session_factory() as db_session:
            repo = SpendEventRepository(db_session)
            event = await repo.get_by_id(spend_event_id)
            assert event is not None
            assert event.tokens_in == 1000
            assert event.tokens_out == 500
            assert round(event.cost_usd, 2) == 0.70
