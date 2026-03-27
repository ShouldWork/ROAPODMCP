import { useState, useEffect } from "react";
import { collection, query, where, getDocs, orderBy, limit, getCountFromServer } from "firebase/firestore";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { db } from "../firebase";
import { getCached, setCached } from "../cache";

const CHART_COLORS = [
  "#B8860B", "#5C4033", "#8B6914", "#8B7355", "#A0522D",
  "#C4A882", "#D2A647", "#CD853F", "#DEB887", "#D2B48C",
  "#DAA520", "#6B4423", "#9B7B3C", "#7B5B3A", "#A68B5B",
];

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Query Parser ──────────────────────────────────────────────────────────

function parseQuery(input) {
  const q = input.toLowerCase().trim();
  const plan = {
    chartType: "table",
    status: null,
    role: null,
    assignee: null,
    stale: null,
    staleDays: 7,
    channel: null,
    direction: null,
    dateRange: null,
    groupBy: null,
    metric: "count",
    limit: 50,
    description: "",
  };

  // Chart type
  if (/pie\s*chart/i.test(q)) plan.chartType = "pie";
  else if (/bar\s*chart/i.test(q)) plan.chartType = "bar";
  else if (/count|total|how many/i.test(q)) plan.chartType = "stat";
  else if (/list|show me|find|search/i.test(q)) plan.chartType = "table";

  // Status
  if (/\bopen\b/i.test(q)) plan.status = "open";
  else if (/\bclosed\b/i.test(q)) plan.status = "closed";

  // Stale detection
  const staleMatch = q.match(/stale(?:\s+(?:for\s+)?(?:more\s+than\s+)?(\d+)\s*(?:day|d))?/i);
  if (staleMatch) {
    plan.stale = true;
    plan.staleDays = staleMatch[1] ? parseInt(staleMatch[1]) : 7;
  }
  if (/inactive|no\s*activity|dormant/i.test(q)) {
    plan.stale = true;
    if (!staleMatch) plan.staleDays = 7;
  }

  // Role filter
  if (/sales\s*coach/i.test(q)) plan.role = "Sales Coach";
  else if (/team\s*leader|leader/i.test(q)) plan.role = "Team Leader";
  else if (/team\s*member/i.test(q)) plan.role = "Team Member";
  else if (/account\s*owner|owner/i.test(q)) plan.role = "Account Owner";

  // Group by
  if (/(?:by|per|each|group\s*by)\s*(?:sales\s*)?coach/i.test(q) || /(?:assigned|per)\s*(?:user|person|agent|coach)/i.test(q)) {
    plan.groupBy = "assignee";
  } else if (/by\s*role/i.test(q) || /per\s*role/i.test(q)) {
    plan.groupBy = "role";
  } else if (/by\s*(?:channel|type)/i.test(q)) {
    plan.groupBy = "channel";
  } else if (/by\s*(?:status)/i.test(q)) {
    plan.groupBy = "status";
  } else if (/by\s*(?:month|week)/i.test(q)) {
    plan.groupBy = "month";
  } else if (/by\s*location/i.test(q)) {
    plan.groupBy = "location";
  }

  // If role mentioned with chart, likely grouping by assignee within that role
  if (plan.role && plan.chartType !== "table" && !plan.groupBy) {
    plan.groupBy = "assignee";
  }

  // Channel
  if (/\bphone\b|\bsms\b|\btext\b/i.test(q)) plan.channel = "phone";
  else if (/\bemail\b/i.test(q)) plan.channel = "email";
  else if (/\bfacebook\b/i.test(q)) plan.channel = "facebook";

  // Direction (messages)
  if (/\binbound\b|\breceived\b/i.test(q)) plan.direction = "inbound";
  else if (/\boutbound\b|\bsent\b/i.test(q)) plan.direction = "outbound";

  // Date range
  const daysMatch = q.match(/(?:last|past)\s+(\d+)\s*(?:day|d)/i);
  const weeksMatch = q.match(/(?:last|past)\s+(\d+)\s*(?:week|w)/i);
  const monthsMatch = q.match(/(?:last|past)\s+(\d+)\s*(?:month|m(?!in))/i);
  if (daysMatch) plan.dateRange = parseInt(daysMatch[1]);
  else if (weeksMatch) plan.dateRange = parseInt(weeksMatch[1]) * 7;
  else if (monthsMatch) plan.dateRange = parseInt(monthsMatch[1]) * 30;

  // Unassigned
  if (/\bunassigned\b/i.test(q)) plan.assignee = "unassigned";

  // Build description
  const parts = [];
  if (plan.chartType === "pie") parts.push("Pie chart");
  else if (plan.chartType === "bar") parts.push("Bar chart");
  else if (plan.chartType === "stat") parts.push("Count");
  else parts.push("List");
  parts.push("of");
  if (plan.status) parts.push(plan.status);
  if (plan.stale) parts.push(`stale (>${plan.staleDays}d)`);
  parts.push("conversations");
  if (plan.role) parts.push(`assigned to ${plan.role} role`);
  if (plan.assignee === "unassigned") parts.push("(unassigned)");
  if (plan.channel) parts.push(`on ${plan.channel}`);
  if (plan.groupBy) parts.push(`grouped by ${plan.groupBy}`);
  if (plan.dateRange) parts.push(`in the last ${plan.dateRange} days`);
  plan.description = parts.join(" ");

  return plan;
}

// ── Query Executor ────────────────────────────────────────────────────────

async function executeQuery(plan, users) {
  const convRef = collection(db, "podium_conversations");
  const constraints = [];

  if (plan.status) constraints.push(where("status", "==", plan.status));
  if (plan.assignee === "unassigned") constraints.push(where("assignedUserUid", "==", null));

  // Date range or stale filter
  if (plan.dateRange) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - plan.dateRange);
    constraints.push(where("lastItemAt", ">=", cutoff));
  }

  constraints.push(orderBy("lastItemAt", "desc"));
  constraints.push(limit(2000));

  const snap = await getDocs(query(convRef, ...constraints));
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Stale filter (client-side — needs lastItemAt comparison)
  if (plan.stale) {
    const staleCutoff = Date.now() - plan.staleDays * 86400000;
    docs = docs.filter((d) => {
      const ts = d.lastItemAt?.toDate?.()?.getTime() || d.lastItemAt?.seconds * 1000 || 0;
      return ts > 0 && ts < staleCutoff;
    });
  }

  // Role filter (client-side — join against users)
  if (plan.role) {
    const roleUids = new Set();
    Object.entries(users).forEach(([uid, u]) => {
      if (u.dashboardRole === plan.role) roleUids.add(uid);
    });
    docs = docs.filter((d) => roleUids.has(d.assignedUserUid));
  }

  // Channel filter
  if (plan.channel) {
    docs = docs.filter((d) => d.channelType === plan.channel);
  }

  return docs;
}

// ── Result Renderer ───────────────────────────────────────────────────────

function ResultView({ plan, data, users }) {
  if (data.length === 0) {
    return <div style={{ textAlign: "center", color: "#8B7355", padding: 40 }}>No results found.</div>;
  }

  // Group data if needed
  if (plan.groupBy && (plan.chartType === "pie" || plan.chartType === "bar")) {
    const groups = {};
    data.forEach((d) => {
      let key;
      switch (plan.groupBy) {
        case "assignee":
          key = users[d.assignedUserUid]?.name || "Unassigned";
          break;
        case "role":
          key = users[d.assignedUserUid]?.dashboardRole || "Unset";
          break;
        case "channel":
          key = d.channelType || "unknown";
          break;
        case "status":
          key = d.status || "unknown";
          break;
        case "month": {
          const dt = d.lastItemAt?.toDate?.() || new Date(d.lastItemAt?.seconds * 1000 || 0);
          key = dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          break;
        }
        default:
          key = "All";
      }
      groups[key] = (groups[key] || 0) + 1;
    });

    const chartData = Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    if (plan.chartType === "pie") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <ResponsiveContainer width="60%" height={350}>
            <PieChart>
              <Pie data={chartData} dataKey="value" cx="50%" cy="50%" outerRadius={130}
                label={({ name, value }) => `${name}: ${value}`}>
                {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 14, lineHeight: 2.2 }}>
            {chartData.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span><strong>{d.name}</strong>: {d.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, color: "#8B7355" }}>Total: {data.length}</div>
          </div>
        </div>
      );
    }

    if (plan.chartType === "bar") {
      return (
        <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 35)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 140 }}>
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#B8860B" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }
  }

  // Stat view
  if (plan.chartType === "stat") {
    return (
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Result Count</div>
          <div className="stat-value">{data.length.toLocaleString()}</div>
        </div>
      </div>
    );
  }

  // Table view (default)
  return (
    <div className="table-wrap" style={{ maxHeight: 500, overflowY: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Roamer</th>
            <th>Status</th>
            <th>Coach</th>
            <th>Channel</th>
            <th>Last Activity</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, plan.limit).map((c) => (
            <tr key={c.id}>
              <td>{c.contactName || "Unknown"}</td>
              <td><span className={`status-badge ${c.status}`}>{c.status || "—"}</span></td>
              <td>{users[c.assignedUserUid]?.name || "Unassigned"}</td>
              <td>{c.channelType || "—"}</td>
              <td>{fmtDate(c.lastItemAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > plan.limit && (
        <div style={{ textAlign: "center", color: "#8B7355", padding: 8, fontSize: 13 }}>
          Showing {plan.limit} of {data.length} results
        </div>
      )}
    </div>
  );
}

// ── Examples ──────────────────────────────────────────────────────────────

const EXAMPLES = [
  "Pie chart of all open conversations assigned to Sales Coach role",
  "Bar chart of open conversations by coach",
  "List stale open conversations older than 30 days",
  "How many unassigned open conversations",
  "Pie chart of open conversations by role",
  "Bar chart of conversations by channel",
  "List open conversations on facebook",
  "Pie chart of open stale 14 day conversations by coach",
  "Count of closed conversations last 30 days",
  "Bar chart of conversations by status last 90 days",
];

// ── Main Component ────────────────────────────────────────────────────────

export default function SmartQuery() {
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState(null);
  const [data, setData] = useState(null);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load users once
  useEffect(() => {
    async function loadUsers() {
      let cached = getCached("podium-users-full");
      if (!cached) {
        const snap = await getDocs(collection(db, "podium_users"));
        cached = {};
        snap.forEach((d) => { cached[d.id] = d.data(); });
        setCached("podium-users-full", cached, 15);
      }
      setUsers(cached);
    }
    loadUsers();
  }, []);

  async function runQuery(text) {
    const q = text || input;
    if (!q.trim()) return;
    setInput(q);
    setLoading(true);
    setError(null);

    try {
      const parsed = parseQuery(q);
      setPlan(parsed);

      // Validate parse produced meaningful filters
      const hasFilters = parsed.status || parsed.role || parsed.stale || parsed.channel || parsed.assignee || parsed.dateRange || parsed.direction;
      if (!hasFilters && parsed.chartType === "table" && !parsed.groupBy) {
        parsed.warnings = ["No specific filters detected. Showing the most recent conversations. Try adding keywords like: open, closed, stale, sales coach, by coach, pie chart."];
      }

      const results = await executeQuery(parsed, users);
      setData(results);

      // Build success/empty info
      if (results.length === 0) {
        const reasons = [];
        if (parsed.status) reasons.push(`Status filter "${parsed.status}" matched 0 conversations`);
        if (parsed.role) {
          const roleCount = Object.values(users).filter(u => u.dashboardRole === parsed.role).length;
          if (roleCount === 0) reasons.push(`No users have the "${parsed.role}" dashboard role assigned. Set roles in the Users tab.`);
          else reasons.push(`${roleCount} user(s) with "${parsed.role}" role, but none have matching conversations`);
        }
        if (parsed.stale) reasons.push(`No conversations inactive for more than ${parsed.staleDays} days`);
        if (parsed.channel) reasons.push(`Channel "${parsed.channel}" returned no matches`);
        if (parsed.dateRange) reasons.push(`No matching conversations in the last ${parsed.dateRange} days`);
        if (reasons.length === 0) reasons.push("The combination of filters returned no results. Try broadening your query.");
        parsed.emptyReasons = reasons;
      }
    } catch (err) {
      setError(err.message);
      setData(null);
    }
    setLoading(false);
  }

  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <h2>Smart Query</h2>
      <p style={{ marginBottom: 12, color: "#8B7355" }}>
        Describe what you want to see in plain text. Supports pie charts, bar charts, counts, and lists with filters for status, role, coach, channel, stale conversations, and date ranges.
        <button
          onClick={() => setHelpOpen(!helpOpen)}
          style={{ marginLeft: 8, background: "none", border: "1px solid #ccc", borderRadius: 4, padding: "2px 10px", fontSize: 12, cursor: "pointer", color: "#555" }}
        >
          {helpOpen ? "Hide Guide ▲" : "Usage Guide ▼"}
        </button>
      </p>

      {helpOpen && (
        <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 10, padding: "20px 24px", marginBottom: 20, fontSize: 13, lineHeight: 1.8, maxHeight: 500, overflowY: "auto" }}>
          <h3 style={{ fontFamily: "Rajdhani", fontSize: 16, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 1 }}>Smart Query Guide</h3>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>How It Works</strong>
            <p style={{ margin: "4px 0", color: "#555" }}>
              Type a natural language description of the data you want to see. The parser extracts keywords to determine the chart type, filters, and grouping — then runs a Firestore query and renders the results.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Chart Types</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Output</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>pie chart</code></td><td style={{ padding: "4px 8px" }}>Pie chart (requires a "by" grouping)</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>bar chart</code></td><td style={{ padding: "4px 8px" }}>Horizontal bar chart (requires a "by" grouping)</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>count</code>, <code>how many</code>, <code>total</code></td><td style={{ padding: "4px 8px" }}>Single number stat card</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>list</code>, <code>show me</code>, <code>find</code>, <code>search</code></td><td style={{ padding: "4px 8px" }}>Data table (default if no chart keyword)</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Status Filters</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Filter</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>open</code></td><td style={{ padding: "4px 8px" }}>Only open conversations</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>closed</code></td><td style={{ padding: "4px 8px" }}>Only closed conversations</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>unassigned</code></td><td style={{ padding: "4px 8px" }}>Conversations with no assigned user</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Stale / Inactive</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Filter</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>stale</code></td><td style={{ padding: "4px 8px" }}>No activity for 7+ days (default)</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>stale 14 days</code>, <code>stale 30 days</code></td><td style={{ padding: "4px 8px" }}>No activity for specified days</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>inactive</code>, <code>dormant</code>, <code>no activity</code></td><td style={{ padding: "4px 8px" }}>Same as stale (7 days)</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Role Filters</strong>
            <p style={{ margin: "4px 0 4px", color: "#555", fontSize: 12 }}>Filters by the dashboard role assigned in the Users tab.</p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Role</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>sales coach</code></td><td style={{ padding: "4px 8px" }}>Sales Coach</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>team leader</code>, <code>leader</code></td><td style={{ padding: "4px 8px" }}>Team Leader</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>team member</code></td><td style={{ padding: "4px 8px" }}>Team Member</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>account owner</code>, <code>owner</code></td><td style={{ padding: "4px 8px" }}>Account Owner</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Grouping (required for pie/bar charts)</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Groups by</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>by coach</code>, <code>per coach</code>, <code>by user</code></td><td style={{ padding: "4px 8px" }}>Assigned user name</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>by role</code>, <code>per role</code></td><td style={{ padding: "4px 8px" }}>Dashboard role</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>by channel</code>, <code>by type</code></td><td style={{ padding: "4px 8px" }}>Channel type (phone, email, facebook)</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>by status</code></td><td style={{ padding: "4px 8px" }}>Open vs closed</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>by month</code></td><td style={{ padding: "4px 8px" }}>Month of last activity</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>by location</code></td><td style={{ padding: "4px 8px" }}>Podium location</td></tr>
              </tbody>
            </table>
            <p style={{ margin: "4px 0", color: "#555", fontSize: 12 }}>Tip: When a role is mentioned with a chart type but no grouping, it automatically groups by coach within that role.</p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Channel Filters</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Channel</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>phone</code>, <code>sms</code>, <code>text</code></td><td style={{ padding: "4px 8px" }}>Phone / SMS</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>email</code></td><td style={{ padding: "4px 8px" }}>Email</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>facebook</code></td><td style={{ padding: "4px 8px" }}>Facebook Messenger</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Date Ranges</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Range</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>last 7 days</code>, <code>past 7 days</code></td><td style={{ padding: "4px 8px" }}>Last 7 days</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>last 30 days</code></td><td style={{ padding: "4px 8px" }}>Last 30 days</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>last 2 weeks</code></td><td style={{ padding: "4px 8px" }}>Last 14 days</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>last 3 months</code>, <code>past 6 months</code></td><td style={{ padding: "4px 8px" }}>Last 90 / 180 days</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: "#3D2B1F" }}>Message Direction</strong>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
              <thead><tr style={{ borderBottom: "1px solid #e0d5c5" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Keyword</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#8B7355", fontSize: 12 }}>Direction</th></tr></thead>
              <tbody>
                <tr><td style={{ padding: "4px 8px" }}><code>inbound</code>, <code>received</code></td><td style={{ padding: "4px 8px" }}>Messages from customers</td></tr>
                <tr><td style={{ padding: "4px 8px" }}><code>outbound</code>, <code>sent</code></td><td style={{ padding: "4px 8px" }}>Messages from team</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#3D2B1F" }}>Combining Filters</strong>
            <p style={{ margin: "4px 0", color: "#555" }}>
              You can combine any filters in a single query. The parser extracts all recognized keywords regardless of order.
            </p>
            <div style={{ background: "#f8f8f8", borderRadius: 6, padding: "8px 12px", marginTop: 6, fontSize: 12, color: "#333", lineHeight: 2 }}>
              <div><code>"Pie chart of open stale 14 day conversations by coach"</code> → pie chart + open + stale 14d + group by coach</div>
              <div><code>"How many unassigned open conversations last 30 days"</code> → count + unassigned + open + 30 day range</div>
              <div><code>"Bar chart of closed conversations by role last 3 months"</code> → bar chart + closed + group by role + 90 day range</div>
              <div><code>"List open conversations on facebook"</code> → table + open + channel facebook</div>
              <div><code>"Count of open conversations assigned to sales coach that are stale 30 days"</code> → count + open + sales coach role + stale 30d</div>
            </div>
          </div>

          <div style={{ marginTop: 12, padding: "8px 12px", background: "#f0f4ff", borderRadius: 6, fontSize: 12, color: "#444" }}>
            <strong>Note:</strong> Roles must be assigned in the <strong>Users</strong> tab for role-based filters to work. The query searches conversations stored in Firestore (up to 2,000 results per query). For full-text message search, use the <strong>Campaign Analysis</strong> tab.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          className="search-input"
          placeholder='Try: "Pie chart of open conversations assigned to Sales Coach role that are stale"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runQuery()}
          style={{ marginBottom: 0, flex: 1 }}
        />
        <button className="btn" onClick={() => runQuery()} disabled={loading}>
          {loading ? "Querying..." : "Run"}
        </button>
      </div>

      {/* Example queries — always visible */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "#8B7355", marginBottom: 8, fontFamily: "Rajdhani" }}>
          Example Queries
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => runQuery(ex)}
              style={{
                background: input === ex ? "#1A1A1A" : "#f5ede3",
                color: input === ex ? "#fff" : "#333",
                border: "1px solid #ddd", borderRadius: 6,
                padding: "6px 12px", fontSize: 13, cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Results area */}
      <div style={{ background: "#fafafa", border: "1px solid #e0d5c5", borderRadius: 10, padding: 20, minHeight: 200 }}>
        {!plan && !loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, color: "#999", fontSize: 15 }}>
            Type a query or click an example above to get started
          </div>
        )}

        {/* Query interpretation */}
        {plan && !loading && (
          <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13 }}>
            <div style={{ color: "#555", marginBottom: 6 }}>
              <strong>Interpreted as:</strong> {plan.description}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {plan.status && <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>status: {plan.status}</span>}
              {plan.role && <span style={{ background: "#e3f2fd", color: "#1565c0", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>role: {plan.role}</span>}
              {plan.stale && <span style={{ background: "#fff3e0", color: "#e65100", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>stale: &gt;{plan.staleDays}d</span>}
              {plan.channel && <span style={{ background: "#f3e5f5", color: "#7b1fa2", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>channel: {plan.channel}</span>}
              {plan.assignee && <span style={{ background: "#fce4ec", color: "#c62828", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>assignee: {plan.assignee}</span>}
              {plan.dateRange && <span style={{ background: "#e0f7fa", color: "#00695c", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>range: last {plan.dateRange}d</span>}
              {plan.groupBy && <span style={{ background: "#f5ede3", color: "#333", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>group: {plan.groupBy}</span>}
              <span style={{ background: "#f5ede3", color: "#333", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>chart: {plan.chartType}</span>
            </div>
            {/* Warnings */}
            {plan.warnings && plan.warnings.map((w, i) => (
              <div key={i} style={{ color: "#b57900", fontSize: 12, marginTop: 4 }}>⚠ {w}</div>
            ))}
          </div>
        )}

        {/* Success banner */}
        {data && plan && !loading && data.length > 0 && (
          <div style={{ background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#2e7d32" }}>
            ✓ Query returned <strong>{data.length.toLocaleString()}</strong> result{data.length !== 1 ? "s" : ""}
            {plan.stale && ` — conversations with no activity for more than ${plan.staleDays} days`}
            {plan.role && ` — filtered to ${plan.role} role`}
          </div>
        )}

        {/* Empty results with reasons */}
        {data && plan && !loading && data.length === 0 && (
          <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#f57f17" }}>
            <div style={{ marginBottom: 6 }}>⚠ No results found</div>
            {plan.emptyReasons && plan.emptyReasons.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: "#8d6e00", marginLeft: 16 }}>• {r}</div>
            ))}
          </div>
        )}

        {/* Firestore error */}
        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #fcc", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#c00" }}>
            <div style={{ marginBottom: 4 }}>✕ Query failed</div>
            <div style={{ fontSize: 12, color: "#900" }}>{error}</div>
            {error.includes("index") && (
              <div style={{ fontSize: 12, color: "#900", marginTop: 4 }}>This query requires a Firestore composite index. Check the Firebase Console to create it.</div>
            )}
            {error.includes("permission") && (
              <div style={{ fontSize: 12, color: "#900", marginTop: 4 }}>Firestore security rules are blocking this query. Check that the logged-in user has read access.</div>
            )}
          </div>
        )}

        {loading && <div className="loading">Running query...</div>}

        {data && plan && !loading && data.length > 0 && <ResultView plan={plan} data={data} users={users} />}
      </div>
    </>
  );
}
