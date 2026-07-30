import uuid
from typing import List, TYPE_CHECKING
from sqlalchemy import String, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from models.base import Base

if TYPE_CHECKING:
    from models.agent import Agent

class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    monthly_budget_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    agents: Mapped[List["Agent"]] = relationship("Agent", back_populates="team", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Team(id={self.id!r}, name={self.name!r}, monthly_budget_usd={self.monthly_budget_usd})>"
