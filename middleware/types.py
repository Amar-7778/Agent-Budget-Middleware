from enum import Enum
from typing import Optional
from dataclasses import dataclass

class EventType(str, Enum):
    ALLOW = "allow"
    WARN = "warn"
    BLOCK = "block"
    REROUTE = "reroute"
    PAUSE = "pause"  # Runaway agent detector: agent paused for human review

class SessionStatus(str, Enum):
    ACTIVE = "active"
    CLOSED = "closed"

@dataclass
class GateDecision:
    event_type: EventType
    model_to_use: str
    should_warn: bool = False
    reason: Optional[str] = None
    spend_event_id: Optional[str] = None
    session_spend: float = 0.0
    agent_spend: float = 0.0
    team_spend: float = 0.0
