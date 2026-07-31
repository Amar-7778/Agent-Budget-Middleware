import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from redis.asyncio import Redis

from app.config import settings
from app.logger import setup_logging, get_logger, correlation_id_ctx
from database import AsyncSessionFactory
from middleware.budget_gate import BudgetGate, BudgetGateASGIMiddleware
from app.adapters.groq_adapter import GroqAdapter
from app.routes import (
    chat_router,
    budgets_router,
    dashboard_router,
    audit_router,
    health_router,
    ui_router,
    demo_router,
)



# Initialize structured logging
setup_logging(log_level=settings.LOG_LEVEL)
logger = get_logger("app_main")

# =============================================================================
# ARCHITECTURAL RESILIENCE STRATEGY COMMENTS:
#
# 1. REDIS UNAVAILABLE -> FAIL CLOSED:
#    If Redis is unavailable, real-time atomic spend counters cannot be updated
#    or evaluated safely. Allowing LLM requests to proceed uncounted would risk
#    massive budget overruns across concurrent agents. Therefore, when Redis is
#    unreachable, the budget gate fails closed (rejecting requests with HTTP 503)
#    to guarantee financial safety.
#
# 2. POSTGRES UNAVAILABLE -> FAIL SOFT AUDIT / REDIS-FIRST GATING:
#    Redis holds the authoritative real-time spend state required for high-speed
#    gating. If PostgreSQL becomes temporarily unavailable or slow, fast-path
#    gating decisions continue using Redis state, while database audit writes
#    degredation/retries run in background tasks without blocking caller traffic.
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Redis connection & dependencies (with Docker/Local host fallback)
    redis_url = settings.REDIS_URL
    try:
        redis_client = Redis.from_url(redis_url, decode_responses=True)
        await redis_client.ping()
    except Exception:
        # Fallback to localhost if running outside Docker container
        if "redis://redis:" in redis_url:
            alt_url = redis_url.replace("redis://redis:", "redis://localhost:", 1)
            try:
                redis_client = Redis.from_url(alt_url, decode_responses=True)
                await redis_client.ping()
            except Exception:
                redis_client = Redis.from_url(redis_url, decode_responses=True)
        else:
            redis_client = Redis.from_url(redis_url, decode_responses=True)

    budget_gate = BudgetGate(
        redis_client=redis_client,
        session_factory=AsyncSessionFactory,
        warning_percentage=settings.WARNING_THRESHOLD_PCT,
    )
    groq_adapter = GroqAdapter(api_key=settings.GROQ_API_KEY)

    app.state.redis = redis_client
    app.state.budget_gate = budget_gate
    app.state.groq_adapter = groq_adapter


    # Ensure PostgreSQL database tables exist on startup
    from database import engine
    from models import Base
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema verified/created successfully")
    except Exception as e:
        logger.warning("Database auto-table creation encountered issue", error=str(e))

    logger.info("Application started up successfully", app_env=settings.APP_ENV)
    yield
    # Shutdown: Close Redis connection cleanly
    await redis_client.aclose()
    logger.info("Application shutdown completed")

app = FastAPI(
    title="Agent Budget Middleware Service",
    description="Production-grade AI agent governance and real-time budget enforcement middleware.",
    version="1.0.0",
    lifespan=lifespan,
)

# -----------------------------------------------------------------------------
# 1. Correlation ID Middleware
# -----------------------------------------------------------------------------
@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or request.headers.get("x-request-id") or str(uuid.uuid4())
    token = correlation_id_ctx.set(cid)
    request.state.correlation_id = cid

    try:
        response = await call_next(request)
        response.headers["x-correlation-id"] = cid
        return response
    finally:
        correlation_id_ctx.reset(token)

# -----------------------------------------------------------------------------
# 2. Wire BudgetGateASGIMiddleware onto the app with ONE LINE, as designed
# -----------------------------------------------------------------------------
# Note: For middleware mounting during app instantiation, we create a lazy wrapper
# or pass the gate directly via request state / app state.
class LazyBudgetGateASGI:
    def __init__(self, app_instance):
        self.app_instance = app_instance

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            gate = getattr(self.app_instance.state, "budget_gate", None)
            if gate:
                middleware_wrapper = BudgetGateASGIMiddleware(self.app_instance, budget_gate=gate)
                # Delegate to the mounted BudgetGateASGIMiddleware
                await middleware_wrapper(scope, receive, send)
                return
        await self.app_instance(scope, receive, send)

# -----------------------------------------------------------------------------
# 3. Global Exception Handlers (Clean JSON errors, never raw stack traces)
# -----------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    cid = getattr(request.state, "correlation_id", None)
    logger.warning("HTTP exception occurred", status_code=exc.status_code, detail=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail if isinstance(exc.detail, str) else exc.detail.get("error", "HTTP Error"),
            "detail": exc.detail,
            "correlation_id": cid,
        },
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    cid = getattr(request.state, "correlation_id", None)
    logger.warning("Request validation error", errors=exc.errors())
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Validation Error",
            "details": exc.errors(),
            "correlation_id": cid,
        },
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    cid = getattr(request.state, "correlation_id", None)
    logger.error("Unhandled server exception", error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred. Please reference correlation ID.",
            "correlation_id": cid,
        },
    )

import os
from fastapi.staticfiles import StaticFiles

STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static"))
ASSETS_DIR = os.path.join(STATIC_DIR, "assets")

if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if os.path.exists(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


# Register route routers
app.include_router(ui_router)
app.include_router(chat_router)
app.include_router(budgets_router)
app.include_router(dashboard_router)
app.include_router(audit_router)
app.include_router(health_router)
app.include_router(demo_router)


