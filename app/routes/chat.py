from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from repository.session_repository import SessionRepository
from repository.agent_repository import AgentRepository
from middleware.budget_gate import BudgetGate
from middleware.types import EventType
from app.adapters.groq_adapter import GroqAdapter
from app.logger import get_logger, correlation_id_ctx

logger = get_logger("chat_route")
router = APIRouter(prefix="/v1", tags=["Chat"])

class ChatRequest(BaseModel):
    session_id: str = Field(..., json_schema_extra={"example": "sess-123"})
    agent_id: str = Field(..., json_schema_extra={"example": "agent-456"})
    message: str = Field(..., json_schema_extra={"example": "Hello, summarize quantum computing."})


class ChatResponse(BaseModel):
    response: str
    model_used: str
    event_type: str
    should_warn: bool
    cost_usd: float
    tokens_in: int
    tokens_out: int
    correlation_id: Optional[str] = None

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    payload: ChatRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    budget_gate: BudgetGate = request.app.state.budget_gate
    groq_adapter: GroqAdapter = request.app.state.groq_adapter

    cid = correlation_id_ctx.get()

    # 1. Fetch Session & Agent details from Postgres
    s_repo = SessionRepository(db)
    session_obj = await s_repo.get_by_id(payload.session_id)
    if not session_obj or session_obj.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session '{payload.session_id}' is closed or does not exist."
        )

    a_repo = AgentRepository(db)
    agent_obj = await a_repo.get_by_id(payload.agent_id)
    if not agent_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent '{payload.agent_id}' not found."
        )

    team_id = agent_obj.team_id
    preferred_model = agent_obj.preferred_model
    fallback_model = agent_obj.fallback_model

    # 2. Estimate upcoming call cost
    estimated_cost = groq_adapter.estimate_cost(payload.message, preferred_model)

    # 3. Reserve and check budget via BudgetGate
    decision = await budget_gate.check_and_reserve(
        session_id=payload.session_id,
        agent_id=payload.agent_id,
        team_id=team_id,
        estimated_cost_usd=estimated_cost,
        preferred_model=preferred_model,
        fallback_model=fallback_model,
    )

    if decision.event_type == EventType.BLOCK:
        logger.warning("Request blocked by budget gate", reason=decision.reason)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "Budget limit exceeded",
                "reason": decision.reason,
                "correlation_id": cid,
            }
        )

    model_to_use = decision.model_to_use

    # 4. Call Groq provider adapter with failure handling
    try:
        response_text, tokens_in, tokens_out, actual_cost = await groq_adapter.call_llm(
            prompt=payload.message, model=model_to_use
        )
    except Exception as exc:
        # Groq errors -> clear "provider unavailable" response, no counter increment for a call that never completed.
        # We reconcile back $0 actual cost (diff = -estimated_cost) so reservation is refunded.
        logger.error("Groq provider call failed", error=str(exc), model=model_to_use)
        await budget_gate.reconcile_spend(
            spend_event_id=decision.spend_event_id,
            session_id=payload.session_id,
            agent_id=payload.agent_id,
            team_id=team_id,
            estimated_cost_usd=estimated_cost,
            actual_tokens_in=0,
            actual_tokens_out=0,
            actual_cost_usd=0.0,
            model_used=model_to_use,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "Provider unavailable",
                "message": f"LLM call to Groq ({model_to_use}) failed.",
                "correlation_id": cid,
            }
        )

    # 5. Post-call reconciliation
    await budget_gate.reconcile_spend(
        spend_event_id=decision.spend_event_id,
        session_id=payload.session_id,
        agent_id=payload.agent_id,
        team_id=team_id,
        estimated_cost_usd=estimated_cost,
        actual_tokens_in=tokens_in,
        actual_tokens_out=tokens_out,
        actual_cost_usd=actual_cost,
        model_used=model_to_use,
    )

    return ChatResponse(
        response=response_text,
        model_used=model_to_use,
        event_type=decision.event_type.value,
        should_warn=decision.should_warn,
        cost_usd=actual_cost,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        correlation_id=cid,
    )
