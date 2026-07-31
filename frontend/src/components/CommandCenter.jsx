import React from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export default function CommandCenter({ spendData, auditLogs, activeRunaways, onUnpauseAgent }) {
  const teams = spendData?.teams || [];
  const agents = spendData?.agents || [];
  const sessions = spendData?.sessions || [];

  // Calculate audit event counts
  let allowCount = 0, warnCount = 0, rerouteCount = 0, blockCount = 0, pauseCount = 0;
  let totalSaved = 0;

  (auditLogs || []).forEach(log => {
    if (log.event_type === 'allow') allowCount++;
    else if (log.event_type === 'warn') warnCount++;
    else if (log.event_type === 'reroute') rerouteCount++;
    else if (log.event_type === 'block') { blockCount++; totalSaved += 0.05; }
    else if (log.event_type === 'pause') { pauseCount++; totalSaved += 0.05; }
  });

  const threatCount = activeRunaways?.size || 0;
  if (threatCount > 0) {
    totalSaved += (threatCount * 12.50);
  }

  // Bar Chart Data
  const barLabels = [];
  const barSpend = [];
  const barBudget = [];

  teams.forEach(t => {
    barLabels.push(`Team: ${t.name}`);
    barSpend.push(t.current_spend_usd);
    barBudget.push(t.monthly_budget_usd);
  });

  agents.forEach(a => {
    barLabels.push(`Agent: ${a.name}`);
    barSpend.push(a.current_spend_usd);
    barBudget.push(a.monthly_budget_usd);
  });

  if (barLabels.length === 0) {
    barLabels.push('No Metrics');
    barSpend.push(0);
    barBudget.push(0);
  }

  const barData = {
    labels: barLabels,
    datasets: [
      {
        label: 'Current Spend ($)',
        data: barSpend,
        backgroundColor: 'rgba(5, 150, 105, 0.85)',
        borderColor: '#059669',
        borderWidth: 1.5,
        borderRadius: 6,
      },
      {
        label: 'Budget Limit ($)',
        data: barBudget,
        backgroundColor: 'rgba(2, 132, 199, 0.20)',
        borderColor: '#0284C7',
        borderWidth: 1.5,
        borderRadius: 6,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#0F172A', font: { family: "'Crete Round', serif", size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: $${ctx.raw.toFixed(4)}`
        }
      }
    },
    scales: {
      x: { ticks: { color: '#334155', font: { family: "'Crete Round', serif", size: 10 } }, grid: { display: false } },
      y: { ticks: { color: '#334155', font: { family: "'Crete Round', serif" } }, grid: { color: '#E2E8F0' } }
    }
  };

  // Doughnut Chart Data
  let doughnutVals = [allowCount, warnCount, rerouteCount, blockCount, pauseCount];
  let doughnutLabels = ['ALLOW', 'WARN', 'REROUTE', 'BLOCK', 'PAUSE'];
  let doughnutColors = ['#059669', '#D97706', '#0284C7', '#DC2626', '#7C3AED'];

  if (allowCount + warnCount + rerouteCount + blockCount + pauseCount === 0) {
    doughnutVals = [1];
    doughnutLabels = ['No Telemetry'];
    doughnutColors = ['#E2E8F0'];
  }

  const doughnutData = {
    labels: doughnutLabels,
    datasets: [
      {
        data: doughnutVals,
        backgroundColor: doughnutColors,
        borderWidth: 2,
        borderColor: '#FFFFFF',
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#0F172A', font: { family: "'Crete Round', serif", size: 10 }, boxWidth: 12 } }
    },
    cutout: '68%'
  };

  return (
    <div className="tab-panel active">
      {/* Runaway Threat Alert Banner */}
      {threatCount > 0 && (
        <div className="card threat-critical" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
                <span className="badge badge-block" style={{ animation: 'pulse-green 1s infinite' }}>INCIDENT DETECTED</span>
                <h3 className="pulsate-text" style={{ fontFamily: 'Crete Round', fontSize: '1.25rem', fontWeight: 700, color: '#B91C1C' }}>
                  Runaway Agent Action Required
                </h3>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', maxWidth: '750px' }}>
                An agent has triggered the <strong>20% hourly runaway spending threshold</strong> (loop protection). Call interception has been activated at the infrastructure layer to prevent unlimited cost overruns.
              </p>
              <div style={{ marginTop: '1rem' }}>
                {agents.filter(a => activeRunaways.has(a.agent_id)).map(a => (
                  <div key={a.agent_id} className="incident-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0.75rem', background: '#FFFFFF', borderRadius: 'var(--radius-sm)', border: '1px solid #FECACA' }}>
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: '#B91C1C' }}>{a.name} ({a.agent_id})</h4>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Spend of ${a.current_spend_usd.toFixed(4)} exceeds runaway rate limit (&gt;20% monthly budget of ${a.monthly_budget_usd.toFixed(2)} in 1 hour)
                      </p>
                    </div>
                    <button className="btn btn-secondary" onClick={() => onUnpauseAgent(a.agent_id)} style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}>
                      Operator Unpause
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#B91C1C' }}>Estimated Costs Saved</div>
                <div style={{ fontFamily: 'Crete Round', fontSize: '1.6rem', fontWeight: 700, color: '#991B1B' }}>${totalSaved.toFixed(4)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid-stats">
        <div className="card">
          <div className="card-header"><span className="card-title">Total Configured Teams</span></div>
          <div className="card-val">{teams.length}</div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Total Active Agents</span></div>
          <div className="card-val">{agents.length}</div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Active Sessions Monitored</span></div>
          <div className="card-val">{sessions.filter(s => s.status !== 'closed').length}</div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Loop Interceptions (Runaways)</span></div>
          <div className="card-val" style={{ color: threatCount > 0 ? '#B91C1C' : 'var(--text-primary)' }}>{threatCount}</div>
        </div>
      </div>

      {/* Decision Analytics Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="counter-box" style={{ borderLeft: '4px solid #059669' }}>
          <div className="counter-label" style={{ color: '#047857' }}>ALLOW</div>
          <div className="counter-num" style={{ color: '#047857' }}>{allowCount}</div>
        </div>
        <div className="counter-box" style={{ borderLeft: '4px solid #D97706' }}>
          <div className="counter-label" style={{ color: '#B45309' }}>WARN (&gt;=80%)</div>
          <div className="counter-num" style={{ color: '#B45309' }}>{warnCount}</div>
        </div>
        <div className="counter-box" style={{ borderLeft: '4px solid #0284C7' }}>
          <div className="counter-label" style={{ color: '#0369A1' }}>REROUTE</div>
          <div className="counter-num" style={{ color: '#0369A1' }}>{rerouteCount}</div>
        </div>
        <div className="counter-box" style={{ borderLeft: '4px solid #DC2626' }}>
          <div className="counter-label" style={{ color: '#B91C1C' }}>BLOCK</div>
          <div className="counter-num" style={{ color: '#B91C1C' }}>{blockCount}</div>
        </div>
        <div className="counter-box" style={{ borderLeft: '4px solid #7C3AED' }}>
          <div className="counter-label" style={{ color: '#6D28D9' }}>PAUSE</div>
          <div className="counter-num" style={{ color: '#6D28D9' }}>{pauseCount}</div>
        </div>
      </div>

      {/* Analytics Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
            Real-Time Spend vs Budget Utilization
          </h3>
          <div style={{ height: '260px', position: 'relative' }}>
            <Bar data={barData} options={barOptions} />
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
            Policy Decision Ratio
          </h3>
          <div style={{ height: '260px', position: 'relative' }}>
            <Doughnut data={doughnutData} options={doughnutOptions} />
          </div>
        </div>
      </div>

      {/* Team Budget Utilization Gauges */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1.25rem', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
          Team Budget Utilization
        </h3>
        <div>
          {teams.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
              No teams configured yet.
            </div>
          ) : (
            teams.map(t => {
              const pct = (t.current_spend_usd / t.monthly_budget_usd) * 100 || 0;
              let barColor = 'var(--success)';
              if (pct >= 100) barColor = 'var(--danger)';
              else if (pct >= 80) barColor = 'var(--warning)';

              return (
                <div key={t.id} style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    <span>{t.name} <code style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>({t.id})</code></span>
                    <span>${t.current_spend_usd.toFixed(2)} / ${t.monthly_budget_usd.toFixed(2)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}></div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Active Agent Cards */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontFamily: 'Crete Round', marginBottom: '1.25rem', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
          Active Agent Allocations
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          {agents.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
              No agents configured yet.
            </div>
          ) : (
            agents.map(a => {
              const pct = (a.current_spend_usd / a.monthly_budget_usd) * 100 || 0;
              let barColor = 'var(--success)';
              let badgeClass = 'badge-allow';
              let statusText = 'Normal';

              if (pct >= 100) { barColor = 'var(--danger)'; badgeClass = 'badge-block'; statusText = 'Exceeded'; }
              else if (pct >= 80) { barColor = 'var(--warning)'; badgeClass = 'badge-warn'; statusText = 'Warning (>=80%)'; }

              const isPaused = activeRunaways?.has(a.agent_id);
              if (isPaused) { badgeClass = 'badge-pause'; statusText = 'Paused (Runaway)'; }

              return (
                <div key={a.agent_id} className="card">
                  <div className="card-header">
                    <span className="card-title">{a.name}</span>
                    <span className={`badge ${badgeClass}`}>{statusText}</span>
                  </div>
                  <div className="card-val">${a.current_spend_usd.toFixed(2)} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/ ${a.monthly_budget_usd.toFixed(2)}</span></div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>ID: <code style={{ fontSize: '0.72rem', color: 'var(--primary)' }}>{a.agent_id}</code></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Model: <code>{a.preferred_model}</code></div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}></div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'right' }}>{pct.toFixed(1)}% Used</div>
                  {isPaused && (
                    <div style={{ marginTop: '0.85rem' }}>
                      <button className="btn btn-primary" onClick={() => onUnpauseAgent(a.agent_id)} style={{ padding: '0.45rem 0.85rem', fontSize: '0.825rem', width: '100%', borderRadius: 'var(--radius-sm)' }}>
                        Resume Agent (Clear Loop Pause)
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Active Sessions Grid */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ fontFamily: 'Crete Round', fontSize: '1.15rem', color: 'var(--text-primary)' }}>Active Sessions Monitor</h3>
          <span className="badge badge-allow">{sessions.filter(s => s.status !== 'closed').length} Active</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {sessions.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
              No sessions active. Run scenarios to spin up sessions.
            </div>
          ) : (
            sessions.map(s => {
              const pct = s.pct_used || 0;
              const isClosed = s.status === 'closed';
              let badgeClass = 'badge-allow';
              let badgeText = 'Active';
              let borderStyle = 'border-color: var(--border-color);';

              if (isClosed) {
                badgeClass = 'badge-block';
                badgeText = 'Closed';
                borderStyle = 'border-color: #FECACA; background-color: #FEF2F2;';
              } else if (pct >= 80) {
                badgeClass = 'badge-warn';
                badgeText = 'Warning';
                borderStyle = 'border-color: #FDE68A; background-color: #FFFBEB;';
              }

              return (
                <div key={s.session_id} style={{ padding: '1rem', border: '1px solid', borderRadius: 'var(--radius-sm)', borderStyle, transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Session: <code style={{ fontFamily: 'JetBrains Mono', fontSize: '0.72rem', color: 'var(--primary)' }}>{s.session_id}</code></span>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Agent: {s.agent_name}</div>
                    </div>
                    <span className={`badge ${badgeClass}`} style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}>{badgeText}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                    ${(s.current_spend_usd || 0).toFixed(4)} / ${(s.budget_usd || 0).toFixed(2)}
                  </div>
                  <div className="progress-bar-bg" style={{ marginTop: '0.4rem', height: '6px' }}>
                    <div className="progress-bar-fill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: isClosed ? 'var(--danger)' : (pct >= 80 ? 'var(--warning)' : 'var(--success)') }}></div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
