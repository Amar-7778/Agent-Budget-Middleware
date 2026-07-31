import React from 'react';
import { LayoutDashboard, ShieldAlert, Terminal, PlayCircle } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const navItems = [
    { id: 'command', label: 'Command Center', icon: LayoutDashboard },
    { id: 'console', label: 'Policy Manager', icon: ShieldAlert },
    { id: 'sandbox', label: 'Agent Sandbox', icon: Terminal },
    { id: 'demo', label: 'Demo Studio', icon: PlayCircle },
    { id: 'api-explorer', label: 'API Console', icon: Terminal },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-text">
          <h1>Agent Budget Management</h1>
          <p>Agent Budget Middleware Controller</p>
        </div>
      </div>

      <ul className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <li key={item.id} className={`nav-item ${isActive ? 'active' : ''}`}>
              <button onClick={() => setActiveTab(item.id)}>
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
