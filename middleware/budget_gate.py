import asyncio
import json
import logging
from typing import Optional, Tuple, Callable, Dict, Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.spend_event import SpendEvent
from repository.team_repository import TeamRepository
from repository.agent_repository import AgentRepository
from repository.session_repository import SessionRepository
from repository.spend_event_repository import SpendEventRepository
from middleware.types import GateDecision, EventType
from middleware.runaway_detector import RunawayDetector

logger = logging.getLogger("agent_budget_middleware")

class BudgetGate:
    """
    Core budget-gate middleware logic. Handles atomic Redis increments,
    ordered policy evaluation, compensating rollbacks, async event persistence,
    and post-call spend reconciliation.
    """

    def __init__(
        self,
        redis_client: Redis,
        session_factory: async_sessionmaker[AsyncSession],
        warning_percentage: float = 0.80,
    ):
        self.redis = redis_client
        self.session_factory = session_factory
        self.warning_percentage = warning_percentage
        self._background_tasks = set()
        self.runaway_detector = RunawayDetector(redis_client)
        self.runaway_enabled = True

    def _create_background_task(self, coro):
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task


    async def check_and_reserve(
        self,
        session_id: str,
        agent_id: str,
        team_id: str,
        estimated_cost_usd: float,
        preferred_model: Optional[str] = None,
        fallback_model: Optional[str] = None,
        session_budget_override: Optional[float] = None,
        agent_budget_override: Optional[float] = None,
        team_budget_override: Optional[float] = None,
    ) -> GateDecision:
        """
        Atomically reserves estimated spend across Redis counters and evaluates limits.
        """
        # ─────────────────────────────────────────────────────────────────
        # 0. RUNAWAY DETECTOR PRE-CHECK:
        # If the agent has been flagged as runaway and paused for human
        # review, reject immediately without reserving any budget.
        # ─────────────────────────────────────────────────────────────────
        if self.runaway_enabled and await self.runaway_detector.is_paused(agent_id):
            decision = GateDecision(
                event_type=EventType.PAUSE,
                model_to_use=preferred_model or "llama-3.3-70b-versatile",
                should_warn=False,
                reason="agent_paused_runaway_detected",
                session_spend=0.0,
                agent_spend=0.0,
                team_spend=0.0,
            )
            self._async_record_spend_event(
                session_id=session_id, agent_id=agent_id, team_id=team_id,
                tokens_in=0, tokens_out=0, cost_usd=estimated_cost_usd,
                model_used=preferred_model or "llama-3.3-70b-versatile",
                event_type=EventType.PAUSE, decision=decision
            )
            return decision

        # Fetch limits and models from DB if not explicitly passed
        session_budget, agent_budget, team_budget, pref_model, fall_model = await self._fetch_context_limits(
            session_id, agent_id, team_id,
            session_budget_override, agent_budget_override, team_budget_override,
            preferred_model, fallback_model
        )

        session_key = f"spend:session:{session_id}"
        agent_key = f"spend:agent:{agent_id}"
        team_key = f"spend:team:{team_id}"

        # ---------------------------------------------------------------------
        # 1. ATOMIC INCREMENT DESIGN:
        # Under concurrent requests, a read-then-write pattern lets two requests
        # both see "under budget" before either write lands, so combined spend
        # exceeds the limit. Atomic increment via Redis pipeline INCRBYFLOAT closes
        # that gap by ensuring every request instantly sees the accumulated total.
        # ---------------------------------------------------------------------
        pipe = self.redis.pipeline()
        pipe.incrbyfloat(session_key, estimated_cost_usd)
        pipe.incrbyfloat(agent_key, estimated_cost_usd)
        pipe.incrbyfloat(team_key, estimated_cost_usd)
        results = await pipe.execute()

        new_session_spend = round(float(results[0]), 6)
        new_agent_spend = round(float(results[1]), 6)
        new_team_spend = round(float(results[2]), 6)

        # Helper to roll back counters when limits are exceeded
        async def rollback_counters():
            rpipe = self.redis.pipeline()
            rpipe.incrbyfloat(session_key, -estimated_cost_usd)
            rpipe.incrbyfloat(agent_key, -estimated_cost_usd)
            rpipe.incrbyfloat(team_key, -estimated_cost_usd)
            await rpipe.execute()

        # ---------------------------------------------------------------------
        # 2. ORDERED EVALUATION:
        # ---------------------------------------------------------------------
        
        # Rule A: new session total > session budget -> roll back, close session, BLOCK
        if session_budget is not None and new_session_spend > round(session_budget, 6):
            await rollback_counters()
            # Close session asynchronously in DB
            asyncio.create_task(self._close_session_db(session_id))
            decision = GateDecision(
                event_type=EventType.BLOCK,
                model_to_use=pref_model,
                should_warn=False,
                reason="session_budget_exceeded",
                session_spend=new_session_spend - estimated_cost_usd,
                agent_spend=new_agent_spend - estimated_cost_usd,
                team_spend=new_team_spend - estimated_cost_usd,
            )
            self._async_record_spend_event(
                session_id=session_id, agent_id=agent_id, team_id=team_id,
                tokens_in=0, tokens_out=0, cost_usd=estimated_cost_usd,
                model_used=pref_model, event_type=EventType.BLOCK, decision=decision
            )
            return decision

        # Rule B: new team total > team budget -> roll back, BLOCK
        if team_budget is not None and new_team_spend > round(team_budget, 6):
            await rollback_counters()
            decision = GateDecision(
                event_type=EventType.BLOCK,
                model_to_use=pref_model,
                should_warn=False,
                reason="team_budget_exceeded",
                session_spend=new_session_spend - estimated_cost_usd,
                agent_spend=new_agent_spend - estimated_cost_usd,
                team_spend=new_team_spend - estimated_cost_usd,
            )
            self._async_record_spend_event(
                session_id=session_id, agent_id=agent_id, team_id=team_id,
                tokens_in=0, tokens_out=0, cost_usd=estimated_cost_usd,
                model_used=pref_model, event_type=EventType.BLOCK, decision=decision
            )
            return decision

        # Rule C: new agent total > agent budget -> roll back, REROUTE (use fallback_model)
        if agent_budget is not None and new_agent_spend > round(agent_budget, 6):
            await rollback_counters()
            decision = GateDecision(
                event_type=EventType.REROUTE,
                model_to_use=fall_model,
                should_warn=False,
                reason="agent_budget_exceeded",
                session_spend=new_session_spend - estimated_cost_usd,
                agent_spend=new_agent_spend - estimated_cost_usd,
                team_spend=new_team_spend - estimated_cost_usd,
            )
            self._async_record_spend_event(
                session_id=session_id, agent_id=agent_id, team_id=team_id,
                tokens_in=0, tokens_out=0, cost_usd=estimated_cost_usd,
                model_used=fall_model, event_type=EventType.REROUTE, decision=decision
            )
            return decision

        # Rule D: new agent total >= warning_percentage * agent budget -> ALLOW with should_warn=True
        should_warn = False
        event_type = EventType.ALLOW
        if agent_budget is not None and new_agent_spend >= round(self.warning_percentage * agent_budget, 6):
            should_warn = True
            event_type = EventType.WARN

        # ─────────────────────────────────────────────────────────────────
        # 4. RUNAWAY DETECTOR POST-CHECK (PS-8.1 Bonus):
        # After a successful ALLOW/WARN, record this spend in the hourly
        # sliding window. If the agent has consumed >20% of its monthly
        # budget within the last hour, flag it as runaway and PAUSE.
        # ─────────────────────────────────────────────────────────────────
        reason = "warning_threshold_reached" if should_warn else None
        if self.runaway_enabled and event_type in (EventType.ALLOW, EventType.WARN) and agent_budget is not None:
            is_runaway = await self.runaway_detector.record_and_check(
                agent_id=agent_id,
                cost_usd=estimated_cost_usd,
                monthly_budget_usd=agent_budget,
            )
            if is_runaway:
                await self.runaway_detector.pause_agent(agent_id)
                # Override the decision to PAUSE — the current request still
                # goes through (it was already reserved), but all subsequent
                # requests will be blocked until human review.
                event_type = EventType.PAUSE
                reason = "agent_paused_runaway_detected"

        decision = GateDecision(
            event_type=event_type,
            model_to_use=pref_model,
            should_warn=should_warn,
            reason=reason,
            session_spend=new_session_spend,
            agent_spend=new_agent_spend,
            team_spend=new_team_spend,
        )

        # 3. Write SpendEvent asynchronously in background
        self._async_record_spend_event(
            session_id=session_id, agent_id=agent_id, team_id=team_id,
            tokens_in=0, tokens_out=0, cost_usd=estimated_cost_usd,
            model_used=pref_model, event_type=event_type, decision=decision
        )

        return decision

    async def reconcile_spend(
        self,
        spend_event_id: Optional[str],
        session_id: str,
        agent_id: str,
        team_id: str,
        estimated_cost_usd: float,
        actual_tokens_in: int,
        actual_tokens_out: int,
        actual_cost_usd: float,
        model_used: str,
    ) -> float:
        """
        4. Reconcile Redis counters using real token cost vs. earlier estimate,
        and update matching SpendEvent with actual numbers in PostgreSQL.
        """
        diff = actual_cost_usd - estimated_cost_usd

        if abs(diff) > 1e-9:
            session_key = f"spend:session:{session_id}"
            agent_key = f"spend:agent:{agent_id}"
            team_key = f"spend:team:{team_id}"

            pipe = self.redis.pipeline()
            pipe.incrbyfloat(session_key, diff)
            pipe.incrbyfloat(agent_key, diff)
            pipe.incrbyfloat(team_key, diff)
            await pipe.execute()

        # Update SpendEvent in DB if event_id is available
        if spend_event_id:
            asyncio.create_task(
                self._update_spend_event_db(
                    spend_event_id, actual_tokens_in, actual_tokens_out, actual_cost_usd, model_used
                )
            )

        return diff

    def _async_record_spend_event(
        self,
        session_id: str,
        agent_id: str,
        team_id: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        model_used: str,
        event_type: EventType,
        decision: GateDecision,
    ):
        """Dispatches an un-awaited background task to save SpendEvent to database."""
        self._create_background_task(
            self._save_spend_event_db(
                session_id, agent_id, team_id, tokens_in, tokens_out, cost_usd, model_used, event_type.value, decision
            )
        )




    async def _save_spend_event_db(
        self,
        session_id: str,
        agent_id: str,
        team_id: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        model_used: str,
        event_type_str: str,
        decision: GateDecision,
    ):
        try:
            async with self.session_factory() as session:
                repo = SpendEventRepository(session)
                event = SpendEvent(
                    session_id=session_id,
                    agent_id=agent_id,
                    team_id=team_id,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=cost_usd,
                    model_used=model_used,
                    event_type=event_type_str,
                )
                saved_event = await repo.create(event)
                decision.spend_event_id = saved_event.id
        except Exception as exc:
            logger.error(f"Failed to save SpendEvent to DB: {exc}")



    async def _update_spend_event_db(
        self,
        event_id: str,
        tokens_in: int,
        tokens_out: int,
        actual_cost: float,
        model_used: str,
    ):
        try:
            async with self.session_factory() as session:
                repo = SpendEventRepository(session)
                await repo.update_actuals(
                    event_id=event_id,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    actual_cost_usd=actual_cost,
                    model_used=model_used,
                )
        except Exception as exc:
            logger.error(f"Failed to reconcile SpendEvent {event_id} in DB: {exc}")

    async def _close_session_db(self, session_id: str):
        try:
            async with self.session_factory() as session:
                repo = SessionRepository(session)
                await repo.close_session(session_id)
        except Exception as exc:
            logger.error(f"Failed to close session {session_id} in DB: {exc}")

    async def _fetch_context_limits(
        self,
        session_id: str,
        agent_id: str,
        team_id: str,
        sess_override: Optional[float],
        agent_override: Optional[float],
        team_override: Optional[float],
        pref_override: Optional[str],
        fall_override: Optional[str],
    ) -> Tuple[Optional[float], Optional[float], Optional[float], str, str]:
        """Fetches budget limits and models from Redis cache or PostgreSQL if not provided."""
        sess_budget = sess_override
        agent_budget = agent_override
        team_budget = team_override
        pref_model = pref_override or "llama-3.3-70b-versatile"
        fall_model = fall_override or "llama-3.1-8b-instant"

        # 1. Check Redis metadata cache first for ultra-fast <1ms lookups
        if None in (sess_budget, agent_budget, team_budget) and self.redis:
            try:
                pipe = self.redis.pipeline()
                pipe.get(f"meta:session:{session_id}")
                pipe.get(f"meta:agent:{agent_id}")
                pipe.get(f"meta:team:{team_id}")
                res = await pipe.execute()

                if sess_budget is None and res[0]:
                    sess_budget = float(res[0])
                if res[1]:
                    meta = json.loads(res[1])
                    if agent_budget is None and "budget" in meta:
                        agent_budget = float(meta["budget"])
                    if pref_override is None and "pref" in meta:
                        pref_model = meta["pref"]
                    if fall_override is None and "fall" in meta:
                        fall_model = meta["fall"]
                if team_budget is None and res[2]:
                    team_budget = float(res[2])
            except Exception as e:
                logger.debug(f"Redis metadata cache lookup failed: {e}")

        # 2. Fetch missing values from PostgreSQL and populate Redis cache
        if None in (sess_budget, agent_budget, team_budget):
            try:
                async with self.session_factory() as session:
                    if sess_budget is None:
                        s_repo = SessionRepository(session)
                        s_obj = await s_repo.get_by_id(session_id)
                        if s_obj:
                            sess_budget = s_obj.budget_usd
                            if self.redis:
                                await self.redis.set(f"meta:session:{session_id}", str(sess_budget), ex=300)

                    if agent_budget is None or pref_override is None or fall_override is None:
                        a_repo = AgentRepository(session)
                        a_obj = await a_repo.get_by_id(agent_id)
                        if a_obj:
                            if agent_budget is None:
                                agent_budget = a_obj.monthly_budget_usd
                            if pref_override is None:
                                pref_model = a_obj.preferred_model
                            if fall_override is None:
                                fall_model = a_obj.fallback_model
                            if self.redis:
                                meta = {"budget": agent_budget, "pref": pref_model, "fall": fall_model}
                                await self.redis.set(f"meta:agent:{agent_id}", json.dumps(meta), ex=300)

                    if team_budget is None:
                        t_repo = TeamRepository(session)
                        t_obj = await t_repo.get_by_id(team_id)
                        if t_obj:
                            team_budget = t_obj.monthly_budget_usd
                            if self.redis:
                                await self.redis.set(f"meta:team:{team_id}", str(team_budget), ex=300)
            except Exception as exc:
                logger.warning(f"Could not fetch limits from DB, using fallback defaults: {exc}")

        return sess_budget, agent_budget, team_budget, pref_model, fall_model




class BudgetGateASGIMiddleware:
    """
    Mountable ASGI middleware for FastAPI / Starlette applications.
    Enables single-line mounting:
      app.add_middleware(BudgetGateASGIMiddleware, budget_gate=gate)
    """

    def __init__(
        self,
        app: Callable,
        budget_gate: BudgetGate,
        header_session_id: str = "x-session-id",
        header_agent_id: str = "x-agent-id",
        header_team_id: str = "x-team-id",
        default_estimate: float = 0.01,
    ):
        self.app = app
        self.budget_gate = budget_gate
        self.header_session_id = header_session_id.lower()
        self.header_agent_id = header_agent_id.lower()
        self.header_team_id = header_team_id.lower()
        self.default_estimate = default_estimate

    async def __call__(self, scope: Dict[str, Any], receive: Callable, send: Callable):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        session_id = headers.get(self.header_session_id.encode(), b"").decode()
        agent_id = headers.get(self.header_agent_id.encode(), b"").decode()
        team_id = headers.get(self.header_team_id.encode(), b"").decode()

        if session_id and agent_id and team_id:
            decision = await self.budget_gate.check_and_reserve(
                session_id=session_id,
                agent_id=agent_id,
                team_id=team_id,
                estimated_cost_usd=self.default_estimate,
            )
            if decision.event_type in (EventType.BLOCK, EventType.PAUSE):
                reason = decision.reason or "budget_exceeded"
                response_body = f'{{"error": "Budget exceeded", "reason": "{reason}"}}'.encode()
                await send({
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [(b"content-type", b"application/json")],
                })
                await send({
                    "type": "http.response.body",
                    "body": response_body,
                })
                return

            # Inject decision into scope state for downstream handlers
            scope.setdefault("state", {})["budget_decision"] = decision

        await self.app(scope, receive, send)
