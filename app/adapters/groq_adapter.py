import os
import math
from typing import Tuple
from groq import AsyncGroq
from app.adapters.base import ProviderAdapter
from app.logger import get_logger

logger = get_logger("groq_adapter")

# Model cost per token pricing tables (USD per token)
GROQ_PRICING = {
    "llama-3.3-70b-versatile": {"input": 0.59 / 1_000_000, "output": 0.79 / 1_000_000},
    "llama-3.1-8b-instant": {"input": 0.05 / 1_000_000, "output": 0.08 / 1_000_000},
    "default": {"input": 0.10 / 1_000_000, "output": 0.20 / 1_000_000},
}

class GroqAdapter(ProviderAdapter):
    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        self.client = AsyncGroq(api_key=self.api_key) if self.api_key else None

    def estimate_cost(self, prompt: str, model: str) -> float:
        """
        Estimate prompt token count (~4 chars per token) + assumed 150 completion tokens
        to compute estimated cost.
        """
        estimated_input_tokens = max(1, math.ceil(len(prompt) / 4.0))
        estimated_output_tokens = 150

        rates = GROQ_PRICING.get(model, GROQ_PRICING["default"])
        cost = (estimated_input_tokens * rates["input"]) + (estimated_output_tokens * rates["output"])
        # Minimum non-zero cost estimate for safety
        return max(0.0001, round(cost, 6))

    async def call_llm(self, prompt: str, model: str) -> Tuple[str, int, int, float]:
        """
        Executes real call to Groq API using AsyncGroq client if API key is provided,
        or returns simulated completion for test/mock mode.
        """
        rates = GROQ_PRICING.get(model, GROQ_PRICING["default"])

        if self.client and self.api_key and not self.api_key.startswith("mock"):
            logger.info("Calling Groq API", model=model, prompt_length=len(prompt))
            completion = await self.client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=model,
            )
            response_text = completion.choices[0].message.content or ""
            usage = completion.usage
            tokens_in = usage.prompt_tokens if usage else math.ceil(len(prompt) / 4.0)
            tokens_out = usage.completion_tokens if usage else math.ceil(len(response_text) / 4.0)
        else:
            # Mock mode for testing or offline development
            logger.info("Mock Groq API call executed", model=model)
            response_text = f"Mock response from Groq using {model} to prompt: '{prompt[:30]}...'"
            tokens_in = math.ceil(len(prompt) / 4.0)
            tokens_out = 50

        actual_cost = round((tokens_in * rates["input"]) + (tokens_out * rates["output"]), 6)
        return response_text, tokens_in, tokens_out, actual_cost
