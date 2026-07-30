import time
import logging
from redis.asyncio import Redis
from typing import Optional

logger = logging.getLogger("agent_budget_middleware")

# ─────────────────────────────────────────────────────────────────────────────
# RUNAWAY AGENT DETECTOR (PS-8.1 Bonus)
#
# Detects agents that consume > 20% of their monthly budget within a single
# hour — indicative of a recursive loop or stuck reasoning chain.
#
# Implementation: Redis sorted sets as sliding-window counters.
#   Key:   "hourly_spend:{agent_id}"
#   Score: Unix timestamp (seconds)
#   Member: Unique event entry "{timestamp}:{cost}"
#
# On each successful LLM call, we:
#   1. ZADD the cost entry with the current timestamp as score
#   2. ZREMRANGEBYSCORE to prune entries older than 1 hour
#   3. Sum remaining entries — if sum > 20% of monthly budget → PAUSE
#
# Paused state is a simple Redis key: "paused:agent:{agent_id}" = "1"
# Human operator clears it via POST /budgets/agents/{id}/unpause.
# ─────────────────────────────────────────────────────────────────────────────

HOURLY_WINDOW_SECONDS = 3600  # 1 hour
RUNAWAY_THRESHOLD_RATIO = 0.20  # 20% of monthly budget


class RunawayDetector:
    """
    Sliding-window hourly spend monitor.
    Flags and pauses agents that burn through >20% of their monthly budget
    within any rolling 1-hour window.
    """

    def __init__(self, redis_client: Redis):
        self.redis = redis_client

    async def is_paused(self, agent_id: str) -> bool:
        """Check if agent is currently paused for human review."""
        val = await self.redis.get(f"paused:agent:{agent_id}")
        return val is not None

    async def pause_agent(self, agent_id: str) -> None:
        """Set the pause flag. Agent will be blocked until manually unpaused."""
        await self.redis.set(f"paused:agent:{agent_id}", "1")
        logger.warning(f"RUNAWAY DETECTOR: Agent {agent_id} PAUSED for human review")

    async def unpause_agent(self, agent_id: str) -> bool:
        """
        Clear the pause flag (human review resolution).
        Also flushes the hourly spend window so the agent gets a clean slate.
        Returns True if the agent was actually paused, False if it wasn't.
        """
        deleted = await self.redis.delete(f"paused:agent:{agent_id}")
        # Clear the hourly spend window so the agent isn't immediately re-paused
        await self.redis.delete(f"hourly_spend:{agent_id}")
        if deleted:
            logger.info(f"RUNAWAY DETECTOR: Agent {agent_id} UNPAUSED by operator")
        return deleted > 0

    async def record_and_check(
        self,
        agent_id: str,
        cost_usd: float,
        monthly_budget_usd: Optional[float],
    ) -> bool:
        """
        Record a spend event in the sliding window and check for runaway behavior.

        Returns True if the agent should be PAUSED (hourly spend > 20% of monthly budget).
        Returns False if the agent is operating normally.
        """
        if monthly_budget_usd is None or monthly_budget_usd <= 0:
            return False

        now = time.time()
        window_key = f"hourly_spend:{agent_id}"
        cutoff = now - HOURLY_WINDOW_SECONDS

        # Unique member = "{timestamp_ns}:{cost}" to avoid deduplication
        member = f"{now:.6f}:{cost_usd}"

        pipe = self.redis.pipeline()
        # 1. Add this spend event
        pipe.zadd(window_key, {member: now})
        # 2. Prune entries older than 1 hour
        pipe.zremrangebyscore(window_key, "-inf", cutoff)
        # 3. Get all remaining entries in the window
        pipe.zrange(window_key, 0, -1)
        # 4. Set TTL on the key (auto-cleanup if agent goes idle)
        pipe.expire(window_key, HOURLY_WINDOW_SECONDS + 60)
        results = await pipe.execute()

        # Sum up all costs in the window
        entries = results[2]  # zrange result
        if len(entries) < 2:
            return False

        hourly_total = 0.0
        for entry in entries:
            # Each entry is "{timestamp}:{cost}"
            try:
                hourly_total += float(entry.split(":")[-1])
            except (ValueError, IndexError):
                continue

        threshold = RUNAWAY_THRESHOLD_RATIO * monthly_budget_usd

        if hourly_total > threshold:
            logger.warning(
                f"RUNAWAY DETECTOR: Agent {agent_id} spent ${hourly_total:.6f} "
                f"in the last hour (threshold: ${threshold:.6f} = 20% of ${monthly_budget_usd:.2f})"
            )
            return True

        return False
