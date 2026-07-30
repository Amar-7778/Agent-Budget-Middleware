from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from models.spend_event import SpendEvent

class SpendEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, spend_event: SpendEvent) -> SpendEvent:
        self.session.add(spend_event)
        await self.session.commit()
        return spend_event


    async def get_by_id(self, event_id: str) -> Optional[SpendEvent]:
        stmt = select(SpendEvent).where(SpendEvent.id == event_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def update_actuals(
        self,
        event_id: str,
        tokens_in: int,
        tokens_out: int,
        actual_cost_usd: float,
        model_used: str,
    ) -> Optional[SpendEvent]:
        stmt = (
            update(SpendEvent)
            .where(SpendEvent.id == event_id)
            .values(
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=actual_cost_usd,
                model_used=model_used,
            )
        )
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_by_id(event_id)
