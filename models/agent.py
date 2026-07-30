import uuid
from typing import List, TYPE_CHECKING
from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from models.base import Base

if TYPE_CHECKING:
    from models.team import Team
    from models.session import Session

class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    monthly_budget_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    preferred_model: Mapped[str] = mapped_column(String(100), nullable=False)
    fallback_model: Mapped[str] = mapped_column(String(100), nullable=False)

    team: Mapped["Team"] = relationship("Team", back_populates="agents")
    sessions: Mapped[List["Session"]] = relationship("Session", back_populates="agent", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Agent(id={self.id!r}, name={self.name!r}, team_id={self.team_id!r})>"
