import React from 'react';
import { Play } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, onTriggerDemo }) {
  const titles = {
    command: 'Management Command Center',
    console: 'Policy & Budget Hierarchy Manager',
    sandbox: 'Interactive Agent Sandbox & Audit Logs',
    demo: 'Demo Scenario Studio',
    'api-explorer': 'Developer API Console',
  };

  return (
    <header className="header">
      <div className="header-title">
        <h2>{titles[activeTab] || 'Management Command Center'}</h2>
      </div>
      <div className="header-actions">
        <button
          className="btn btn-primary"
          onClick={() => {
            setActiveTab('demo');
            if (onTriggerDemo) onTriggerDemo();
          }}
          style={{ fontSize: '0.85rem', padding: '0.5rem 1.1rem', borderRadius: '20px' }}
        >
          <Play size={16} />
          <span>Trigger Demo Scenario</span>
        </button>
        <div className="status-pill">
          <span className="status-dot"></span>
          <span>System Live</span>
        </div>
      </div>
    </header>
  );
}
