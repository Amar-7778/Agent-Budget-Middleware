import logging
import sys
import structlog
from contextvars import ContextVar
from typing import Optional

# Context variable for holding correlation ID across async execution contexts
correlation_id_ctx: ContextVar[Optional[str]] = ContextVar("correlation_id", default=None)

def add_correlation_id(logger, method_name, event_dict):
    """Processor to inject current correlation_id into every log event."""
    cid = correlation_id_ctx.get()
    if cid:
        event_dict["correlation_id"] = cid
    return event_dict

def setup_logging(log_level: str = "INFO"):
    """Configure structlog for structured JSON logging."""
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper(), logging.INFO),
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            add_correlation_id,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

get_logger = structlog.get_logger
