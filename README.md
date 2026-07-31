# Agent Budget and Cost Governance Controller Middleware (PS-8.1)

A production-grade, infrastructure-level gating proxy positioned between autonomous AI agents and third-party LLM providers (e.g., Groq API). It monitors token spend in real-time, enforces three-tiered budget governance (Team, Agent, Session), and automatically mitigates runaway loops or budget overruns before they reach LLM APIs.

## Live Production Deployment
The application is deployed live and can be accessed at:
http://32.197.189.223:8000/

## Key Features

* Three-Tiered Budget Hierarchy: Enforces limits at the Team (monthly ceiling), Agent (monthly allocations), and Session (per-run budget caps) levels.
* Atomic Spend Gating: Utilizes Redis pipeline atomic increments (INCRBYFLOAT) to make latency-free gating decisions under heavy concurrent agent workloads.
* Dynamic Policy Engine: Enforces multi-stage responses:
  * ALLOW: Normal model execution using preferred model.
  * WARN: Triggers warnings when an agent consumes 80% or more of its budget.
  * REROUTE: Automatically swaps the model to a cheaper fallback (e.g., llama-3.1-8b-instant) when the agent's preferred model budget is exhausted.
  * BLOCK: Rejects calls with HTTP 429 when team or session budgets are depleted, and closes the session.
  * PAUSE: Runaway loop detector auto-suspends agents displaying anomalous spend.
* Runaway Agent Detector: Utilizes a Redis sliding window Sorted Set (Zset) to track hourly spend. If an agent burns more than 20% of its monthly budget in an hour, it is automatically paused until human operators resolve it.
* Compensating Rollbacks & Reconciliation: Computes cost estimates pre-call, makes the provider call, and asynchronously reconciles Redis counters and PostgreSQL logs using actual input/output token counts returned by the LLM.
* Real-time Monitoring UI: Features progress bars, visual spend charts (using Chart.js), searchable audit logs, and an interactive Demo Scenario Studio to simulate agent governance traffic.

## System Architecture

```
                  ┌──────────────────────────────┐
                  │          AI Agents           │
                  │   (Concurrent Workloads)     │
                  └──────────────┬───────────────┘
                                 │
                     HTTP POST   │ Intercept Request
                     /v1/chat    ▼
                  ┌──────────────────────────────┐
                  │   FastAPI Middleware Gateway  │
                  └──────────────┬───────────────┘
                                 │
             ┌───────────────────┴───────────────────┐
             ▼ (Fast Gating Path: <1ms)              ▼ (Async Background Tasks)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│     Redis Cache & State      │        │      PostgreSQL (Neon)       │
│  - Atomic Counters (Zset)    │        │  - Dynamic Configurations    │
│  - Metadata Caches (JSON)    │        │  - Persistent Audit Logs     │
│  - Runaway sliding windows   │        │  - Entity Tables             │
└──────────────────────────────┘        └──────────────────────────────┘
             │                                       ▲
             │ (If Decision = ALLOW / WARN / REROUTE) │
             ▼                                       │ Save / Update
┌──────────────────────────────┐                     │ Spend Events
│         Groq LLM API         │─────────────────────┘ (Reconcile actuals)
│   (llama-3.3-70b-versatile / │
│    llama-3.1-8b-instant)     │
└──────────────────────────────┘
```

## Project Directory Structure

* [app/](file:///d:/Academic%20Projects/Agent%20middleware/app): FastAPI application source.
  * [main.py](file:///d:/Academic%20Projects/Agent%20middleware/app/main.py): Service initialization, middleware configuration, and router mappings.
  * [routes/](file:///d:/Academic%20Projects/Agent%20middleware/app/routes): REST endpoints for chat proxies, budgets CRUD, dashboard stats, and audit trails.
  * [adapters/](file:///d:/Academic%20Projects/Agent%20middleware/app/adapters): Base classes and adapters for third-party providers (Groq API).
* [middleware/](file:///d:/Academic%20Projects/Agent%20middleware/middleware): Core gating logic.
  * [budget_gate.py](file:///d:/Academic%20Projects/Agent%20middleware/middleware/budget_gate.py): Pipeline execution, atomic increments, policy checks, and rollbacks.
  * [runaway_detector.py](file:///d:/Academic%20Projects/Agent%20middleware/middleware/runaway_detector.py): Sliding window spend tracking and automated pauses.
* [models/](file:///d:/Academic%20Projects/Agent%20middleware/models): SQLAlchemy schema mappings (Team, Agent, Session, SpendEvent).
* [repository/](file:///d:/Academic%20Projects/Agent%20middleware/repository): Database abstraction repository layers.
* [frontend/](file:///d:/Academic%20Projects/Agent%20middleware/frontend): React frontend bundle source.
* [tests/](file:///d:/Academic%20Projects/Agent%20middleware/tests): Comprehensive test suites (unit tests, concurrency, and endpoint checks).
* [run_demo.py](file:///d:/Academic%20Projects/Agent%20middleware/run_demo.py): Command line script to simulate and run test scenarios.

## Quick Start and Local Setup

### Prerequisites
* Python 3.11+
* Node.js 20+
* PostgreSQL
* Redis

### 1. Backend Configuration
Create a .env file in the root directory by copying .env.example:
```bash
cp .env.example .env
```
Fill in the configuration details:
```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/agent_budget_db
REDIS_URL=redis://localhost:6379/0
GROQ_API_KEY=gsk_...   # Keep blank or use 'mock' for offline simulated mode
WARNING_THRESHOLD_PCT=80
```

Install requirements and launch FastAPI server:
```bash
# Setup virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install requirements
pip install -r requirements.txt

# Run database setup
python init_db.py

# Launch backend
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Configuration
Build or run the React application in dev mode:
```bash
cd frontend
npm install
npm run dev   # Runs on port 3000 (proxies API calls to port 8000)
```

Alternatively, build the production bundle to be served directly by FastAPI:
```bash
cd frontend
npm run build
```
This builds assets directly into /static in the project root, making them accessible via http://localhost:8000/.

## Running the Demo Scenario Studio

You can verify the middleware behavior either via the web dashboard or from the command line:

### CLI Demo Execution
Run the scenario script to automatically provision teams/agents and trigger simulated requests matching each gating decision:
```bash
python run_demo.py http://localhost:8000
```

### Web Demo Simulator
1. Navigate to the Live URL (or local server).
2. Go to the Demo Studio tab.
3. Select parameters (number of agents, concurrency status, budgets) and click Run Scenario.
4. The system will provision:
   * Agent 1: Triggers ALLOW status.
   * Agent 2: Trigger WARN status (exceeds 80% warning threshold).
   * Agent 3: Triggers BLOCK status (exceeds Session Budget cap, closing session).
   * Agent 4: Triggers REROUTE status (swaps to cheaper fallback model).
   * Agent 5: Triggers PAUSE status (exceeds runaway loop hourly speed threshold).

## Testing

To run the full verification test suite (unit, boundary, concurrency, and endpoints):
```bash
pytest -v
```
This runs the verification matrix, checking concurrency limits, atomic counter precision, and compensating rollbacks.
