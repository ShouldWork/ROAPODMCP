import { useState, useEffect, useRef } from "react";
import { collection, query, orderBy, limit, where, getDocs, getCountFromServer, Timestamp } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { db, auth } from "../firebase";
import { getCached, setCached } from "../cache";
import { Sparkles, SendHorizonal, RefreshCw } from "lucide-react";

const FUNCTIONS_URL = "https://us-central1-roa-support.cloudfunctions.net";

const COLORS = ["#B8860B", "#8B7355", "#C4A882", "#5C4033"];
const PIE_COLORS = [
  "#B8860B", "#5C4033", "#8B6914", "#8B7355", "#A0522D",
  "#C4A882", "#D2A647", "#CD853F", "#DEB887", "#D2B48C",
  "#DAA520", "#6B4423", "#9B7B3C", "#7B5B3A", "#A68B5B",
];

const TIME_RANGES = [
  { label: "1 Mo", value: "1m", months: 1 },
  { label: "3 Mo", value: "3m", months: 3 },
  { label: "6 Mo", value: "6m", months: 6 },
  { label: "12 Mo", value: "12m", months: 12 },
  { label: "24 Mo", value: "24m", months: 24 },
  { label: "All Time", value: "all", months: null },
];

function getCutoff(months) {
  if (!months) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return Timestamp.fromDate(d);
}

function timeAgo(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

async function callAI(action, stats, messages) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`${FUNCTIONS_URL}/dashboardAI`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, stats, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function Overview() {
  const [timeRange, setTimeRange] = useState("1m");
  const [stats, setStats] = useState({ total: 0, open: 0, closed: 0 });
  const [recent, setRecent] = useState([]);
  const [coachLoad, setCoachLoad] = useState([]);
  const [nameQuality, setNameQuality] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);

  // AI state
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    setInsights(null);
    setInsightsError(null);

    async function load() {
      const cacheKey = `overview-${timeRange}`;
      const cached = getCached(cacheKey);
      if (cached) {
        setStats(cached.stats);
        setRecent(cached.recent);
        setCoachLoad(cached.coachLoad);
        setNameQuality(cached.nameQuality);
        setUsers(cached.users);
        setLoading(false);
        return;
      }

      // Users (not time-filtered)
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      const userFull = {};
      userSnap.forEach((d) => {
        const data = d.data();
        userMap[d.id] = data.name;
        userFull[d.id] = data;
      });
      setUsers(userMap);

      // Time cutoff
      const range = TIME_RANGES.find((r) => r.value === timeRange);
      const cutoff = getCutoff(range?.months);
      const timeFilter = cutoff ? [where("lastItemAt", ">=", cutoff)] : [];

      // Counts
      const convRef = collection(db, "podium_conversations");
      const [totalSnap, openSnap, closedSnap] = await Promise.all([
        getCountFromServer(query(convRef, ...timeFilter)),
        getCountFromServer(query(convRef, where("status", "==", "open"), ...timeFilter)),
        getCountFromServer(query(convRef, where("status", "==", "closed"), ...timeFilter)),
      ]);
      const total = totalSnap.data().count;
      const open = openSnap.data().count;
      const closed = closedSnap.data().count;
      setStats({ total, open, closed });

      // Recent open conversations
      const recentQ = [where("status", "==", "open"), ...timeFilter, orderBy("lastItemAt", "desc"), limit(6)];
      const recentSnap = await getDocs(query(convRef, ...recentQ));
      setRecent(recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Coach load
      const coachQ = [where("status", "==", "open"), ...timeFilter];
      const allOpen = await getDocs(query(convRef, ...coachQ));
      const loadMap = {};
      allOpen.forEach((d) => {
        const uid = d.data().assignedUserUid || "Unassigned";
        loadMap[uid] = (loadMap[uid] || 0) + 1;
      });
      const now = Date.now();
      const d7 = now - 7 * 86400000;
      const d30 = now - 30 * 86400000;
      const loadData = Object.entries(loadMap)
        .map(([uid, count]) => ({
          uid,
          name: uid === "Unassigned" ? "Unassigned" : (userMap[uid] || uid.substring(0, 8)),
          dashboardRole: userFull[uid]?.dashboardRole || null,
          count,
        }))
        .sort((a, b) => b.count - a.count);
      setCoachLoad(loadData);
      setLoading(false);

      // Name quality (background)
      const nqQ = [orderBy("lastItemAt", "desc"), limit(10000)];
      if (cutoff) nqQ.unshift(where("lastItemAt", ">=", cutoff));
      const convSnap = await getDocs(query(convRef, ...nqQ));
      let duplicateNames = 0, uniqueNames = 0, unknownNames = 0, phoneOnly = 0;
      convSnap.forEach((d) => {
        const name = (d.data().contactName || "").trim();
        if (!name || name.toLowerCase() === "unknown") { unknownNames++; return; }
        if (/^\+?\d[\d\s\-()]+$/.test(name)) { phoneOnly++; return; }
        const parts = name.split(/\s+/);
        if (parts.length >= 2 && parts[0].toLowerCase() === parts[parts.length - 1].toLowerCase()) {
          duplicateNames++;
        } else {
          uniqueNames++;
        }
      });
      const nq = [
        { name: "Unique Names", value: uniqueNames },
        { name: "Duplicate First=Last", value: duplicateNames },
        { name: "Unknown", value: unknownNames },
        { name: "Phone Number Only", value: phoneOnly },
      ].filter((d) => d.value > 0);
      setNameQuality(nq);

      setCached(cacheKey, {
        stats: { total, open, closed },
        recent: recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        coachLoad: loadData,
        nameQuality: nq,
        users: userMap,
      }, 5);
    }
    load();
  }, [timeRange]);

  // AI context
  function buildAIContext() {
    const unassigned = coachLoad.find((c) => c.name === "Unassigned")?.count || 0;
    const rangeLabel = TIME_RANGES.find((r) => r.value === timeRange)?.label || timeRange;
    return {
      timeRange: rangeLabel,
      totalConversations: stats.total,
      openConversations: stats.open,
      closedConversations: stats.closed,
      assignmentRate: stats.open > 0 ? Math.round(((stats.open - unassigned) / stats.open) * 100) + "%" : "N/A",
      unassignedOpen: unassigned,
      coachWorkload: coachLoad.map((c) => ({ name: c.name, role: c.dashboardRole, openCount: c.count })),
      nameQuality: nameQuality.map((d) => ({ category: d.name, count: d.value })),
      recentActivity: recent.map((c) => ({
        name: c.contactName || "Unknown",
        channel: c.channelType,
        coach: users[c.assignedUserUid] || "Unassigned",
      })),
    };
  }

  useEffect(() => {
    if (loading || stats.total === 0) return;
    const cached = getCached(`ai-insights-${timeRange}`);
    if (cached) { setInsights(cached); return; }
    loadInsights();
  }, [loading, timeRange]);

  async function loadInsights() {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const { content } = await callAI("insights", buildAIContext());
      setInsights(content);
      setCached(`ai-insights-${timeRange}`, content, 5);
    } catch (err) {
      setInsightsError(err.message);
    }
    setInsightsLoading(false);
  }

  async function handleChat() {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    const newMessages = [...chatMessages, { role: "user", content: q }];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const { content } = await callAI("chat", buildAIContext(), newMessages);
      setChatMessages([...newMessages, { role: "assistant", content }]);
    } catch (err) {
      setChatMessages([...newMessages, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setChatLoading(false);
  }

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (loading) return <div className="loading">Loading dashboard...</div>;

  const unassignedOpen = coachLoad.find((c) => c.name === "Unassigned")?.count || 0;
  const assignRate = stats.open > 0
    ? Math.round(((stats.open - unassignedOpen) / stats.open) * 100)
    : 0;

  const pieData = [
    { name: "Open", value: stats.open },
    { name: "Closed", value: stats.closed },
  ];

  return (
    <>
      <div className="overview-header">
        <h2>Overview</h2>
        <div className="time-filter">
          {TIME_RANGES.map((r) => (
            <button
              key={r.value}
              className={`time-filter-btn ${timeRange === r.value ? "active" : ""}`}
              onClick={() => setTimeRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Total Conversations</div>
          <div className="stat-value">{stats.total.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Open</div>
          <div className="stat-value">{stats.open.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Closed</div>
          <div className="stat-value">{stats.closed.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Assignment Rate</div>
          <div className="stat-value">{assignRate}%</div>
        </div>
      </div>

      {/* ── AI Insights ───────────────────────────────────────── */}
      <div className="ai-insights">
        <div className="ai-insights-accent" />
        <div className="ai-insights-content">
          <div className="ai-insights-header">
            <Sparkles size={14} aria-hidden="true" />
            <span>AI Insights</span>
            <button className="ai-refresh" onClick={loadInsights} disabled={insightsLoading} aria-label="Refresh insights">
              <RefreshCw size={13} className={insightsLoading ? "spinning" : ""} />
            </button>
          </div>
          {insightsLoading && <p className="ai-insights-text" style={{ opacity: 0.5 }}>Analyzing your data...</p>}
          {insightsError && <p className="ai-insights-text" style={{ color: "var(--danger)" }}>{insightsError}</p>}
          {insights && !insightsLoading && <div className="ai-insights-text">{insights}</div>}
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Open vs Closed</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <h3>Open Conversations by Role</h3>
          {(() => {
            const roleMap = {};
            coachLoad.forEach((c) => {
              const role = c.dashboardRole || "Unset";
              roleMap[role] = (roleMap[role] || 0) + c.count;
            });
            const roleData = Object.entries(roleMap)
              .map(([role, count]) => ({ name: role, count }))
              .sort((a, b) => b.count - a.count);
            return (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={roleData} layout="vertical" margin={{ left: 100 }}>
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#B8860B" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Open Conversations by Sales Coach</h3>
          {(() => {
            const coachOnly = coachLoad.filter((c) => c.dashboardRole === "Sales Coach");
            if (coachOnly.length === 0) return <p style={{ color: "var(--gray)", textAlign: "center" }}>No users with "Sales Coach" role assigned. Set roles in the Users tab.</p>;
            return (
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie data={coachOnly} dataKey="count" cx="50%" cy="50%" outerRadius={120} label={({ name, count }) => `${name}: ${count}`}>
                    {coachOnly.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card" style={{ gridColumn: "1 / -1" }}>
          <h3>Contact Name Quality</h3>
          {nameQuality.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
              <ResponsiveContainer width="100%" height={250} minWidth={200}>
                <PieChart>
                  <Pie data={nameQuality} dataKey="value" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value.toLocaleString()}`}>
                    {nameQuality.map((_, i) => <Cell key={i} fill={["#B8860B", "#C4A882", "#8B7355", "#5C4033"][i % 4]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <h3 style={{ fontFamily: "Rajdhani", fontSize: 14, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
        Recently Active Open Conversations
      </h3>
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Roamer / Future Roamer</th>
              <th>Channel</th>
              <th>Sales Coach</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td>{c.contactName || "Unknown"}</td>
                <td>{c.channelType || "—"}</td>
                <td>{users[c.assignedUserUid] || "Unassigned"}</td>
                <td>{timeAgo(c.lastItemAt)}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--gray)" }}>No conversations in this time range.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Ask Claude ────────────────────────────────────────── */}
      <div className="ai-chat">
        <div className="ai-chat-header">
          <Sparkles size={14} aria-hidden="true" />
          <span>Ask Claude</span>
        </div>
        <div className="ai-chat-messages">
          {chatMessages.length === 0 && (
            <div className="ai-chat-placeholder">
              Ask anything about your Podium data — e.g., "Which coach has the most stale conversations?" or "Summarize the workload balance."
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "outbound" : "inbound"}`}>
              {m.content}
            </div>
          ))}
          {chatLoading && <div className="msg inbound" style={{ opacity: 0.5 }}>Thinking...</div>}
          <div ref={chatEndRef} />
        </div>
        <div className="ai-chat-form">
          <input
            className="search-input"
            placeholder="Ask about your data..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleChat()}
            style={{ maxWidth: "none", marginBottom: 0, flex: 1 }}
          />
          <button className="btn" onClick={handleChat} disabled={chatLoading || !chatInput.trim()} aria-label="Send">
            <SendHorizonal size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
