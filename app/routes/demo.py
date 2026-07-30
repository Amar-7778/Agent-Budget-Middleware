import uuid
import time
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from redis.asyncio import Redis

from database import get_db_session
from app.config import settings
from models.team import Team
from models.agent import Agent
from models.session import Session
from models.spend_event import SpendEvent
from repository.team_repository import TeamRepository
from repository.agent_repository import AgentRepository
from repository.session_repository import SessionRepository
from repository.spend_event_repository import SpendEventRepository
from middleware.budget_gate import BudgetGate
from middleware.types import EventType
from app.adapters.groq_adapter import GroqAdapter
from app.logger import get_logger, correlation_id_ctx

logger = get_logger("demo_route")
router = APIRouter(prefix="/demo", tags=["Demo Scenario Studio"])

class DemoRunRequest(BaseModel):
    num_agents: int = Field(default=5, ge=1, le=20, description="Number of demo agents to provision")
    requests_per_agent: int = Field(default=15, ge=1, le=50, description="Total requests to send per agent (bucket 5+)")
    team_budget_usd: float = Field(default=2.00, gt=0, description="Team monthly budget in USD")
    agent_budget_usd: float = Field(default=0.30, gt=0, description="Default agent monthly budget in USD")
    session_budget_usd: float = Field(default=0.05, gt=0, description="Default per-session budget cap in USD")
    concurrency: bool = Field(default=True, description="Execute requests concurrently via asyncio.gather")


@router.post("/run", status_code=status.HTTP_200_OK)
async def run_demo_scenario(
    payload: Optional[DemoRunRequest] = None,
    request: Request = None,
    db: AsyncSession = Depends(get_db_session),
):
    if payload is None:
        payload = DemoRunRequest()

    start_time = time.perf_counter()

    redis: Redis = request.app.state.redis
    budget_gate: BudgetGate = request.app.state.budget_gate
    groq_adapter: GroqAdapter = request.app.state.groq_adapter

    pref_model = settings.GROQ_PREFERRED_MODEL
    fall_model = settings.GROQ_FALLBACK_MODEL

    # 1. Provision Demo Team
    team_id = f"demo-team-{uuid.uuid4().hex[:8]}"
    team_name = "demo-team"
    t_repo = TeamRepository(db)
    team = Team(id=team_id, name=team_name, monthly_budget_usd=payload.team_budget_usd)
    await t_repo.create(team)

    a_repo = AgentRepository(db)
    s_repo = SessionRepository(db)

    agents_list = []
    sessions_list = []

    # 2. Provision Agents & Sessions with deliberate budget design per outcome bucket
    for i in range(1, payload.num_agents + 1):
        agent_id = f"demo-agent-{i}-{uuid.uuid4().hex[:6]}"
        agent_name = f"demo-agent-{i}"

        if i == 1:
            # agent-1: ALLOW bucket -> normal agent budget, normal session budget
            m_budget = payload.agent_budget_usd
            s_budget = payload.session_budget_usd
        elif i == 2:
            # agent-2: WARN bucket -> tiny monthly budget ($0.00015) so 1st request crosses 80% warning
            m_budget = 0.00015
            s_budget = payload.session_budget_usd
        elif i == 3:
            # agent-3: BLOCK bucket -> tiny session budget ($0.00001) so request gets blocked & session closed
            m_budget = 10.00
            s_budget = 0.00001
        elif i == 4:
            # agent-4: REROUTE bucket -> tiny agent monthly budget ($0.00001), large session budget ($10.00) so reroute to fallback occurs
            m_budget = 0.00001
            s_budget = 10.00
        else:
            # agent-5+: Concurrent batch testing atomic counters
            m_budget = payload.agent_budget_usd
            s_budget = payload.session_budget_usd

        agent = Agent(
            id=agent_id,
            team_id=team_id,
            name=agent_name,
            monthly_budget_usd=m_budget,
            preferred_model=pref_model,
            fallback_model=fall_model,
        )
        await a_repo.create(agent)
        agents_list.append((agent, m_budget))

        sess_id = f"demo-sess-{i}-{uuid.uuid4().hex[:6]}"
        sess = Session(
            id=sess_id,
            agent_id=agent_id,
            budget_usd=s_budget,
            status="active",
        )
        await s_repo.create(sess)
        sessions_list.append(sess)

    # 3. Build Workload Tasks
    # Short prompts to optimize execution time while hitting provider
    sample_prompts = [
        "Explain AI governance briefly.",
        "Summarize python concurrency.",
        "Draft customer greeting.",
        "What is quantum computing?",
        "Write hello world in python."
    ]

    all_tasks = []

    async def execute_single_request(agent_obj: Agent, sess_obj: Session, prompt_text: str):
        cid = str(uuid.uuid4())
        correlation_id_ctx.set(cid)

        estimated_cost = groq_adapter.estimate_cost(prompt_text, agent_obj.preferred_model)

        decision = await budget_gate.check_and_reserve(
            session_id=sess_obj.id,
            agent_id=agent_obj.id,
            team_id=team_id,
            estimated_cost_usd=estimated_cost,
            preferred_model=agent_obj.preferred_model,
            fallback_model=agent_obj.fallback_model,
        )

        if decision.event_type == EventType.BLOCK:
            return

        model_to_use = decision.model_to_use

        try:
            resp_text, tokens_in, tokens_out, actual_cost = await groq_adapter.call_llm(
                prompt=prompt_text, model=model_to_use
            )
        except Exception as exc:
            logger.warning("Groq call failed in demo run", error=str(exc))
            resp_text = "Demo generated response."
            tokens_in = 10
            tokens_out = 20
            actual_cost = estimated_cost

        await budget_gate.reconcile_spend(
            spend_event_id=decision.spend_event_id,
            session_id=sess_obj.id,
            agent_id=agent_obj.id,
            team_id=team_id,
            estimated_cost_usd=estimated_cost,
            actual_tokens_in=tokens_in,
            actual_tokens_out=tokens_out,
            actual_cost_usd=actual_cost,
            model_used=model_to_use,
        )

    # Prepare workload per agent bucket
    for idx, (agent_obj, _) in enumerate(agents_list):
        sess_obj = sessions_list[idx]
        agent_num = idx + 1

        if agent_num == 1:
            # agent-1: 2 short requests
            req_count = 2
        elif agent_num == 2:
            # agent-2: 2 requests to trigger warning
            req_count = 2
        elif agent_num == 3:
            # agent-3: 1 request to trigger block
            req_count = 1
        elif agent_num == 4:
            # agent-4: 1 request to trigger reroute
            req_count = 1
        else:
            # agent-5+: requests_per_agent
            req_count = min(payload.requests_per_agent, 10)

        for r in range(req_count):
            prompt = sample_prompts[r % len(sample_prompts)]
            all_tasks.append(execute_single_request(agent_obj, sess_obj, prompt))

    # 4. Dispatch Traffic (Concurrent vs Sequential)
    if payload.concurrency:
        await asyncio.gather(*all_tasks)
    else:
        for t in all_tasks:
            await t

    # Wait for background DB spend event tasks to persist
    if hasattr(budget_gate, "_background_tasks") and budget_gate._background_tasks:
        await asyncio.gather(*list(budget_gate._background_tasks), return_exceptions=True)
    await asyncio.sleep(0.05)

    # 5. Query REAL SpendEvent table in Postgres & Redis counters
    agent_summaries = []
    total_system_requests = 0
    total_system_spend = 0.0
    any_budget_exceeded = False

    for idx, (agent_obj, budget_usd) in enumerate(agents_list):
        agent_id = agent_obj.id

        # Query Postgres spend_events table for actual counts
        stmt = (
            select(
                SpendEvent.event_type,
                func.count(SpendEvent.id).label("cnt"),
                func.coalesce(func.sum(SpendEvent.cost_usd), 0.0).label("sum_cost")
            )
            .where(SpendEvent.agent_id == agent_id)
            .group_by(SpendEvent.event_type)
        )
        res = await db.execute(stmt)
        rows = res.all()

        outcome_counts = {"allow": 0, "warn": 0, "block": 0, "reroute": 0}
        pg_spend = 0.0
        agent_total_requests = 0

        for r in rows:
            ev_type = r.event_type.lower()
            cnt = r.cnt
            outcome_counts[ev_type] = cnt
            agent_total_requests += cnt
            pg_spend += float(r.sum_cost)

        # Read Redis counter for live spend
        raw_val = await redis.get(f"spend:agent:{agent_id}")
        redis_spend = round(float(raw_val), 6) if raw_val is not None else round(pg_spend, 6)

        final_spend = max(redis_spend, round(pg_spend, 6))

        # Check if budget was illegally exceeded by more than 1 single call allowance ($0.05)
        if final_spend > round(budget_usd + 0.05, 6):
            any_budget_exceeded = True

        total_system_requests += agent_total_requests
        total_system_spend += final_spend

        agent_summaries.append({
            "agent_id": agent_id,
            "name": agent_obj.name,
            "requests_sent": agent_total_requests,
            "outcomes": outcome_counts,
            "final_spend_usd": final_spend,
            "budget_usd": budget_usd,
        })

    duration_seconds = round(time.perf_counter() - start_time, 2)

    return {
        "team_id": team_id,
        "agents": agent_summaries,
        "summary": {
            "total_requests": total_system_requests,
            "total_spend_usd": round(total_system_spend, 6),
            "any_budget_exceeded": any_budget_exceeded,
            "duration_seconds": duration_seconds,
        }
    }


@router.delete("/cleanup", status_code=status.HTTP_200_OK)
async def cleanup_demo_scenario(
    request: Request = None,
    db: AsyncSession = Depends(get_db_session),
):
    redis: Redis = request.app.state.redis

    # 1. Delete all demo teams, agents, sessions, spend_events from DB
    try:
        # Delete demo spend events
        sub_agents = select(Agent.id).where(Agent.name.like("demo-%"))
        sub_teams = select(Team.id).where(Team.name.like("demo-%"))

        await db.execute(delete(SpendEvent).where(
            (SpendEvent.agent_id.in_(sub_agents)) | (SpendEvent.team_id.in_(sub_teams))
        ))
        await db.execute(delete(Session).where(Session.agent_id.in_(sub_agents)))
        await db.execute(delete(Agent).where(Agent.name.like("demo-%")))
        await db.execute(delete(Team).where(Team.name.like("demo-%")))
        await db.commit()
    except Exception as exc:
        logger.warning("DB cleanup warning", error=str(exc))

    # 2. Flush spend counter keys in Redis
    keys_deleted = 0
    try:
        keys = await redis.keys("spend:*")
        if keys:
            keys_deleted = await redis.delete(*keys)
    except Exception as exc:
        logger.warning("Redis cleanup warning", error=str(exc))

    return {
        "status": "success",
        "message": "Demo resources and spend counters cleaned up successfully.",
        "deleted_redis_keys": keys_deleted,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
