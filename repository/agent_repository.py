from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.agent import Agent

class AgentRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, agent_id: str) -> Optional[Agent]:
        stmt = select(Agent).where(Agent.id == agent_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, agent: Agent) -> Agent:
        self.session.add(agent)
        await self.session.commit()
        return agent

