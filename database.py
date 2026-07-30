import os
from typing import AsyncGenerator
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/agent_budget_db"
)

# Ensure postgresql+asyncpg protocol scheme
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Strip sslmode query parameters that cause asyncpg TypeError
has_sslmode = "sslmode=" in DATABASE_URL
if "sslmode=" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("?sslmode=require", "").replace("&sslmode=require", "")
    DATABASE_URL = DATABASE_URL.replace("?sslmode=prefer", "").replace("&sslmode=prefer", "")
    DATABASE_URL = DATABASE_URL.replace("?sslmode=disable", "").replace("&sslmode=disable", "")

# Neon mandates SSL connection and disables prepared statement cache for PgBouncer compatibility
connect_args = {}
if "sqlite" not in DATABASE_URL:
    connect_args["prepared_statement_cache_size"] = 0
    if "neon.tech" in DATABASE_URL or has_sslmode or os.getenv("REQUIRE_SSL", "true").lower() == "true":
        connect_args["ssl"] = "require"


engine_kwargs = {
    "echo": False,
    "connect_args": connect_args,
}
if "sqlite" not in DATABASE_URL:
    engine_kwargs.update({
        "pool_size": 20,
        "max_overflow": 30,
        "pool_timeout": 30,
        "pool_pre_ping": True,
        "pool_recycle": 300,
    })

engine = create_async_engine(DATABASE_URL, **engine_kwargs)



AsyncSessionFactory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionFactory() as session:
        yield session
