let currentAuditLogs = [];
let latestSpendData = {};
let spendChartInstance = null;
let policyChartInstance = null;

// Tab Switching
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));

  const btns = document.querySelectorAll('.nav-item button');
  btns.forEach(btn => {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabId)) {
      btn.parentElement.classList.add('active');
    }
  });

  const panel = document.getElementById(`panel-${tabId}`);
  if (panel) panel.classList.add('active');

  const titles = {
    command: "Governance Command Center",
    policies: "Policy Configuration Hub",
    demo: "Demo Scenario Studio",
    sandbox: "Agent Sandbox & Audit Logs",
    console: "Developer API Console"
  };
  document.getElementById("page-title").innerText = titles[tabId] || "Command Center";

  if (tabId === 'command') loadDashboardMetrics();
  if (tabId === 'sandbox') loadAuditLogs();
}

// Health Check
async function checkHealth() {
  const pill = document.getElementById("health-pill");
  const text = document.getElementById("health-text");

  try {
    const res = await fetch("/health");
    const data = await res.json();

    if (res.status === 200 && data.status === "healthy") {
      pill.style.backgroundColor = "var(--success-bg)";
      pill.style.color = "var(--success)";
      pill.style.borderColor = "rgba(16, 185, 129, 0.2)";
      text.innerText = "System Live (Redis & Postgres Connected)";
    } else {
      pill.style.backgroundColor = "var(--danger-bg)";
      pill.style.color = "var(--danger)";
      pill.style.borderColor = "rgba(239, 68, 68, 0.2)";
      text.innerText = `Degraded (${data.failed_dependencies ? data.failed_dependencies.join(', ') : 'error'})`;
    }
  } catch (err) {
    pill.style.backgroundColor = "var(--danger-bg)";
    pill.style.color = "var(--danger)";
    pill.style.borderColor = "rgba(239, 68, 68, 0.2)";
    text.innerText = "API Offline";
  }
}

// Load Dashboard Metrics (GET /dashboard/spend)
async function loadDashboardMetrics() {
  try {
    const res = await fetch("/dashboard/spend");
    if (!res.ok) return;
    const data = await res.json();
    latestSpendData = data;

    // Active Teams & Agents count
    document.getElementById("count-teams").innerText = data.teams ? data.teams.length : 0;
    document.getElementById("count-agents").innerText = data.agents ? data.agents.length : 0;

    let totalSpend = 0;
    if (data.teams) {
      data.teams.forEach(t => totalSpend += t.current_spend_usd);
    }
    document.getElementById("total-spend-val").innerText = `$${totalSpend.toFixed(4)}`;

    // Render Teams Grid
    const teamsGrid = document.getElementById("teams-grid");
    teamsGrid.innerHTML = "";
    (data.teams || []).forEach(team => {
      const pct = team.pct_used || 0;
      let barColor = "var(--success)";
      let badgeClass = "badge-allow";
      let statusText = "Safe";

      if (pct >= 100) {
        barColor = "var(--danger)";
        badgeClass = "badge-block";
        statusText = "Exceeded";
      } else if (pct >= 80) {
        barColor = "var(--warning)";
        badgeClass = "badge-warn";
        statusText = "Warning";
      }

      teamsGrid.innerHTML += `
        <div class="card">
          <div class="card-header">
            <span class="card-title">${team.name}</span>
            <span class="badge ${badgeClass}">${statusText}</span>
          </div>
          <div class="card-val">$${team.current_spend_usd.toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">/ $${team.monthly_budget_usd.toFixed(2)}</span></div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.4rem;">ID: <code style="font-size: 0.72rem; color: var(--primary);">${team.team_id}</code></div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${Math.min(100, pct)}%; background-color: ${barColor};"></div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.4rem; text-align: right;">${pct.toFixed(1)}% Used</div>
        </div>
      `;
    });

    // Render Agents Grid & Check for Paused/Runaway agents
    const agentsGrid = document.getElementById("agents-grid");
    agentsGrid.innerHTML = "";

    let pausedAgents = [];

    (data.agents || []).forEach(agent => {
      // We will check pause status asynchronously or via the check endpoint.
      // But we can also check if the agent has a 'pause' count in the audit logs or simply fetch it.
      // For now, let's query the status endpoint for each agent or check if we already flagged it.
      // Let's assume we maintain a cached list of paused agent IDs from status responses.
      const pct = agent.pct_used || 0;
      let barColor = "var(--success)";
      let badgeClass = "badge-allow";
      let statusText = "Active";

      if (pct >= 100) {
        barColor = "var(--info)";
        badgeClass = "badge-reroute";
        statusText = "Rerouting";
      } else if (pct >= 80) {
        barColor = "var(--warning)";
        badgeClass = "badge-warn";
        statusText = "Warning (80%)";
      }

      agentsGrid.innerHTML += `
        <div class="card" id="agent-card-${agent.agent_id}">
          <div class="card-header">
            <span class="card-title">${agent.name}</span>
            <span class="badge ${badgeClass}" id="agent-badge-${agent.agent_id}">${statusText}</span>
          </div>
          <div class="card-val">$${agent.current_spend_usd.toFixed(2)} <span style="font-size: 0.85rem; color: var(--text-muted);">/ $${agent.monthly_budget_usd.toFixed(2)}</span></div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.4rem;">ID: <code style="font-size: 0.72rem; color: var(--primary);">${agent.agent_id}</code></div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">Model: <code>${agent.preferred_model}</code></div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${Math.min(100, pct)}%; background-color: ${barColor};"></div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.4rem; text-align: right;">${pct.toFixed(1)}% Used</div>
          <div id="unpause-btn-container-${agent.agent_id}" style="margin-top: 0.85rem; display: none;">
            <button class="btn btn-primary" onclick="triggerUnpauseAgent('${agent.agent_id}')" style="padding: 0.45rem 0.85rem; font-size: 0.825rem; width: 100%; border-radius: var(--radius-sm);">
              Resume Agent (Clear Loop Pause)
            </button>
          </div>

        </div>
      `;

      // Check pause status
      checkAndRenderAgentPause(agent.agent_id);
    });

    // Render Active Sessions
    renderSessionsGrid(data.sessions || []);

    loadAuditLogs();

  } catch (err) {
    console.error("Failed to load dashboard metrics:", err);
  }
}

// Check agent pause status and update UI accordingly
async function checkAndRenderAgentPause(agentId) {
  try {
    const res = await fetch(`/budgets/agents/${agentId}/status`);
    if (!res.ok) return;
    const statusData = await res.json();

    const badge = document.getElementById(`agent-badge-${agentId}`);
    const unpauseBtn = document.getElementById(`unpause-btn-container-${agentId}`);
    const card = document.getElementById(`agent-card-${agentId}`);

    if (statusData.is_paused) {
      if (badge) {
        badge.innerText = "PAUSED (RUNAWAY)";
        badge.className = "badge badge-pause";
      }
      if (unpauseBtn) unpauseBtn.style.display = "block";
      if (card) {
        card.style.borderColor = "var(--pause)";
        card.style.background = "linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(12, 16, 32, 0.9))";
      }

      // Update runaway threat banner list
      updateThreatBanner(statusData);
    }
  } catch (err) {
    console.error("Error checking pause status for agent:", agentId);
  }
}

// Update Runaway Threat Warning Banner
let activeRunaways = new Set();
function updateThreatBanner(agentStatus) {
  const banner = document.getElementById("runaway-incident-banner");
  const list = document.getElementById("incident-agent-list");

  activeRunaways.add(agentStatus.agent_id);
  banner.style.display = "block";

  // Re-render threat list
  list.innerHTML = "";
  let threatCount = 0;

  latestSpendData.agents.forEach(agent => {
    if (activeRunaways.has(agent.agent_id)) {
      threatCount++;
      list.innerHTML += `
        <div class="incident-row">
          <div class="incident-agent-info">
            <h4>${agent.name} (${agent.agent_id})</h4>
            <p>Spend of $${agent.current_spend_usd.toFixed(4)} exceeds runaway rate limit (>20% monthly budget of $${agent.monthly_budget_usd.toFixed(2)} in 1 hour)</p>
          </div>
          <button class="btn btn-secondary" onclick="triggerUnpauseAgent('${agent.agent_id}')" style="padding: 0.35rem 0.85rem; font-size: 0.75rem;">
            Operator Unpause
          </button>

        </div>
      `;
    }
  });

  document.getElementById("count-loop-pauses").innerText = threatCount;

  // Calculate simulated loop cost savings
  // Let's estimate that a runaway loop does 50,000 API calls as described in PS-8.1 context, costing ~ $0.05 each.
  // Immediate cost savings: number of blocked loops * standard estimate
  let totalSaved = 0;
  currentAuditLogs.forEach(log => {
    if (log.event_type === 'pause' || log.event_type === 'block') {
      totalSaved += 0.05; // assumed average loop prompt cost saved
    }
  });
  // If an agent is currently paused, we add the "projected saved cost of the loop" ($500.00 standard saved spend)
  if (threatCount > 0) {
    totalSaved += (threatCount * 12.50); // custom mock projected saved value
  }
  document.getElementById("estimated-savings-value").innerText = `$${totalSaved.toFixed(4)}`;
}

// Trigger Operator Unpause API Call
async function triggerUnpauseAgent(agentId) {
  if (!confirm(`Are you sure you want to unpause Agent ID ${agentId}? This will clear the loop detector and resume calls.`)) return;

  try {
    const res = await fetch(`/budgets/agents/${agentId}/unpause`, {
      method: "POST"
    });
    const result = await res.json();

    if (res.ok) {
      alert(result.message);
      activeRunaways.delete(agentId);

      // Update UI if no remaining runaways
      if (activeRunaways.size === 0) {
        document.getElementById("runaway-incident-banner").style.display = "none";
      }

      // Reload metrics
      loadDashboardMetrics();
    } else {
      alert("Error: " + result.detail);
    }
  } catch (err) {
    alert("Unpause request failed: " + err.message);
  }
}

// Render Active Sessions Monitor Grid
function renderSessionsGrid(sessions) {
  const container = document.getElementById("sessions-visual-container");
  const countBadge = document.getElementById("session-count-badge");

  if (sessions.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 2rem;">
        No sessions active. Run scenarios to spin up sessions.
      </div>
    `;
    countBadge.innerText = "0 Active";
    countBadge.className = "badge badge-warn";
    return;
  }

  let activeCount = 0;
  container.innerHTML = "";

  sessions.forEach(sess => {
    const pct = sess.pct_used || 0;
    const isClosed = sess.status === 'closed';
    if (!isClosed) activeCount++;

    let barColor = "var(--success)";
    let borderStyle = "border-color: var(--border-color);";
    let badgeClass = "badge-allow";
    let badgeText = "Active";

    if (isClosed) {
      barColor = "var(--danger)";
      badgeClass = "badge-block";
      badgeText = "Locked (Closed)";
      borderStyle = "border-color: #FECACA; background-color: #FEF2F2;";
    } else if (pct >= 80) {
      barColor = "var(--warning)";
      badgeClass = "badge-warn";
      badgeText = "Warning";
      borderStyle = "border-color: #FDE68A; background-color: #FFFBEB;";
    }

    container.innerHTML += `
      <div style="padding: 1rem; border: 1px solid; border-radius: var(--radius-sm); ${borderStyle} transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <div>
            <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary);">Session: <code style="font-family: 'JetBrains Mono'; font-size: 0.72rem; color: var(--primary);">${sess.session_id}</code></span>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem;">Agent: ${sess.agent_name}</div>
          </div>

          <span class="badge ${badgeClass}" style="font-size: 0.68rem; padding: 0.2rem 0.5rem;">${badgeText}</span>
        </div>
        <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--text-secondary);">
          Spent: $${sess.current_spend_usd.toFixed(4)} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">/ $${sess.budget_usd.toFixed(2)}</span>
        </div>
        <div class="progress-bar-bg" style="height: 6px; margin: 0;">
          <div class="progress-bar-fill" style="width: ${Math.min(100, pct)}%; background-color: ${barColor};"></div>
        </div>
      </div>
    `;
  });

  countBadge.innerText = `${activeCount} Active`;
  countBadge.className = activeCount > 0 ? "badge badge-allow" : "badge badge-warn";
}

// Budget Policy Form Handlers
async function handleCreateTeam(e) {
  e.preventDefault();
  const name = document.getElementById("team-name").value;
  const budget = parseFloat(document.getElementById("team-budget").value);

  const res = await fetch("/budgets/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, monthly_budget_usd: budget })
  });

  if (res.ok) {
    const data = await res.json();
    alert(`Team Policy Created!\nTeam ID: ${data.id}`);
    document.getElementById("form-create-team").reset();
    loadDashboardMetrics();
  } else {
    alert("Error creating team policy.");
  }
}

async function handleCreateAgent(e) {
  e.preventDefault();
  const team_id = document.getElementById("agent-team-id").value;
  const name = document.getElementById("agent-name").value;
  const budget = parseFloat(document.getElementById("agent-budget").value);
  const preferred_model = document.getElementById("agent-pref-model").value;
  const fallback_model = document.getElementById("agent-fall-model").value;

  const res = await fetch("/budgets/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team_id, name, monthly_budget_usd: budget, preferred_model, fallback_model })
  });

  if (res.ok) {
    const data = await res.json();
    alert(`Agent Policy Created!\nAgent ID: ${data.id}`);
    document.getElementById("form-create-agent").reset();
    loadDashboardMetrics();
  } else {
    alert("Error creating agent policy.");
  }
}

async function handleCreateSession(e) {
  e.preventDefault();
  const agent_id = document.getElementById("sess-agent-id").value;
  const budget = parseFloat(document.getElementById("sess-budget").value);

  const res = await fetch("/budgets/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id, budget_usd: budget })
  });

  if (res.ok) {
    const data = await res.json();
    alert(`Session Started!\nSession ID: ${data.id}`);
    document.getElementById("form-create-session").reset();
    loadDashboardMetrics();
  } else {
    alert("Error starting session.");
  }
}

// 1-Click Policy Presets Simulation
async function runPresetSim(type) {
  switchTab("sandbox");

  // Create temporary team & agent
  const teamRes = await fetch("/budgets/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Preset ${type} Team`, monthly_budget_usd: type === 'REROUTE' ? 0.0001 : 100.0 })
  });
  const teamData = await teamRes.json();

  let agentBudget = 100.0;
  if (type === 'WARN') agentBudget = 0.00015; // Set tiny budget so 1 call puts it over 80%
  if (type === 'REROUTE') agentBudget = 0.00001; // Tiny budget triggers reroute to fallback
  if (type === 'PAUSE') agentBudget = 0.0005; // Small monthly budget to trigger 20% runaway hourly cap quickly

  const agentRes = await fetch("/budgets/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      team_id: teamData.id,
      name: `Preset ${type} Agent`,
      monthly_budget_usd: agentBudget,
      preferred_model: "llama-3.3-70b-versatile",
      fallback_model: "llama-3.1-8b-instant"
    })
  });
  const agentData = await agentRes.json();

  let sessBudget = 10.0;
  if (type === 'BLOCK') sessBudget = 0.00001; // Session budget tiny -> BLOCK

  const sessRes = await fetch("/budgets/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentData.id, budget_usd: sessBudget })
  });
  const sessData = await sessRes.json();

  document.getElementById("chat-session-id").value = sessData.id;
  document.getElementById("chat-agent-id").value = agentData.id;
  document.getElementById("chat-prompt").value = `Simulating governance policy for preset ${type}.`;

  // Submit chat request automatically
  const fakeEvent = { preventDefault: () => { } };
  await handleSendChat(fakeEvent);

  // If preset is PAUSE, trigger a second request immediately to exceed the 20% limit (since runaway requires >=2 requests)
  if (type === 'PAUSE') {
    setTimeout(async () => {
      document.getElementById("chat-prompt").value = `Simulating loop recurrence request to trigger pause lock.`;
      await handleSendChat(fakeEvent);
      // Switch back to command center to see threat notification
      switchTab("command");
    }, 800);
  }
}

// LLM Sandbox Chat Handler
async function handleSendChat(e) {
  if (e && e.preventDefault) e.preventDefault();
  const session_id = document.getElementById("chat-session-id").value;
  const agent_id = document.getElementById("chat-agent-id").value;
  const message = document.getElementById("chat-prompt").value;

  const box = document.getElementById("chat-result-box");
  const placeholder = document.getElementById("chat-result-placeholder");

  const res = await fetch("/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, agent_id, message })
  });

  const data = await res.json();
  placeholder.style.display = "none";
  box.style.display = "block";

  const eventBadge = document.getElementById("chat-event-badge");
  const modelBadge = document.getElementById("chat-model-badge");
  const respText = document.getElementById("chat-response-text");
  const costText = document.getElementById("chat-cost");
  const tokensText = document.getElementById("chat-tokens");

  if (res.ok) {
    const eventType = data.event_type;
    eventBadge.innerText = eventType.toUpperCase();

    if (eventType === "allow") eventBadge.className = "badge badge-allow";
    else if (eventType === "warn") eventBadge.className = "badge badge-warn";
    else if (eventType === "reroute") eventBadge.className = "badge badge-reroute";
    else if (eventType === "pause") eventBadge.className = "badge badge-pause";

    modelBadge.innerText = `Model Used: ${data.model_used}`;
    respText.innerText = data.response;
    costText.innerText = `$${(data.cost_usd || 0).toFixed(6)}`;
    tokensText.innerText = `${data.tokens_in || 0} in / ${data.tokens_out || 0} out`;
  } else {
    // Check if error is due to PAUSE or BLOCK
    const details = data.detail || {};
    const reason = details.reason || "";

    if (reason === "agent_paused_runaway_detected") {
      eventBadge.innerText = "PAUSE";
      eventBadge.className = "badge badge-pause";
      modelBadge.innerText = "Runaway Loop Terminated";
      respText.innerText = details.message || "This agent is stuck in a loop and was paused.";
    } else {
      eventBadge.innerText = "BLOCK";
      eventBadge.className = "badge badge-block";
      modelBadge.innerText = "Rejected by Gate";
      respText.innerText = details.error || "Budget limit exceeded.";
    }
    costText.innerText = "$0.000000";
    tokensText.innerText = "0 in / 0 out";
  }

  loadDashboardMetrics();
}

// Load Audit Logs and Calculate Decision Distribution Counters
async function loadAuditLogs() {
  try {
    const res = await fetch("/audit?limit=50");
    if (!res.ok) return;
    const logs = await res.json();
    currentAuditLogs = logs || [];

    let allowCount = 0, warnCount = 0, rerouteCount = 0, blockCount = 0, pauseCount = 0;
    let loopLogsContainer = document.getElementById("loop-incident-logs-list");
    let loopIncidentHtml = "";

    const tbody = document.getElementById("audit-table-body");
    tbody.innerHTML = "";

    currentAuditLogs.forEach((log, idx) => {
      let badgeClass = "badge-allow";
      if (log.event_type === "allow") allowCount++;
      if (log.event_type === "warn") { warnCount++; badgeClass = "badge-warn"; }
      if (log.event_type === "reroute") { rerouteCount++; badgeClass = "badge-reroute"; }
      if (log.event_type === "block") { blockCount++; badgeClass = "badge-block"; }
      if (log.event_type === "pause") {
        pauseCount++;
        badgeClass = "badge-pause";
        loopIncidentHtml += `
          <div style="padding: 0.5rem; background-color: rgba(139, 92, 246, 0.05); border-left: 3px solid var(--pause); border-radius: 4px;">
            <div style="display:flex; justify-content:space-between; font-weight:600; color: #fff;">
              <span>Loop Intercepted</span>
              <span>${new Date(log.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style="color:var(--text-secondary); font-size:0.75rem; margin-top:0.15rem;">
              Agent <code>${log.agent_id.substring(0, 8)}...</code> halted overnight. Saved approx $0.05.
            </div>
          </div>
        `;
      }

      tbody.innerHTML += `
        <tr class="clickable-row" onclick="openDrawerByIndex(${idx})">
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${new Date(log.timestamp).toLocaleString()}</td>
          <td><span class="badge ${badgeClass}">${log.event_type.toUpperCase()}</span></td>
          <td><code>${log.model_used}</code></td>
          <td style="font-weight: 600;">$${log.cost_usd.toFixed(6)}</td>
          <td>${log.tokens_in} / ${log.tokens_out}</td>
          <td><code style="font-size: 0.72rem; color: var(--primary);">${log.session_id}</code></td>
        </tr>
      `;
    });

    document.getElementById("cnt-allow").innerText = allowCount;
    document.getElementById("cnt-warn").innerText = warnCount;
    document.getElementById("cnt-reroute").innerText = rerouteCount;
    document.getElementById("cnt-block").innerText = blockCount;
    document.getElementById("cnt-pause").innerText = pauseCount;

    // Render incident threat logs list
    if (loopLogsContainer) {
      if (loopIncidentHtml !== "") {
        loopLogsContainer.innerHTML = loopIncidentHtml;
      } else {
        loopLogsContainer.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 1.5rem;">No loops intercepted yet.</div>`;
      }
    }

    // Render interactive charts
    renderDashboardCharts(latestSpendData || {}, {
      allow: allowCount,
      warn: warnCount,
      reroute: rerouteCount,
      block: blockCount,
      pause: pauseCount,
    });

  } catch (err) {
    console.error("Failed to load audit logs:", err);
  }
}

// Chart.js Instances & Interactive Renderers (Theme optimized for Light Blue & White Theme)
function renderDashboardCharts(spendData, eventCounts) {
  // Set default Chart.js font family
  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = "'Crete Round', Georgia, serif";
    Chart.defaults.color = "#334155";
  }

  // 1. Spend vs Budget Utilization Chart (Bar)
  const spendCtx = document.getElementById("chart-spend-utilization");
  if (spendCtx && typeof Chart !== "undefined") {
    const labels = [];
    const spendVals = [];
    const budgetVals = [];

    (spendData.teams || []).forEach(t => {
      labels.push(`Team: ${t.name}`);
      spendVals.push(t.current_spend_usd);
      budgetVals.push(t.monthly_budget_usd);
    });

    (spendData.agents || []).forEach(a => {
      labels.push(`Agent: ${a.name}`);
      spendVals.push(a.current_spend_usd);
      budgetVals.push(a.monthly_budget_usd);
    });

    if (labels.length === 0) {
      labels.push("No Metrics");
      spendVals.push(0);
      budgetVals.push(0);
    }

    if (spendChartInstance) {
      spendChartInstance.destroy();
    }

    spendChartInstance = new Chart(spendCtx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Current Spend ($)",
            data: spendVals,
            backgroundColor: "rgba(5, 150, 105, 0.85)",
            borderColor: "#059669",
            borderWidth: 1.5,
            borderRadius: 6,
          },
          {
            label: "Budget Limit ($)",
            data: budgetVals,
            backgroundColor: "rgba(2, 132, 199, 0.20)",
            borderColor: "#0284C7",
            borderWidth: 1.5,
            borderRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#0F172A", font: { family: "'Crete Round', serif", size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${ctx.raw.toFixed(4)}`
            }
          }
        },
        scales: {
          x: { ticks: { color: "#334155", font: { family: "'Crete Round', serif", size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#334155", font: { family: "'Crete Round', serif" } }, grid: { color: "#E2E8F0" } }
        }
      }
    });
  }

  // 2. Policy Decision Ratio Doughnut Chart
  const policyCtx = document.getElementById("chart-policy-ratio");
  if (policyCtx && typeof Chart !== "undefined") {
    const allowCnt = eventCounts.allow || 0;
    const warnCnt = eventCounts.warn || 0;
    const rerouteCnt = eventCounts.reroute || 0;
    const blockCnt = eventCounts.block || 0;
    const pauseCnt = eventCounts.pause || 0;

    let dataVals = [allowCnt, warnCnt, rerouteCnt, blockCnt, pauseCnt];
    let dataLabels = ["ALLOW", "WARN", "REROUTE", "BLOCK", "PAUSE"];
    let dataColors = ["#059669", "#D97706", "#0284C7", "#DC2626", "#7C3AED"];

    if (allowCnt + warnCnt + rerouteCnt + blockCnt + pauseCnt === 0) {
      dataVals = [1];
      dataLabels = ["No Telemetry"];
      dataColors = ["#E2E8F0"];
    }

    if (policyChartInstance) {
      policyChartInstance.destroy();
    }

    policyChartInstance = new Chart(policyCtx, {
      type: "doughnut",
      data: {
        labels: dataLabels,
        datasets: [{
          data: dataVals,
          backgroundColor: dataColors,
          borderWidth: 2,
          borderColor: "#FFFFFF",
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: "#0F172A", font: { family: "'Crete Round', serif", size: 10 }, boxWidth: 12 } }
        },
        cutout: "68%"
      }
    }
}

  // Drawer Side Modal Controls

  function openDrawerByIndex(idx) {
    const log = currentAuditLogs[idx];
    if (!log) return;

    document.getElementById("drw-id").innerText = log.id || "N/A";
    document.getElementById("drw-time").innerText = new Date(log.timestamp).toLocaleString();
    document.getElementById("drw-event-type").innerText = log.event_type.toUpperCase();
    document.getElementById("drw-model").innerText = log.model_used;
    document.getElementById("drw-cost").innerText = `$${log.cost_usd.toFixed(6)}`;
    document.getElementById("drw-tokens").innerText = `${log.tokens_in} Tokens In / ${log.tokens_out} Tokens Out`;
    document.getElementById("drw-session").innerText = log.session_id;
    document.getElementById("drw-agent").innerText = log.agent_id;
    document.getElementById("drw-team").innerText = log.team_id;

    document.getElementById("drawer-overlay").classList.add("active");
    document.getElementById("drawer").classList.add("active");
  }

  function closeDrawer() {
    document.getElementById("drawer-overlay").classList.remove("active");
    document.getElementById("drawer").classList.remove("active");
  }

  // Developer API Console Handlers
  const SAMPLE_PAYLOADS = {
    HEALTH_LIVE: { method: "GET", url: "/health/live" },
    HEALTH_READINESS: { method: "GET", url: "/health" },
    DASHBOARD_SPEND: { method: "GET", url: "/dashboard/spend" },
    DEMO_RUN: {
      method: "POST", url: "/demo/run",
      body: { num_agents: 5, requests_per_agent: 5, team_budget_usd: 2.00, agent_budget_usd: 0.30, session_budget_usd: 0.05, concurrency: true }
    },
    DEMO_CLEANUP: { method: "DELETE", url: "/demo/cleanup" },
    CHAT_V1: {
      method: "POST", url: "/v1/chat",
      body: { session_id: "ENTER_SESSION_UUID", agent_id: "ENTER_AGENT_UUID", message: "Explain quantum computing." }
    },
    CREATE_TEAM: {
      method: "POST", url: "/budgets/teams",
      body: { name: "Finance Team", monthly_budget_usd: 1000.00 }
    },
    CREATE_AGENT: {
      method: "POST", url: "/budgets/agents",
      body: { team_id: "ENTER_TEAM_UUID", name: "Finance Bot", monthly_budget_usd: 100.00, preferred_model: "llama-3.3-70b-versatile", fallback_model: "llama-3.1-8b-instant" }
    },
    CREATE_SESSION: {
      method: "POST", url: "/budgets/sessions",
      body: { agent_id: "ENTER_AGENT_UUID", budget_usd: 5.00 }
    },
    UNPAUSE_AGENT: {
      method: "POST", url: "/budgets/agents/ENTER_AGENT_UUID/unpause"
    },
    AGENT_STATUS: {
      method: "GET", url: "/budgets/agents/ENTER_AGENT_UUID/status"
    },
    GET_AUDIT: { method: "GET", url: "/audit" }
  };

  // Demo Scenario Studio Handlers
  async function runDemoScenarioGenerator() {
    const loading = document.getElementById("demo-loading-indicator");
    const resultsCard = document.getElementById("demo-results-card");
    const placeholder = document.getElementById("demo-placeholder-card");
    const btnRun = document.getElementById("btn-run-demo");

    placeholder.style.display = "none";
    resultsCard.style.display = "none";
    loading.style.display = "block";
    if (btnRun) btnRun.disabled = true;

    try {
      const res = await fetch("/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const summary = data.summary || {};
      const agents = data.agents || [];

      loading.style.display = "none";
      resultsCard.style.display = "block";
      if (btnRun) btnRun.disabled = false;

      document.getElementById("demo-duration-badge").innerText = `Duration: ${(summary.duration_seconds || 0).toFixed(2)}s`;

      // Render Table Body
      const tbody = document.getElementById("demo-table-body");
      tbody.innerHTML = "";

      agents.forEach(agent => {
        const oc = agent.outcomes || {};
        const allowCnt = oc.allow || 0;
        const warnCnt = oc.warn || 0;
        const blockCnt = oc.block || 0;
        const rerouteCnt = oc.reroute || 0;
        const pauseCnt = oc.pause || 0;

        tbody.innerHTML += `
        <tr>
          <td><strong>${agent.name}</strong> <br><code style="font-size: 0.72rem; color: var(--text-secondary);">${agent.agent_id}</code></td>
          <td style="font-weight: 600;">${agent.requests_sent}</td>
          <td><span class="badge badge-allow">${allowCnt}</span></td>
          <td><span class="badge ${warnCnt > 0 ? 'badge-warn' : ''}">${warnCnt}</span></td>
          <td><span class="badge ${blockCnt > 0 ? 'badge-block' : ''}">${blockCnt}</span></td>
          <td><span class="badge ${rerouteCnt > 0 ? 'badge-reroute' : ''}">${rerouteCnt}</span></td>
          <td><span class="badge ${pauseCnt > 0 ? 'badge-pause' : ''}">${pauseCnt}</span></td>
          <td style="font-weight: 600; color: ${agent.final_spend_usd > agent.budget_usd ? 'var(--danger)' : 'var(--text-main)'};">$${(agent.final_spend_usd || 0).toFixed(4)}</td>
          <td style="color: var(--text-secondary);">$${(agent.budget_usd || 0).toFixed(4)}</td>
        </tr>
      `;
      });

      // Render Summary Table Footer
      const tfoot = document.getElementById("demo-table-foot");
      const violationStatus = summary.any_budget_exceeded
        ? `<span class="badge badge-block">VIOLATION DETECTED</span>`
        : `<span class="badge badge-allow">100% ATOMIC PASSED</span>`;

      tfoot.innerHTML = `
      <tr>
        <td>SUMMARY TOTALS</td>
        <td>${summary.total_requests || 0} Req</td>
        <td colspan="5" style="text-align: center;">Atomic Enforcement: ${violationStatus}</td>
        <td style="color: var(--success); font-size: 1rem;">$${(summary.total_spend_usd || 0).toFixed(4)}</td>
        <td>Team Cap: $2.00</td>
      </tr>
    `;

      // Refresh Dashboard metrics
      loadDashboardMetrics();

    } catch (err) {
      loading.style.display = "none";
      placeholder.style.display = "block";
      if (btnRun) btnRun.disabled = false;
      alert("Error executing demo scenario: " + err.message);
    }
  }

  async function cleanupDemoScenario() {
    if (!confirm("Are you sure you want to clean up all demo-* teams, agents, sessions, and spend events?")) return;

    try {
      const res = await fetch("/demo/cleanup", { method: "DELETE" });
      if (res.ok) {
        alert("Demo resources and spend counters cleaned up successfully.");
        document.getElementById("demo-results-card").style.display = "none";
        document.getElementById("demo-placeholder-card").style.display = "block";

        // Clear incident variables
        activeRunaways.clear();
        document.getElementById("runaway-incident-banner").style.display = "none";

        loadDashboardMetrics();
      }
    } catch (err) {
      alert("Error cleaning up demo scenario: " + err.message);
    }
  }

  function updateExplorerInputs() {
    const sel = document.getElementById("endpoint-select").value;
    const cfg = SAMPLE_PAYLOADS[sel];
    const group = document.getElementById("explorer-body-group");

    if (cfg && cfg.body) {
      group.style.display = "block";
      document.getElementById("explorer-json-input").value = JSON.stringify(cfg.body, null, 2);
    } else {
      group.style.display = "none";
      document.getElementById("explorer-json-input").value = "";
    }
  }

  async function runExplorerRequest() {
    const sel = document.getElementById("endpoint-select").value;
    const cfg = SAMPLE_PAYLOADS[sel];
    if (!cfg) return;

    const badge = document.getElementById("explorer-status-badge");
    const latency = document.getElementById("explorer-latency");
    const output = document.getElementById("explorer-json-output");

    badge.className = "badge";
    badge.innerText = "Executing...";
    badge.style.backgroundColor = "var(--info-bg)";
    badge.style.color = "var(--info)";

    const startTime = performance.now();

    try {
      const opts = { method: cfg.method, headers: {} };
      if (cfg.body) {
        const rawText = document.getElementById("explorer-json-input").value;
        opts.headers["Content-Type"] = "application/json";
        opts.body = rawText;
      }

      const res = await fetch(cfg.url, opts);
      const json = await res.json();
      const elapsed = Math.round(performance.now() - startTime);

      latency.innerText = `Latency: ${elapsed} ms`;
      output.innerText = JSON.stringify(json, null, 2);
      badge.innerText = `${res.status} ${res.statusText}`;

      if (res.ok) {
        badge.style.backgroundColor = "var(--success-bg)";
        badge.style.color = "var(--success)";
      } else {
        badge.style.backgroundColor = "var(--danger-bg)";
        badge.style.color = "var(--danger)";
      }
    } catch (err) {
      badge.innerText = "Execution Failed";
      badge.style.backgroundColor = "var(--danger-bg)";
      badge.style.color = "var(--danger)";
      output.innerText = String(err);
    }
  }

  function copyAsCurl() {
    const sel = document.getElementById("endpoint-select").value;
    const cfg = SAMPLE_PAYLOADS[sel];
    if (!cfg) return;

    const host = window.location.origin;
    let curl = `curl -X ${cfg.method} "${host}${cfg.url}"`;

    if (cfg.body) {
      const rawText = document.getElementById("explorer-json-input").value;
      curl += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${rawText.replace(/\n/g, '')}'`;
    }

    navigator.clipboard.writeText(curl);
    alert("cURL command copied to clipboard!");
  }

  // Initial Load
  document.addEventListener("DOMContentLoaded", () => {
    checkHealth();
    loadDashboardMetrics();
    updateExplorerInputs();
  });
