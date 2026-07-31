import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CommandCenter from './components/CommandCenter';
import PolicyManager from './components/PolicyManager';
import Sandbox from './components/Sandbox';
import DemoStudio from './components/DemoStudio';
import ApiConsole from './components/ApiConsole';
import AuditDrawer from './components/AuditDrawer';
import ThemeModal from './components/ThemeModal';

export default function App() {
  const [activeTab, setActiveTab] = useState('command');
  const [spendData, setSpendData] = useState({ teams: [], agents: [], sessions: [] });
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeRunaways, setActiveRunaways] = useState(new Set());
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  // Modal State
  const [modalState, setModalState] = useState({ isOpen: false });

  const showAlert = (title, message) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'alert',
        title,
        message,
        onClose: () => {
          setModalState({ isOpen: false });
          resolve();
        }
      });
    });
  };

  const showConfirm = (title, message, confirmText = 'Confirm', cancelText = 'Cancel') => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        confirmText,
        cancelText,
        onConfirm: () => {
          setModalState({ isOpen: false });
          resolve(true);
        },
        onCancel: () => {
          setModalState({ isOpen: false });
          resolve(false);
        }
      });
    });
  };

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
    const confirmed = await showConfirm(
      'Resume Agent Execution',
      `Are you sure you want to clear loop pause and unpause Agent ID: ${agentId}?`,
      'Resume Agent',
      'Keep Paused'
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/budgets/agents/${agentId}/unpause`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showAlert('Agent Unpaused', data.message);
        refreshAllData();
      } else {
        showAlert('Action Failed', 'Error unpausing agent.');
      }
    } catch (err) {
      showAlert('Network Error', 'Network error occurred while unpausing agent.');
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
            <PolicyManager
              spendData={spendData}
              onRefresh={refreshAllData}
              showAlert={showAlert}
            />
          )}
          {activeTab === 'sandbox' && (
            <Sandbox
              auditLogs={auditLogs}
              onRefresh={refreshAllData}
              onSelectAuditLog={setSelectedAuditLog}
              showAlert={showAlert}
            />
          )}
          {activeTab === 'demo' && (
            <DemoStudio
              onRefresh={refreshAllData}
              showAlert={showAlert}
              showConfirm={showConfirm}
            />
          )}
          {activeTab === 'api-explorer' && (
            <ApiConsole showAlert={showAlert} />
          )}
        </main>
      </div>

      <AuditDrawer auditLog={selectedAuditLog} onClose={() => setSelectedAuditLog(null)} />

      {/* Theme Modal Dialog */}
      <ThemeModal modalState={modalState} onClose={() => setModalState({ isOpen: false })} />
    </>
  );
}
