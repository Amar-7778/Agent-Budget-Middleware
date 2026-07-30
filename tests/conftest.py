import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import pytest_asyncio
import fakeredis.aioredis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from models.base import Base

from models.team import Team
from models.agent import Agent
from models.session import Session
from middleware.budget_gate import BudgetGate

@pytest_asyncio.fixture
async def fake_redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()

from sqlalchemy.pool import StaticPool

@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
        execution_options={"isolation_level": "AUTOCOMMIT"},
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()



@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

@pytest_asyncio.fixture
async def budget_gate(fake_redis, session_factory):
    return BudgetGate(
        redis_client=fake_redis,
        session_factory=session_factory,
        warning_percentage=0.80,
    )

@pytest_asyncio.fixture
async def seeded_entities(session_factory):
    async with session_factory() as session:
        team = Team(id="team-1", name="Engineering Team", monthly_budget_usd=10.00)
        agent = Agent(
            id="agent-1",
            team_id="team-1",
            name="Coder Agent",
            monthly_budget_usd=5.00,
            preferred_model="llama-3.3-70b-versatile",
            fallback_model="llama-3.1-8b-instant",
        )
        session_obj = Session(
            id="session-1",
            agent_id="agent-1",
            budget_usd=2.00,
            status="active",
        )
        session.add_all([team, agent, session_obj])
        await session.commit()

    return {
        "team_id": "team-1",
        "agent_id": "agent-1",
        "session_id": "session-1",
    }
