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
    payload = json.dumps({"scenario": "full_governance", "reset_first": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:

            res_data = json.loads(resp.read().decode())
            
            summary = res_data.get("summary", {})
            print(f"\n[SUCCESS] DEMO SCENARIO EXECUTION COMPLETE!")
            print(f"Total Prompts Evaluated: {summary.get('total_prompts')}")
            print(f"Summary: ALLOW={summary.get('allow_count')} | WARN={summary.get('warn_count')} | REROUTE={summary.get('reroute_count')} | BLOCK={summary.get('block_count')}")
            print(f"Total Recorded Spend: ${summary.get('total_demo_spend_usd', 0.0):.6f}\n")

            print("=" * 70)
            print("STEP-BY-STEP AGENT GOVERNANCE RESULTS:")
            print("=" * 70)

            for step in res_data.get("steps", []):
                event_type = step.get("event_type", "").upper()
                icon = "[ALLOW]" if event_type == "ALLOW" else (" [WARN]" if event_type == "WARN" else (" [REROUTE]" if event_type == "REROUTE" else "[BLOCK]"))


                print(f"\n{icon} Step {step.get('step')}: {step.get('agent_name')} ({step.get('agent_id')})")
                print(f"   Policy Decision : [{event_type}]")
                print(f"   Model Used      : {step.get('model_used')}")
                print(f"   Cost (USD)      : ${step.get('cost_usd', 0.0):.6f}")
                print(f"   Tokens          : {step.get('tokens_in')} In / {step.get('tokens_out')} Out")
                print(f"   Prompt          : \"{step.get('prompt')}\"")
                print(f"   Response        : {step.get('response')[:90]}...")
                print(f"   Explanation     : {step.get('explanation')}")

            print("\n" + "=" * 70)
            print("To view live metrics and spend gauges, open the Web Dashboard at:")
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
