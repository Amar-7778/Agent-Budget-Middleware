#!/usr/bin/env python3
"""
Agent Budget Middleware — Production Demo Scenario Runner

Run this script from terminal to execute an end-to-end multi-agent budget governance demo.
Command:
    python run_demo.py [http://localhost:8000]
"""

import sys
import json
import urllib.request
import urllib.error

def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    base_url = base_url.rstrip("/")

    print("=" * 70)
    print("      AGENT BUDGET MIDDLEWARE — PRODUCTION DEMO SCENARIO RUNNER")
    print("=" * 70)
    print(f"Target Service URL: {base_url}\n")

    # 1. Check Service Health (Fail-Soft)
    try:
        req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            print(f"[HEALTH CHECK] Status: {data.get('status')} | Redis: {data.get('redis')} | Postgres: {data.get('postgres')}\n")
    except urllib.error.HTTPError as err:
        try:
            body = json.loads(err.read().decode())
            print(f"[HEALTH CHECK WARNING] HTTP {err.code}: System reporting degraded dependencies ({body.get('failed_dependencies')}).")
            print("Proceeding with Fail-Soft Demo Scenario execution via Redis Gating...\n")
        except Exception:
            print(f"[HEALTH CHECK WARNING] HTTP {err.code}: System reported degraded status. Proceeding with demo run...\n")
    except Exception as e:
        print(f"[HEALTH CHECK WARNING] Could not reach /health: {e}. Attempting /demo/run...\n")

    # 2. Trigger Demo Run
    print("Executing Multi-Agent Governance Demo Scenario...")
    print("-" * 70)

    url = f"{base_url}/demo/run"
    payload = json.dumps({
        "num_agents": 5,
        "requests_per_agent": 5,
        "team_budget_usd": 2.00,
        "agent_budget_usd": 0.30,
        "session_budget_usd": 0.05,
        "concurrency": True
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:

            res_data = json.loads(resp.read().decode())

            summary = res_data.get("summary", {})
            agents = res_data.get("agents", [])

            print(f"\n[SUCCESS] DEMO SCENARIO EXECUTION COMPLETE!")
            print(f"Team ID: {res_data.get('team_id')}")
            print(f"Total Requests Evaluated: {summary.get('total_requests', 0)}")
            print(f"Total System Spend: ${summary.get('total_spend_usd', 0.0):.6f}")
            print(f"Duration: {summary.get('duration_seconds', 0.0):.2f}s")
            print(f"Any Budget Exceeded: {summary.get('any_budget_exceeded', False)}\n")

            print("=" * 70)
            print("AGENT-BY-AGENT GOVERNANCE RESULTS:")
            print("=" * 70)

            for agent in agents:
                oc = agent.get("outcomes", {})
                name = agent.get("name", "Unknown")
                agent_id = agent.get("agent_id", "N/A")
                requests_sent = agent.get("requests_sent", 0)
                spend = agent.get("final_spend_usd", 0.0)
                budget = agent.get("budget_usd", 0.0)

                allow_cnt = oc.get("allow", 0)
                warn_cnt = oc.get("warn", 0)
                block_cnt = oc.get("block", 0)
                reroute_cnt = oc.get("reroute", 0)
                pause_cnt = oc.get("pause", 0)

                # Determine primary outcome icon
                if pause_cnt > 0:
                    icon = "⏸ [PAUSE]"
                elif block_cnt > 0:
                    icon = "🔴[BLOCK]"
                elif reroute_cnt > 0:
                    icon = "🔵[REROUTE]"
                elif warn_cnt > 0:
                    icon = "🟡[WARN]"
                else:
                    icon = "🟢[ALLOW]"

                print(f"\n{icon} {name} ({agent_id})")
                print(f"   Requests Sent   : {requests_sent}")
                print(f"   Outcomes        : ALLOW={allow_cnt} | WARN={warn_cnt} | BLOCK={block_cnt} | REROUTE={reroute_cnt} | PAUSE={pause_cnt}")
                print(f"   Final Spend     : ${spend:.6f} / ${budget:.6f} budget")

                if spend > budget:
                    print(f"   ⚠️  SPEND EXCEEDS BUDGET")

            # Summary footer
            print("\n" + "=" * 70)
            violation = summary.get("any_budget_exceeded", False)
            if violation:
                print("⚠️  VIOLATION DETECTED: At least one agent exceeded its configured budget.")
            else:
                print("✅ ALL BUDGETS ENFORCED: Atomic Redis reservation + rollback passed.")

            print(f"\nTo view live metrics and spend gauges, open the Web Dashboard at:")
            print(f"URL: {base_url}/")
            print("=" * 70 + "\n")


    except urllib.error.HTTPError as err:
        body = err.read().decode()
        print(f"[ERROR] HTTP {err.code} from /demo/run: {body}")
        sys.exit(1)
    except Exception as exc:
        print(f"[ERROR] Failed to execute demo scenario: {exc}")
        sys.exit(1)

if __name__ == "__main__":
    main()
