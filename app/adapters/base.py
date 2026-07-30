from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple

class ProviderAdapter(ABC):
    """Abstract interface for LLM provider adapters."""

    @abstractmethod
    def estimate_cost(self, prompt: str, model: str) -> float:
        """Estimate upcoming call cost based on prompt length and model pricing."""
        pass

    @abstractmethod
    async def call_llm(self, prompt: str, model: str) -> Tuple[str, int, int, float]:
        """
        Executes call to LLM provider.
        Returns tuple: (response_text, tokens_in, tokens_out, actual_cost_usd)
        """
        pass
