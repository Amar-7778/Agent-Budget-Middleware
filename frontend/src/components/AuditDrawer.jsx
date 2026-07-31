import React from 'react';

export default function AuditDrawer({ auditLog, onClose }) {
  if (!auditLog) return null;

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose}></div>
      <aside className="drawer open">
        <div className="drawer-header">
          <h3>Spend Event Detail</h3>
          <button className="drawer-close" onClick={onClose}>&times;</button>
        </div>
        <div className="drawer-body">
          <div className="drawer-section">
            <h4>Decision Status</h4>
            <span className={`badge ${
              auditLog.event_type === 'allow' ? 'badge-allow' :
              auditLog.event_type === 'warn' ? 'badge-warn' :
              auditLog.event_type === 'reroute' ? 'badge-reroute' :
              auditLog.event_type === 'pause' ? 'badge-pause' : 'badge-block'
            }`}>
              {auditLog.event_type.toUpperCase()}
            </span>
          </div>

          <div className="drawer-section">
            <h4>Event ID & Timestamp</h4>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}><code>{auditLog.id}</code></div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(auditLog.timestamp).toLocaleString()}</div>
          </div>

          <div className="drawer-section">
            <h4>Model & Token Consumption</h4>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Model: <code>{auditLog.model_used}</code></div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Tokens In: <strong>{auditLog.tokens_in}</strong></div>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Tokens Out: <strong>{auditLog.tokens_out}</strong></div>
            <div style={{ fontSize: '0.85rem' }}>Calculated Cost: <strong style={{ color: 'var(--primary)' }}>${auditLog.cost_usd.toFixed(6)} USD</strong></div>
          </div>

          <div className="drawer-section">
            <h4>Hierarchy Entity Identifiers</h4>
            <div style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Session ID: <code>{auditLog.session_id}</code></div>
            <div style={{ fontSize: '0.8rem', marginBottom: '0.3rem' }}>Agent ID: <code>{auditLog.agent_id}</code></div>
            <div style={{ fontSize: '0.8rem' }}>Team ID: <code>{auditLog.team_id}</code></div>
          </div>
        </div>
      </aside>
    </>
  );
}
