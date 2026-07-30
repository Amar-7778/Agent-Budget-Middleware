from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/agent_budget_db"
    REDIS_URL: str = "redis://localhost:6379/0"
    GROQ_API_KEY: str = ""
    GROQ_PREFERRED_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_FALLBACK_MODEL: str = "llama-3.1-8b-instant"
    LOG_LEVEL: str = "INFO"
    APP_ENV: str = "development"
    APP_PORT: int = 8000
    WARNING_THRESHOLD_PCT: float = 0.80

    @model_validator(mode="after")
    def normalize_warning_threshold(self):
        """
        Normalize WARNING_THRESHOLD_PCT: if the value is > 1.0, assume it
        was provided as a percentage (e.g., 80) and convert to a ratio (0.80).
        This fixes the mismatch between .env (80) and code expectation (0.80).
        """
        if self.WARNING_THRESHOLD_PCT > 1.0:
            self.WARNING_THRESHOLD_PCT = self.WARNING_THRESHOLD_PCT / 100.0
        return self

settings = Settings()

