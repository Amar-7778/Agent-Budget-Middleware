from app.routes.chat import router as chat_router
from app.routes.budgets import router as budgets_router
from app.routes.dashboard import router as dashboard_router
from app.routes.audit import router as audit_router
from app.routes.health import router as health_router
from app.routes.ui import router as ui_router

__all__ = [
    "chat_router",
    "budgets_router",
    "dashboard_router",
    "audit_router",
    "health_router",
    "ui_router",
]

