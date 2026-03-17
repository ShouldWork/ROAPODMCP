import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, where, getDocs, getCountFromServer, startAfter } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { db } from "../firebase";
import { getCached, setCached } from "../cache";

const COLORS = ["#1A1A1A", "#787878", "#C8C8C8", "#3A3A3A"];
const PIE_COLORS = [
  "#1A1A1A", "#3A3A3A", "#555555", "#787878", "#999999",
  "#AAAAAA", "#B0B0B0", "#C0C0C0", "#C8C8C8", "#D5D5D5",
  "#2A2A2A", "#4A4A4A", "#6A6A6A", "#8A8A8A", "#A0A0A0",
];

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function Overview() {
  const [stats, setStats] = useState({ total: 0, open: 0, closed: 0 });
  const [recent, setRecent] = useState([]);
  const [coachLoad, setCoachLoad] = useState([]);
  const [nameQuality, setNameQuality] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Check cache first
      const cached = getCached("overview");
      if (cached) {
        setStats(cached.stats);
        setRecent(cached.recent);
        setCoachLoad(cached.coachLoad);
        setNameQuality(cached.nameQuality);
        setUsers(cached.users);
        setLoading(false);
        return;
      }

      // Load users for name + role resolution
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      const userFull = {};
      userSnap.forEach((d) => {
        const data = d.data();
        userMap[d.id] = data.name;
        userFull[d.id] = data;
      });
      setUsers(userMap);

      // Counts
      const convRef = collection(db, "podium_conversations");
      const [totalSnap, openSnap, closedSnap] = await Promise.all([
        getCountFromServer(convRef),
        getCountFromServer(query(convRef, where("status", "==", "open"))),
        getCountFromServer(query(convRef, where("status", "==", "closed"))),
      ]);
      const total = totalSnap.data().count;
      const open = openSnap.data().count;
      const closed = closedSnap.data().count;
      setStats({ total, open, closed });

      // Recent open conversations
      const recentSnap = await getDocs(
        query(convRef, where("status", "==", "open"), orderBy("lastItemAt", "desc"), limit(6))
      );
      setRecent(recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Coach load
      const allOpen = await getDocs(query(convRef, where("status", "==", "open")));
      const loadMap = {};
      allOpen.forEach((d) => {
        const uid = d.data().assignedUserUid || "Unassigned";
        loadMap[uid] = (loadMap[uid] || 0) + 1;
      });
      const loadData = Object.entries(loadMap)
        .map(([uid, count]) => ({
          uid,
          name: uid === "Unassigned" ? "Unassigned" : (userMap[uid] || uid.substring(0, 8)),
          dashboardRole: userFull[uid]?.dashboardRole || null,
          count,
        }))
        .sort((a, b) => b.count - a.count);
      setCoachLoad(loadData);

      // Contact name quality analysis — paginate to avoid 10k limit
      const batch1 = await getDocs(query(convRef, orderBy("__name__"), limit(10000)));
      const lastDoc = batch1.docs[batch1.docs.length - 1];
      const batch2 = lastDoc ? await getDocs(query(convRef, orderBy("__name__"), startAfter(lastDoc), limit(10000))) : { forEach() {} };
      let duplicateNames = 0, uniqueNames = 0, unknownNames = 0, phoneOnly = 0;
      const processDocs = (snap) => snap.forEach((d) => {
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
      processDocs(batch1);
      processDocs(batch2);
      const nq = [
        { name: "Unique Names", value: uniqueNames },
        { name: "Duplicate First=Last", value: duplicateNames },
        { name: "Unknown", value: unknownNames },
        { name: "Phone Number Only", value: phoneOnly },
      ].filter((d) => d.value > 0);
      setNameQuality(nq);

      // Cache for 5 minutes
      setCached("overview", {
        stats: { total, open, closed },
        recent: recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        coachLoad: loadData,
        nameQuality: nq,
        users: userMap,
      }, 5);

      setLoading(false);
    }
    load();
  }, []);

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
      <h2>Overview</h2>
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
                  <Bar dataKey="count" fill="#1A1A1A" radius={[0, 4, 4, 0]} />
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
            if (coachOnly.length === 0) return <p style={{ color: "#787878", textAlign: "center" }}>No users with "Sales Coach" role assigned. Set roles in the Users tab.</p>;
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
            <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
              <ResponsiveContainer width="50%" height={300}>
                <PieChart>
                  <Pie data={nameQuality} dataKey="value" cx="50%" cy="50%" outerRadius={110} label={({ name, value }) => `${name}: ${value.toLocaleString()}`}>
                    {nameQuality.map((_, i) => <Cell key={i} fill={["#1A1A1A", "#C8C8C8", "#787878", "#3A3A3A"][i % 4]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 14, lineHeight: 2 }}>
                {nameQuality.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 2, background: ["#1A1A1A", "#C8C8C8", "#787878", "#3A3A3A"][i % 4] }} />
                    <span><strong>{d.name}</strong>: {d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <h3 style={{ fontFamily: "Rajdhani", fontSize: 14, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
        Recently Active Open Conversations
      </h3>
      <div className="table-wrap">
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
              <tr><td colSpan={4} style={{ textAlign: "center", color: "#787878" }}>No open conversations yet. Run the backfill first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
