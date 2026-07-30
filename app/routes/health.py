from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from redis.asyncio import Redis
from database import get_db_session

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("/live", status_code=status.HTTP_200_OK)
async def liveness_probe():
    """Liveness probe: returns 200 OK without dependency checks."""
    return {"status": "live"}

@router.get("")
async def readiness_health_check(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
):
    """
    Readiness probe: performs real Redis PING and PostgreSQL query (SELECT 1).
    Returns 200 OK if both dependencies succeed, or 503 with failed dependency details.
    """
    redis_ok = False
    postgres_ok = False
    failed_dependencies = []

    # 1. Real Redis PING check
    try:
        redis: Redis = request.app.state.redis
        pong = await redis.ping()
        if pong:
            redis_ok = True
    except Exception:
        failed_dependencies.append("redis")

    # 2. Real lightweight Postgres SELECT 1 query
    try:
        res = await db.execute(text("SELECT 1"))
        if res.scalar() == 1:
            postgres_ok = True
    except Exception:
        failed_dependencies.append("postgres")

    if redis_ok and postgres_ok:
        return {
            "status": "healthy",
            "redis": "ok",
            "postgres": "ok",
        }
    else:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unhealthy",
            "failed_dependencies": failed_dependencies,
            "redis": "ok" if redis_ok else "failed",
            "postgres": "ok" if postgres_ok else "failed",
        }
