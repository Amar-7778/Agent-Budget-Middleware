# Agent Budget & Cost Governance Controller (PS-8.1)
## Production Technical Architecture, Approach & Problem Solutions

---

## 1. Problem Statement & Executive Context

### The Challenge: PS-8.1 Agent Budget Controller
In modern enterprise AI systems, autonomous agents operate asynchronously across multiple services and environments. When an agent enters an unexpected recursive loop or experiences a prompt-injection failure, it can fire tens of thousands of LLM API requests overnight. 

Existing compliance platforms only provide **post-hoc billing reports**—informing engineering teams about runaway costs days or weeks after the budget has been consumed. There is no real-time enforcement at the infrastructure layer.

### Objective
Build an **infrastructure-level Agent Budget Controller & Governance Middleware** that intercepts every LLM API request, tracks token and monetary spend across **Teams**, **Agents**, and **Sessions** in real-time, and enforces strict governance policies (**ALLOW**, **WARN**, **REROUTE**, **BLOCK**, and **RUNAWAY PAUSE**) *before* API calls reach third-party LLM providers.

---

## 2. System Architecture & High-Level Approach

The solution is architected as an **infrastructure-level Gating Proxy Middleware** positioned between AI Agents and LLM Provider APIs (e.g., Groq API).

```
┌─────────────────┐       ┌─────────────────────────────────────────────────────────┐       ┌───────────────────┐
│                 │       │           AGENT BUDGET MIDDLEWARE GATEWAY               │       │                   │
│   AI AGENTS     │ ────> │  1. Pre-Check: Runaway Anomaly Detection (1hr sliding)   │ ────> │   GROQ LLM API    │
│  (Concurrent    │       │  2. Atomic Budget Reservation (Redis INCRBYFLOAT)       │       │ (llama-3.3-70b /  │
│   Workloads)    │ <──── │  3. Policy Evaluation (ALLOW / WARN / REROUTE / BLOCK) │ <──── │  llama-3.1-8b)    │
│                 │       │  4. Spend Reconciliation & Async DB Audit Logging       │       │                   │
└─────────────────┘       └─────────────────────────────────────────────────────────┘       └───────────────────┘
                                       │                              │
                                       ▼                              ▼
                         ┌───────────────────────────┐  ┌───────────────────────────┐
                         │   REDIS IN-MEMORY STORE   │  │   NEON POSTGRESQL DB      │
                         │ (Atomic Counters & Cache) │  │ (Audit Logs & Entities)   │
                         └───────────────────────────┘  └───────────────────────────┘
```

### Architectural Highlights
1. **Zero-Latency In-Memory Gating**: Uses Redis pipeline atomic increments (`INCRBYFLOAT`) and metadata caching (`meta:session`, `meta:agent`, `meta:team`) to make sub-millisecond policy decisions without database bottlenecking.
2. **Atomic State & Race Condition Prevention**: Prevents concurrent read-then-write race conditions under heavy load by reserving estimated spend in Redis atomically *before* making the LLM provider call.
3. **Compensating Rollbacks & Exact Reconciliation**: Adjusts Redis counters and updates PostgreSQL audit logs with exact prompt/completion token usage and actual costs returned by the provider.

---

## 3. Core Requirements & Technical Implementations

### Requirement 1: Three-Tiered Budget Hierarchy Configuration
Budget configurations are managed dynamically at three distinct granularities:

| Hierarchy Level | Scope | Example Limit | Purpose & Behavior |
| :--- | :--- | :--- | :--- |
| **Team Budget** | Multi-product engineering group | `$500.00 / month` | Sets absolute ceiling for all agents belonging to a team. |
| **Agent Budget** | Specific AI Agent persona | `$50.00 / month` | Controls monthly allocation for an individual agent across sessions. |
| **Session Budget**| Individual task execution context | `$2.00 / session` | Prevents a single run or thread from exhausting an agent's monthly budget. |

#### Database Data Model (`models/`)
- `Team`: `id`, `name`, `monthly_budget_usd`
- `Agent`: `id`, `team_id`, `name`, `monthly_budget_usd`, `preferred_model`, `fallback_model`
- `Session`: `id`, `agent_id`, `budget_usd`, `started_at`, `status` (`active` / `closed`)
- `SpendEvent`: `id`, `session_id`, `agent_id`, `team_id`, `tokens_in`, `tokens_out`, `cost_usd`, `model_used`, `event_type`, `timestamp`

---

### Requirement 2: Real-Time Metering Layer
- Intercepts requests via `POST /v1/chat` and `BudgetGateASGIMiddleware`.
- Estimates prompt token count (`math.ceil(len(prompt) / 4.0)`) and calculates estimated cost based on model pricing tables.
- Updates running spend totals atomically in Redis (`spend:session:{id}`, `spend:agent:{id}`, `spend:team:{id}`).
- Executes provider API call via `GroqAdapter` (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`).
- Asynchronously reconciles Redis counters with exact token counts (`tokens_in`, `tokens_out`) and actual cost USD.

---

### Requirement 3: Multi-Stage Policy Enforcement Logic

The `BudgetGate` middleware evaluates reserved spend in strict hierarchical order:

```
[Incoming Request]
        │
        ▼
Is Agent Paused (Runaway Detector)? ──────► YES ──► [PAUSE] Reject request & notify human review
        │ NO
        ▼
Session Budget Exceeded? ──────────────────► YES ──► [BLOCK] Return HTTP 429 & Close Session in DB
        │ NO
        ▼
Team Budget Exceeded? ─────────────────────► YES ──► [BLOCK] Return HTTP 429 Team Budget Exceeded
        │ NO
        ▼
Agent Monthly Budget Exceeded? ────────────► YES ──► [REROUTE] Automatic Model Substitution
        │ NO
        ▼
Agent Spend >= 80% Threshold? ─────────────► YES ──► [WARN] Allow call + set Warning Header
        │ NO
        ▼
[ALLOW] Normal Model Execution
```

1. **Warning Trigger (80% Threshold)**:
   - When spend reaches 80% of configured monthly budget, `BudgetGate` attaches warning metadata flags (`should_warn=True`, `X-Budget-Gate-Warning: 80% consumed`) while allowing execution to proceed.
2. **Hard Block (100% Consumed)**:
   - When monthly team/agent budget is fully consumed, new requests are rejected with `HTTP 429 Too Many Requests` and body `{"error": "budget_exhausted", "reason": "agent_budget_exceeded"}`.
3. **Session Closure**:
   - When a session budget cap is hit, `BudgetGate` rejects the request, updates session status to `"closed"` in PostgreSQL, and prevents further calls within that session context.
4. **Model Substitution (Rerouting)**:
   - When an agent's monthly budget for its preferred model (`llama-3.3-70b-versatile`) is exhausted, `BudgetGate` automatically reroutes the request to a cheaper fallback model (`llama-3.1-8b-instant`, 10x cheaper) rather than hard-blocking the workflow.

---

### Requirement 4: Bonus — Runaway Agent Loop Detector
To protect against recursive loops and prompt-injection runaway behavior:
- **Algorithm**: Tracks spend per agent over a 1-hour sliding window in Redis (`runaway:agent:{agent_id}:window`).
- **Threshold**: If an agent consumes **more than 20% of its monthly budget in a single hour**, `RunawayDetector` automatically:
  1. Flags the agent state as `PAUSED` in Redis (`paused:agent:{agent_id}`).
  2. Rejects all subsequent requests with `HTTP 429` (`reason: agent_paused_runaway_detected`).
  3. Fires an alert event requiring human administrator intervention to unpause.

---

### Requirement 5: Real-Time Governance Dashboard UI
Built a single-page monitoring dashboard (`static/index.html`, `static/js/dashboard.js`) featuring:
1. **Interactive Chart.js Visualizations**:
   - **Spend vs Budget Utilization**: Horizontal bar chart comparing current spend vs limit for all active teams and agents.
   - **Policy Decision Ratio**: Doughnut chart visualizing real-time ratio of `ALLOW`, `WARN`, `REROUTE`, and `BLOCK` outcomes.
2. **Command Center Gauges**: Real-time progress bars color-coded by policy state (Green Safe, Yellow 80% Warning, Red Exceeded).
3. **Audit Log Stream**: Searchable, filterable execution table with clickable detail side drawers.
4. **Demo Scenario Studio**: 1-Click interactive multi-agent traffic generator and cleanup environment.

---

## 4. Concurrency & High-Throughput Solutions

During initial load testing (5 concurrent users firing 5 req/sec), performance bottlenecks were identified and resolved:

### Problem 1: Database Connection Pool Exhaustion under Load
- **Cause**: Default SQLAlchemy async engine connection pool size was `5`, causing connection starvation and timeouts under concurrent load.
- **Solution**: Scaled engine pool parameters in `database.py`:
  ```python
  engine_kwargs.update({
      "pool_size": 20,
      "max_overflow": 30,
      "pool_timeout": 30,
      "pool_pre_ping": True,
      "pool_recycle": 300,
  })
  ```

### Problem 2: Uncached DB Lookups per LLM Call
- **Cause**: Intercepting every chat call executed 3 SQL `SELECT` queries against PostgreSQL (`sessions`, `agents`, `teams`).
- **Solution**: Implemented Redis metadata caching (`meta:session:{id}`, `meta:agent:{id}`, `meta:team:{id}`) with a 300s TTL. Reduced limit verification latency from **~50ms database roundtrips down to <1ms in-memory execution**.

---

## 5. Verification Matrix & Success Criteria

All success criteria specified in the challenge have been verified via automated test suites (`tests/`) and live production benchmarks:

| Success Criteria | Status | Implementation Proof |
| :--- | :---: | :--- |
| **Concurrent Call Tracking** | `PASSED` | `test_concurrency_50_plus_simultaneous_calls` verified atomic Redis `INCRBYFLOAT` precision across 50+ parallel requests. |
| **80% Warning Trigger** | `PASSED` | `test_boundary_exactly_80_percent_triggers_warning` asserts warning flags fire when spend crosses 80%. |
| **100% Hard Block** | `PASSED` | `test_chat_budget_blocked` asserts `HTTP 429` rejection when budget is exhausted. |
| **Session Closure** | `PASSED` | `test_chat_budget_blocked` verifies session status updates to `"closed"` in DB upon session cap hit. |
| **Model Substitution** | `PASSED` | `test_reroute_signal_on_agent_budget_exceeded` verifies automatic rerouting from `llama-3.3-70b-versatile` to `llama-3.1-8b-instant`. |
| **Runaway Agent Detector** | `PASSED` | `RunawayDetector` flags agent and pauses execution when hourly spend exceeds 20% of monthly budget. |
| **15/15 Endpoints Healthy** | `PASSED` | Live verification script confirmed 100% HTTP 200/201 pass rate across all REST API endpoints. |

---

## 6. Production Deployment Architecture

- **Docker Containerization**: Multi-stage `Dockerfile` and `docker-compose.yml` orchestrating FastAPI `uvicorn` application and Redis services.
- **Production Server (AWS EC2)**: Live deployment at `http://32.197.189.223:8000`.
- **Database Backend**: Managed Neon PostgreSQL (`postgresql+asyncpg://...`) with SSL and prepared statement cache disabling.
- **GitHub CI/CD Sync**: Repository maintained at [Amar-7778/Agent-Budget-Middleware](https://github.com/Amar-7778/Agent-Budget-Middleware).
