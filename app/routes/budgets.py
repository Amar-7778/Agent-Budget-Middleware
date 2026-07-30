from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from models.team import Team
from models.agent import Agent
from models.session import Session
from repository.team_repository import TeamRepository
from repository.agent_repository import AgentRepository
from repository.session_repository import SessionRepository

router = APIRouter(prefix="/budgets", tags=["Budgets"])

# Pydantic Schemas
class TeamCreate(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "Engineering"})
    monthly_budget_usd: float = Field(..., json_schema_extra={"example": 500.0})

class AgentCreate(BaseModel):
    team_id: str = Field(..., json_schema_extra={"example": "team-uuid"})
    name: str = Field(..., json_schema_extra={"example": "Coder Agent"})
    monthly_budget_usd: float = Field(..., json_schema_extra={"example": 50.0})
    preferred_model: str = Field(default="llama-3.3-70b-versatile", json_schema_extra={"example": "llama-3.3-70b-versatile"})
    fallback_model: str = Field(default="llama-3.1-8b-instant", json_schema_extra={"example": "llama-3.1-8b-instant"})

class SessionCreate(BaseModel):
    agent_id: str = Field(..., json_schema_extra={"example": "agent-uuid"})
    budget_usd: float = Field(..., json_schema_extra={"example": 2.0})


# Endpoints
@router.post("/teams", status_code=status.HTTP_201_CREATED)
async def create_team(payload: TeamCreate, db: AsyncSession = Depends(get_db_session)):
    repo = TeamRepository(db)
    team = Team(name=payload.name, monthly_budget_usd=payload.monthly_budget_usd)
    created = await repo.create(team)
    return {"id": created.id, "name": created.name, "monthly_budget_usd": created.monthly_budget_usd}

@router.get("/teams/{team_id}")
async def get_team(team_id: str, db: AsyncSession = Depends(get_db_session)):
    repo = TeamRepository(db)
    team = await repo.get_by_id(team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return {"id": team.id, "name": team.name, "monthly_budget_usd": team.monthly_budget_usd}

@router.post("/agents", status_code=status.HTTP_201_CREATED)
async def create_agent(payload: AgentCreate, db: AsyncSession = Depends(get_db_session)):
    repo = AgentRepository(db)
    agent = Agent(
        team_id=payload.team_id,
        name=payload.name,
        monthly_budget_usd=payload.monthly_budget_usd,
        preferred_model=payload.preferred_model,
        fallback_model=payload.fallback_model,
    )
    created = await repo.create(agent)
    return {
        "id": created.id,
        "team_id": created.team_id,
        "name": created.name,
        "monthly_budget_usd": created.monthly_budget_usd,
        "preferred_model": created.preferred_model,
        "fallback_model": created.fallback_model,
    }

@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db_session)):
    repo = AgentRepository(db)
    agent = await repo.get_by_id(agent_id)
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    return {
        "id": agent.id,
        "team_id": agent.team_id,
        "name": agent.name,
        "monthly_budget_usd": agent.monthly_budget_usd,
        "preferred_model": agent.preferred_model,
        "fallback_model": agent.fallback_model,
    }

@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(payload: SessionCreate, db: AsyncSession = Depends(get_db_session)):
    repo = SessionRepository(db)
    sess = Session(agent_id=payload.agent_id, budget_usd=payload.budget_usd, status="active")
    created = await repo.create(sess)
    return {
        "id": created.id,
        "agent_id": created.agent_id,
        "budget_usd": created.budget_usd,
        "started_at": created.started_at.isoformat(),
        "status": created.status,
    }

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db_session)):
    repo = SessionRepository(db)
    sess = await repo.get_by_id(session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return {
        "id": sess.id,
        "agent_id": sess.agent_id,
        "budget_usd": sess.budget_usd,
        "started_at": sess.started_at.isoformat(),
        "status": sess.status,
    }
