from fastapi import APIRouter, Depends, Query
from typing import Optional, List
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db_session
from models.spend_event import SpendEvent

router = APIRouter(prefix="/audit", tags=["Audit"])

@router.get("")
async def get_audit_logs(
    agent_id: Optional[str] = Query(None, description="Filter by Agent ID"),
    team_id: Optional[str] = Query(None, description="Filter by Team ID"),
    session_id: Optional[str] = Query(None, description="Filter by Session ID"),
    start_time: Optional[datetime] = Query(None, description="Filter from timestamp (ISO 8601)"),
    end_time: Optional[datetime] = Query(None, description="Filter until timestamp (ISO 8601)"),
    limit: int = Query(50, ge=1, le=500, description="Max number of logs to return"),
    db: AsyncSession = Depends(get_db_session),
):
    stmt = select(SpendEvent)

    if agent_id:
        stmt = stmt.where(SpendEvent.agent_id == agent_id)
    if team_id:
        stmt = stmt.where(SpendEvent.team_id == team_id)
    if session_id:
        stmt = stmt.where(SpendEvent.session_id == session_id)
    if start_time:
        stmt = stmt.where(SpendEvent.timestamp >= start_time)
    if end_time:
        stmt = stmt.where(SpendEvent.timestamp <= end_time)

    stmt = stmt.order_by(SpendEvent.timestamp.desc()).limit(limit)
    result = await db.execute(stmt)
    events = result.scalars().all()

    return [
        {
            "id": ev.id,
            "session_id": ev.session_id,
            "agent_id": ev.agent_id,
            "team_id": ev.team_id,
            "tokens_in": ev.tokens_in,
            "tokens_out": ev.tokens_out,
            "cost_usd": ev.cost_usd,
            "model_used": ev.model_used,
            "event_type": ev.event_type,
            "timestamp": ev.timestamp.isoformat(),
        }
        for ev in events
    ]
