from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from models.session import Session

class SessionRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, session_id: str) -> Optional[Session]:
        stmt = select(Session).where(Session.id == session_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, session_obj: Session) -> Session:
        self.session.add(session_obj)
        await self.session.commit()
        return session_obj


    async def close_session(self, session_id: str) -> bool:
        stmt = (
            update(Session)
            .where(Session.id == session_id)
            .values(status="closed")
        )
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount > 0
