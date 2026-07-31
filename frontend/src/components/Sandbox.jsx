import React, { useState } from 'react';

export default function Sandbox({ auditLogs, onRefresh, onSelectAuditLog }) {
  const [sessionId, setSessionId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [promptMsg, setPromptMsg] = useState('');

  const [chatResult, setChatResult] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);

  const runPresetSim = async (type) => {
    try {
      // 1. Create Preset Team
      const teamRes = await fetch('/budgets/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Preset ${type} Team`, monthly_budget_usd: type === 'REROUTE' ? 0.0001 : 100.0 })
      });
      const teamData = await teamRes.json();

      let agentBudget = 100.0;
      if (type === 'WARN') agentBudget = 0.00015;
      if (type === 'REROUTE') agentBudget = 0.00001;
      if (type === 'PAUSE') agentBudget = 0.0005;

      // 2. Create Preset Agent
      const agentRes = await fetch('/budgets/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamData.id,
          name: `Preset ${type} Agent`,
          monthly_budget_usd: agentBudget,
          preferred_model: 'llama-3.3-70b-versatile',
          fallback_model: 'llama-3.1-8b-instant'
        })
      });
      const agentData = await agentRes.json();

      let sessBudget = 10.0;
      if (type === 'BLOCK') sessBudget = 0.00001;

      // 3. Create Session
      const sessRes = await fetch('/budgets/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentData.id, budget_usd: sessBudget })
      });
      const sessData = await sessRes.json();

      setSessionId(sessData.id);
      setAgentId(agentData.id);
      setPromptMsg(`Preset ${type} governance simulation prompt test.`);

      // Send Chat Request
      const chatRes = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessData.id,
          agent_id: agentData.id,
          message: `Testing policy outcome for ${type}`
        })
      });
      const chatData = await chatRes.json();

      if (type === 'PAUSE') {
        setTimeout(async () => {
          setPromptMsg('Simulating loop recurrence request to trigger pause protection.');
          await fetch('/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessData.id,
              agent_id: agentData.id,
              message: 'Simulating loop recurrence request to trigger pause protection.'
            })
          });
          if (onRefresh) onRefresh();
        }, 300);
      }

      setChatResult({ ok: chatRes.ok, data: chatData });
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Preset simulation failed: ' + err.message);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    setChatLoading(true);
    try {
      const res = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, agent_id: agentId, message: promptMsg })
      });
      const data = await res.json();
      setChatResult({ ok: res.ok, data });
      if (onRefresh) onRefresh();
    } catch (err) {
      setChatResult({ ok: false, data: { detail: { error: err.message } } });
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="tab-panel active">
      {/* 1-Click Policy Presets */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          1-Click Policy Presets & Simulation Shortcuts
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Click any preset to automatically configure test entities and trigger live governance evaluation:
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="preset-btn" onClick={() => runPresetSim('ALLOW')}>Preset 1: Normal Allow</button>
          <button className="preset-btn" onClick={() => runPresetSim('WARN')}>Preset 2: Trigger 80% Warning</button>
          <button className="preset-btn" onClick={() => runPresetSim('REROUTE')}>Preset 3: Trigger Model Reroute</button>
          <button className="preset-btn" onClick={() => runPresetSim('BLOCK')}>Preset 4: Trigger Hard Session Block</button>
          <button className="preset-btn" onClick={() => runPresetSim('PAUSE')}>Preset 5: Trigger Runaway Loop Protection</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Chat Sandbox */}
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Interactive Chat Sandbox
          </h3>
          <form onSubmit={handleSendChat}>
            <div className="form-group">
              <label>Session ID</label>
              <input
                type="text"
                className="form-control"
                placeholder="Session UUID"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Agent ID</label>
              <input
                type="text"
                className="form-control"
                placeholder="Agent UUID"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Message Prompt</label>
              <textarea
                className="form-control"
                rows="3"
                placeholder="Enter prompt to test budget gate..."
                value={promptMsg}
                onChange={(e) => setPromptMsg(e.target.value)}
                required
              ></textarea>
            </div>
            <button type="submit" className="btn btn-primary" disabled={chatLoading}>
              {chatLoading ? 'Executing...' : 'Send Prompt'}
            </button>
          </form>
        </div>

        {/* Live Gate Result Output */}
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Live Gate Evaluation Output
          </h3>
          {chatResult ? (
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                <span className={`badge ${
                  chatResult.ok
                    ? (chatResult.data.event_type === 'warn' ? 'badge-warn' : (chatResult.data.event_type === 'reroute' ? 'badge-reroute' : 'badge-allow'))
                    : (chatResult.data?.detail?.reason === 'agent_paused_runaway_detected' ? 'badge-pause' : 'badge-block')
                }`}>
                  {chatResult.ok ? (chatResult.data.event_type || 'ALLOW').toUpperCase() : (chatResult.data?.detail?.reason === 'agent_paused_runaway_detected' ? 'PAUSE' : 'BLOCK')}
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {chatResult.ok ? `Model Used: ${chatResult.data.model_used}` : (chatResult.data?.detail?.reason === 'agent_paused_runaway_detected' ? 'Runaway Loop Terminated' : 'Rejected by Gate')}
                </span>
              </div>
              <div style={{ marginBottom: '1rem', padding: '0.85rem', background: '#F8FAFC', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}>
                <strong>Response:</strong>
                <p style={{ marginTop: '0.3rem' }}>
                  {chatResult.ok ? chatResult.data.response : (chatResult.data?.detail?.message || chatResult.data?.detail?.error || 'Budget limit exceeded.')}
                </p>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>Cost: <strong style={{ color: 'var(--text-primary)' }}>${(chatResult.data?.cost_usd || 0).toFixed(6)}</strong></span> | 
                <span> Tokens: <strong style={{ color: 'var(--text-primary)' }}>{chatResult.data?.tokens_in || 0} in / {chatResult.data?.tokens_out || 0} out</strong></span>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Run a prompt or click a preset shortcut to evaluate real-time gating decisions.
            </div>
          )}
        </div>
      </div>

      {/* Audit Stream Table */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.1rem', color: 'var(--text-primary)' }}>Spend Event Audit Stream</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Click any row to open the full inspection side drawer.</p>
          </div>
          <button className="btn btn-secondary" onClick={onRefresh}>Refresh Stream</button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Decision</th>
                <th>Model Used</th>
                <th>Cost (USD)</th>
                <th>Tokens (In/Out)</th>
                <th>Session ID</th>
              </tr>
            </thead>
            <tbody>
              {(auditLogs || []).length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No audit events logged.</td>
                </tr>
              ) : (
                auditLogs.map((log, idx) => {
                  let badgeClass = 'badge-allow';
                  if (log.event_type === 'warn') badgeClass = 'badge-warn';
                  else if (log.event_type === 'reroute') badgeClass = 'badge-reroute';
                  else if (log.event_type === 'block') badgeClass = 'badge-block';
                  else if (log.event_type === 'pause') badgeClass = 'badge-pause';

                  return (
                    <tr key={log.id || idx} className="clickable-row" onClick={() => onSelectAuditLog(log)}>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(log.timestamp).toLocaleString()}</td>
                      <td><span className={`badge ${badgeClass}`}>{log.event_type.toUpperCase()}</span></td>
                      <td style={{ fontSize: '0.825rem' }}><code>{log.model_used}</code></td>
                      <td style={{ fontWeight: 600 }}>${log.cost_usd.toFixed(6)}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{log.tokens_in} in / {log.tokens_out} out</td>
                      <td style={{ fontSize: '0.8rem' }}><code>{log.session_id}</code></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
