from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from redis.asyncio import Redis

from database import get_db_session
from models.team import Team
from models.agent import Agent
from models.session import Session

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/spend")
async def get_dashboard_spend(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    redis: Redis = request.app.state.redis

    # Fetch all Teams from Postgres
    team_stmt = select(Team)
    teams_result = await db.execute(team_stmt)
    teams = teams_result.scalars().all()

    team_metrics = []
    for team in teams:
        raw_val = await redis.get(f"spend:team:{team.id}")
        spend = round(float(raw_val), 4) if raw_val is not None else 0.0
        budget = team.monthly_budget_usd
        pct_used = round((spend / budget * 100), 2) if budget > 0 else 0.0
        team_metrics.append({
            "team_id": team.id,
            "name": team.name,
            "current_spend_usd": spend,
            "monthly_budget_usd": budget,
            "pct_used": pct_used,
        })

    # Fetch all Agents from Postgres
    agent_stmt = select(Agent)
    agents_result = await db.execute(agent_stmt)
    agents = agents_result.scalars().all()

    agent_metrics = []
    agent_name_map = {}
    for agent in agents:
        agent_name_map[agent.id] = agent.name
        raw_val = await redis.get(f"spend:agent:{agent.id}")
        spend = round(float(raw_val), 4) if raw_val is not None else 0.0
        budget = agent.monthly_budget_usd
        pct_used = round((spend / budget * 100), 2) if budget > 0 else 0.0
        agent_metrics.append({
            "agent_id": agent.id,
            "team_id": agent.team_id,
            "name": agent.name,
            "current_spend_usd": spend,
            "monthly_budget_usd": budget,
            "pct_used": pct_used,
            "preferred_model": agent.preferred_model,
            "fallback_model": agent.fallback_model,
        })

    # Fetch all Sessions from Postgres (limit to 50 for performance)
    session_stmt = select(Session).order_by(Session.started_at.desc()).limit(50)
    sessions_result = await db.execute(session_stmt)
    sessions = sessions_result.scalars().all()

    session_metrics = []
    for session in sessions:
        raw_val = await redis.get(f"spend:session:{session.id}")
        spend = round(float(raw_val), 4) if raw_val is not None else 0.0
        budget = session.budget_usd
        pct_used = round((spend / budget * 100), 2) if budget > 0 else 0.0
        session_metrics.append({
            "session_id": session.id,
            "agent_id": session.agent_id,
            "agent_name": agent_name_map.get(session.agent_id, "Unknown Agent"),
            "current_spend_usd": spend,
            "budget_usd": budget,
            "pct_used": pct_used,
            "started_at": session.started_at.isoformat(),
            "status": session.status,
        })

    return {
        "teams": team_metrics,
        "agents": agent_metrics,
        "sessions": session_metrics,
    }

