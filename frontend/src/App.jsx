import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CommandCenter from './components/CommandCenter';
import PolicyManager from './components/PolicyManager';
import Sandbox from './components/Sandbox';
import DemoStudio from './components/DemoStudio';
import ApiConsole from './components/ApiConsole';
import AuditDrawer from './components/AuditDrawer';

export default function App() {
  const [activeTab, setActiveTab] = useState('command');
  const [spendData, setSpendData] = useState({ teams: [], agents: [], sessions: [] });
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeRunaways, setActiveRunaways] = useState(new Set());
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  const fetchSpendMetrics = async () => {
    try {
      const res = await fetch('/dashboard/spend');
      if (res.ok) {
        const data = await res.json();
        setSpendData(data || { teams: [], agents: [], sessions: [] });

        // Check agent pause statuses
        const runaways = new Set();
        for (const agent of data.agents || []) {
          try {
            const stRes = await fetch(`/budgets/agents/${agent.agent_id}/status`);
            if (stRes.ok) {
              const stData = await stRes.json();
              if (stData.is_paused) {
                runaways.add(agent.agent_id);
              }
            }
          } catch (e) {
            // ignore status error for individual agent
          }
        }
        setActiveRunaways(runaways);
      }
    } catch (err) {
      console.error('Failed to fetch spend metrics:', err);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/audit?limit=50');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    }
  };

  const refreshAllData = () => {
    fetchSpendMetrics();
    fetchAuditLogs();
  };

  const handleUnpauseAgent = async (agentId) => {
    if (!confirm(`Are you sure you want to unpause Agent ID ${agentId}?`)) return;
    try {
      const res = await fetch(`/budgets/agents/${agentId}/unpause`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(data.message);
        refreshAllData();
      } else {
        alert('Error unpausing agent.');
      }
    } catch (err) {
      alert('Network error unpausing agent.');
    }
  };

  useEffect(() => {
    refreshAllData();
    const interval = setInterval(refreshAllData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-wrapper">
        <Header activeTab={activeTab} setActiveTab={setActiveTab} onTriggerDemo={refreshAllData} />
        <main className="content">
          {activeTab === 'command' && (
            <CommandCenter
              spendData={spendData}
              auditLogs={auditLogs}
              activeRunaways={activeRunaways}
              onUnpauseAgent={handleUnpauseAgent}
            />
          )}
          {activeTab === 'console' && (
            <PolicyManager spendData={spendData} onRefresh={refreshAllData} />
          )}
          {activeTab === 'sandbox' && (
            <Sandbox
              auditLogs={auditLogs}
              onRefresh={refreshAllData}
              onSelectAuditLog={setSelectedAuditLog}
            />
          )}
          {activeTab === 'demo' && (
            <DemoStudio onRefresh={refreshAllData} />
          )}
          {activeTab === 'api-explorer' && (
            <ApiConsole />
          )}
        </main>
      </div>

      <AuditDrawer auditLog={selectedAuditLog} onClose={() => setSelectedAuditLog(null)} />
    </>
  );
}
