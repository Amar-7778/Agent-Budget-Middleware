import React, { useState } from 'react';

export default function ApiConsole({ showAlert }) {
  const [selectedEndpoint, setSelectedEndpoint] = useState('HEALTH_LIVE');
  const [requestBody, setRequestBody] = useState('');
  const [showBodyInput, setShowBodyInput] = useState(false);
  const [responseOutput, setResponseOutput] = useState('// Executed response output will render here...');
  const [latency, setLatency] = useState('--');
  const [statusBadge, setStatusBadge] = useState({ text: 'Awaiting Execution', class: 'badge' });

  const endpoints = {
    HEALTH_LIVE: { method: 'GET', url: '/health/live', body: null },
    HEALTH_READINESS: { method: 'GET', url: '/health', body: null },
    DASHBOARD_SPEND: { method: 'GET', url: '/dashboard/spend', body: null },
    DEMO_RUN: { method: 'POST', url: '/demo/run', body: { num_agents: 5, requests_per_agent: 15 } },
    DEMO_CLEANUP: { method: 'DELETE', url: '/demo/cleanup', body: null },
    CHAT_V1: { method: 'POST', url: '/v1/chat', body: { session_id: 'session-uuid', agent_id: 'agent-uuid', message: 'Hello AI' } },
    CREATE_TEAM: { method: 'POST', url: '/budgets/teams', body: { name: 'Engineering', monthly_budget_usd: 500.0 } },
    CREATE_AGENT: { method: 'POST', url: '/budgets/agents', body: { team_id: 'team-uuid', name: 'Coder Agent', monthly_budget_usd: 50.0 } },
    CREATE_SESSION: { method: 'POST', url: '/budgets/sessions', body: { agent_id: 'agent-uuid', budget_usd: 2.0 } },
    UNPAUSE_AGENT: { method: 'POST', url: '/budgets/agents/agent-uuid/unpause', body: null },
    AGENT_STATUS: { method: 'GET', url: '/budgets/agents/agent-uuid/status', body: null },
    GET_AUDIT: { method: 'GET', url: '/audit?limit=50', body: null },
  };

  const handleEndpointChange = (key) => {
    setSelectedEndpoint(key);
    const ep = endpoints[key];
    if (ep.body) {
      setRequestBody(JSON.stringify(ep.body, null, 2));
      setShowBodyInput(true);
    } else {
      setRequestBody('');
      setShowBodyInput(false);
    }
  };

  const handleExecute = async () => {
    const ep = endpoints[selectedEndpoint];
    const startTime = performance.now();
    try {
      const options = { method: ep.method, headers: {} };
      if (ep.body && requestBody) {
        options.headers['Content-Type'] = 'application/json';
        options.body = requestBody;
      }
      const res = await fetch(ep.url, options);
      const endTime = performance.now();
      setLatency((endTime - startTime).toFixed(1));

      const data = await res.json();
      setResponseOutput(JSON.stringify(data, null, 2));

      if (res.ok) {
        setStatusBadge({ text: `${res.status} OK`, class: 'badge badge-allow' });
      } else {
        setStatusBadge({ text: `${res.status} ${res.statusText}`, class: 'badge badge-block' });
      }
    } catch (err) {
      setResponseOutput('Error: ' + err.message);
      setStatusBadge({ text: 'Error', class: 'badge badge-block' });
    }
  };

  const handleCopyAsCurl = () => {
    const ep = endpoints[selectedEndpoint];
    let curl = `curl -X ${ep.method} "http://localhost:8000${ep.url}"`;
    if (ep.body && requestBody) {
      curl += ` -H "Content-Type: application/json" -d '${requestBody.replace(/\n/g, '')}'`;
    }
    navigator.clipboard.writeText(curl);
    if (showAlert) showAlert('cURL Copied', 'cURL command copied to clipboard!');
  };

  return (
    <div className="tab-panel active">
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
          Developer Endpoint Playground
        </h3>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <select
            className="form-control"
            value={selectedEndpoint}
            onChange={(e) => handleEndpointChange(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="HEALTH_LIVE">GET /health/live (Liveness Probe)</option>
            <option value="HEALTH_READINESS">GET /health (Readiness Probe)</option>
            <option value="DASHBOARD_SPEND">GET /dashboard/spend (Live Spend Metrics)</option>
            <option value="DEMO_RUN">POST /demo/run (Run Live Demo Scenario)</option>
            <option value="DEMO_CLEANUP">DELETE /demo/cleanup (Cleanup Demo Data)</option>
            <option value="CHAT_V1">POST /v1/chat (LLM Request + Budget Gate)</option>
            <option value="CREATE_TEAM">POST /budgets/teams (Create Team Policy)</option>
            <option value="CREATE_AGENT">POST /budgets/agents (Create Agent Policy)</option>
            <option value="CREATE_SESSION">POST /budgets/sessions (Start Session Cap)</option>
            <option value="UNPAUSE_AGENT">POST /budgets/agents/{`{id}`}/unpause (Resume Paused Agent)</option>
            <option value="AGENT_STATUS">GET /budgets/agents/{`{id}`}/status (Check Pause Status)</option>
            <option value="GET_AUDIT">GET /audit (Audit Log Stream)</option>
          </select>
          <button className="btn btn-primary" onClick={handleExecute}>Execute Request</button>
          <button className="btn btn-secondary" onClick={handleCopyAsCurl}>Copy as cURL</button>
        </div>

        {showBodyInput && (
          <div className="form-group">
            <label>Request Body Payload (JSON)</label>
            <textarea
              className="form-control"
              rows={5}
              style={{ fontFamily: 'JetBrains Mono' }}
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
            ></textarea>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h4 style={{ fontFamily: 'Crete Round', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>Response Payload</h4>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Latency: {latency} ms</span>
            <span className={statusBadge.class}>{statusBadge.text}</span>
          </div>
        </div>
        <pre className="code-block">{responseOutput}</pre>
      </div>
    </div>
  );
}
