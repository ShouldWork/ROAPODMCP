import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, where, getDocs, getCountFromServer } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { db } from "../firebase";

const COLORS = ["#1A1A1A", "#787878", "#C8C8C8", "#3A3A3A"];

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
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Load users for name resolution
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      userSnap.forEach((d) => { userMap[d.id] = d.data().name; });
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
        .map(([uid, count]) => ({ name: userMap[uid] || uid.substring(0, 8), count }))
        .sort((a, b) => b.count - a.count);
      setCoachLoad(loadData);

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="loading">Loading dashboard...</div>;

  const assignRate = stats.total > 0
    ? Math.round(((stats.total - (coachLoad.find((c) => c.name === "Unassigned")?.count || 0)) / stats.total) * 100)
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
          <h3>Sales Coach Load (Open)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={coachLoad} layout="vertical" margin={{ left: 80 }}>
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1A1A1A" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
