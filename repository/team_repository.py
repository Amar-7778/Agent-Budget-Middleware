from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.team import Team

class TeamRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, team_id: str) -> Optional[Team]:
        stmt = select(Team).where(Team.id == team_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, team: Team) -> Team:
        self.session.add(team)
        await self.session.commit()
        return team

