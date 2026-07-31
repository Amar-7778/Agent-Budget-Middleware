import React, { useState } from 'react';
import { Play, Trash2, CheckCircle2 } from 'lucide-react';

export default function DemoStudio({ onRefresh, showAlert, showConfirm }) {
  const [loading, setLoading] = useState(false);
  const [demoData, setDemoData] = useState(null);

  const handleRunDemo = async () => {
    setLoading(true);
    setDemoData(null);
    try {
      const res = await fetch('/demo/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          num_agents: 5,
          requests_per_agent: 15,
          team_budget_usd: 2.00,
          agent_budget_usd: 0.30,
          session_budget_usd: 0.05,
          concurrency: true
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDemoData(data);
      if (onRefresh) onRefresh();
    } catch (err) {
      if (showAlert) showAlert('Demo Execution Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupDemo = async () => {
    const confirmed = await showConfirm(
      'Clean Up Demo Scenario Data',
      'Are you sure you want to delete all demo scenario data, reset agent budgets, and clear active test sessions?',
      'Delete Demo Data',
      'Cancel'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/demo/cleanup', { method: 'DELETE' });
      if (res.ok) {
        if (showAlert) showAlert('Cleanup Complete', 'Demo scenario data has been cleaned up successfully!');
        setDemoData(null);
        if (onRefresh) onRefresh();
      } else {
        if (showAlert) showAlert('Error', 'Failed to clean up demo scenario data.');
      }
    } catch (err) {
      if (showAlert) showAlert('Network Error', 'Network error during cleanup operation.');
    }
  };

  return (
    <div className="tab-panel active">
      {/* Demo Studio Header Banner */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.25rem', marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
              Production Multi-Agent Governance Demo Generator
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', maxWidth: '650px' }}>
              Provision a multi-agent scenario and fire real concurrent traffic (via <code>asyncio.gather</code>) to show every outcome (<strong>ALLOW</strong>, <strong>WARN</strong>, <strong>BLOCK</strong>, <strong>REROUTE</strong>, <strong>PAUSE</strong>) live, backed by real Groq calls and atomic Redis/Postgres state.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button id="btn-run-demo" className="btn btn-primary" onClick={handleRunDemo} disabled={loading}>
              <Play size={18} />
              <span>{loading ? 'Running Scenario...' : 'Run demo scenario'}</span>
            </button>
            <button id="btn-cleanup-demo" className="btn btn-secondary" onClick={handleCleanupDemo} disabled={loading}>
              <Trash2 size={18} />
              <span>Cleanup Demo Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', marginBottom: '2rem' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--info)', marginBottom: '0.5rem' }}>
            Provisioning Scenario & Firing Concurrent Traffic...
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Executing <code>asyncio.gather</code> concurrent LLM requests against Budget Gate middleware...
          </p>
        </div>
      )}

      {/* Demo Summary Results Table */}
      {demoData && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
              Live Enforcement Outcomes & Summary Table
            </h3>
            <span className="badge badge-reroute">
              Duration: {(demoData.summary?.duration_seconds || 0).toFixed(2)}s
            </span>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Requests Sent</th>
                  <th>ALLOW</th>
                  <th>WARN (&gt;=80%)</th>
                  <th>BLOCK</th>
                  <th>REROUTE</th>
                  <th>PAUSE</th>
                  <th>Final Spend (USD)</th>
                  <th>Budget Limit (USD)</th>
                </tr>
              </thead>
              <tbody>
                {(demoData.agents || []).map((agent) => {
                  const oc = agent.outcomes || {};
                  return (
                    <tr key={agent.agent_id}>
                      <td>
                        <strong>{agent.name}</strong> <br />
                        <code style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{agent.agent_id}</code>
                      </td>
                      <td style={{ fontWeight: 600 }}>{agent.requests_sent}</td>
                      <td><span className="badge badge-allow">{oc.allow || 0}</span></td>
                      <td><span className={`badge ${oc.warn > 0 ? 'badge-warn' : ''}`}>{oc.warn || 0}</span></td>
                      <td><span className={`badge ${oc.block > 0 ? 'badge-block' : ''}`}>{oc.block || 0}</span></td>
                      <td><span className={`badge ${oc.reroute > 0 ? 'badge-reroute' : ''}`}>{oc.reroute || 0}</span></td>
                      <td><span className={`badge ${oc.pause > 0 ? 'badge-pause' : ''}`}>{oc.pause || 0}</span></td>
                      <td style={{ fontWeight: 600, color: agent.final_spend_usd > agent.budget_usd ? 'var(--danger)' : 'var(--text-main)' }}>
                        ${(agent.final_spend_usd || 0).toFixed(4)}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>${(agent.budget_usd || 0).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Default Placeholder Card */}
      {!loading && !demoData && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', marginBottom: '2rem' }}>
          <CheckCircle2 size={48} style={{ margin: '0 auto 1rem', opacity: 0.5, color: 'var(--primary)' }} />
          <p style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
            Click <strong>"Run demo scenario"</strong> above to provision agents and fire live concurrent traffic.
          </p>
          <p style={{ fontSize: '0.825rem', marginTop: '0.4rem' }}>
            The scenario will test atomic Redis counters under load and display real database enforcement outcomes in a live summary table.
          </p>
        </div>
      )}
    </div>
  );
}
