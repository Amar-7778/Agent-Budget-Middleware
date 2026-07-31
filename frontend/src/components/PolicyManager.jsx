import React, { useState } from 'react';

export default function PolicyManager({ spendData, onRefresh }) {
  const [teamName, setTeamName] = useState('');
  const [teamBudget, setTeamBudget] = useState('');

  const [agentTeamId, setAgentTeamId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentBudget, setAgentBudget] = useState('');
  const [agentPrefModel, setAgentPrefModel] = useState('llama-3.3-70b-versatile');
  const [agentFallModel, setAgentFallModel] = useState('llama-3.1-8b-instant');

  const [sessAgentId, setSessAgentId] = useState('');
  const [sessBudget, setSessBudget] = useState('');

  const teams = spendData?.teams || [];

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/budgets/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName, monthly_budget_usd: parseFloat(teamBudget) }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Team Policy Created!\nTeam ID: ${data.id}`);
        setTeamName('');
        setTeamBudget('');
        if (onRefresh) onRefresh();
      } else {
        alert('Error creating team policy.');
      }
    } catch (err) {
      alert('Network error creating team.');
    }
  };

  const handleCreateAgent = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/budgets/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: agentTeamId,
          name: agentName,
          monthly_budget_usd: parseFloat(agentBudget),
          preferred_model: agentPrefModel,
          fallback_model: agentFallModel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Agent Policy Created!\nAgent ID: ${data.id}`);
        setAgentTeamId('');
        setAgentName('');
        setAgentBudget('');
        if (onRefresh) onRefresh();
      } else {
        alert('Error creating agent policy.');
      }
    } catch (err) {
      alert('Network error creating agent.');
    }
  };

  const handleCreateSession = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/budgets/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: sessAgentId,
          budget_usd: parseFloat(sessBudget),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Session Started!\nSession ID: ${data.id}`);
        setSessAgentId('');
        setSessBudget('');
        if (onRefresh) onRefresh();
      } else {
        alert('Error starting session.');
      }
    } catch (err) {
      alert('Network error starting session.');
    }
  };

  return (
    <div className="tab-panel active">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Create Team Policy */}
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1.25rem', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
            Configure Team Budget Limit
          </h3>
          <form onSubmit={handleCreateTeam}>
            <div className="form-group">
              <label>Team Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Core Engineering"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Monthly Budget Cap (USD)</label>
              <input
                type="number"
                step="0.01"
                className="form-control"
                placeholder="500.00"
                value={teamBudget}
                onChange={(e) => setTeamBudget(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Save Team Policy</button>
          </form>
        </div>

        {/* Create Agent Policy */}
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1.25rem', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
            Configure Agent Policy & Fallback Reroute
          </h3>
          <form onSubmit={handleCreateAgent}>
            <div className="form-group">
              <label>Parent Team</label>
              <select
                className="form-control"
                value={agentTeamId}
                onChange={(e) => setAgentTeamId(e.target.value)}
                required
              >
                <option value="">Select Team...</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Agent Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Code Review Agent"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Monthly Budget Cap (USD)</label>
              <input
                type="number"
                step="0.01"
                className="form-control"
                placeholder="50.00"
                value={agentBudget}
                onChange={(e) => setAgentBudget(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Preferred Model</label>
                <select
                  className="form-control"
                  value={agentPrefModel}
                  onChange={(e) => setAgentPrefModel(e.target.value)}
                >
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                </select>
              </div>
              <div className="form-group">
                <label>Fallback Model (Reroute)</label>
                <select
                  className="form-control"
                  value={agentFallModel}
                  onChange={(e) => setAgentFallModel(e.target.value)}
                >
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Save Agent Policy</button>
          </form>
        </div>
      </div>

      {/* Start Session Cap */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1.25rem', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
          Start Active Session Budget Cap
        </h3>
        <form onSubmit={handleCreateSession} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>Agent ID (UUID)</label>
            <input
              type="text"
              className="form-control"
              placeholder="Paste Agent UUID"
              value={sessAgentId}
              onChange={(e) => setSessAgentId(e.target.value)}
              required
            />
          </div>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>Per-Session Spend Limit (USD)</label>
            <input
              type="number"
              step="0.01"
              className="form-control"
              placeholder="2.00"
              value={sessBudget}
              onChange={(e) => setSessBudget(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">Start Session</button>
        </form>
      </div>
    </div>
  );
}
