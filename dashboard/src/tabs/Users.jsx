import { useState, useEffect } from "react";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

const ROLES = ["Sales Coach", "Leader", "Team Member", "Reception", "Support", "Marketing", "Owner", "Inactive"];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, "podium_users"));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setUsers(list);
      setLoading(false);
    }
    load();
  }, []);

  async function setRole(uid, role) {
    setSaving(uid);
    try {
      await updateDoc(doc(db, "podium_users", uid), { dashboardRole: role });
      setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, dashboardRole: role } : u)));
    } catch (err) {
      console.error("Failed to update role:", err);
    }
    setSaving(null);
  }

  const filtered = filter === "all"
    ? users
    : filter === "unset"
      ? users.filter((u) => !u.dashboardRole)
      : users.filter((u) => u.dashboardRole === filter);

  const roleCounts = {};
  users.forEach((u) => {
    const r = u.dashboardRole || "Unset";
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  });

  if (loading) return <div className="loading">Loading users...</div>;

  return (
    <>
      <h2>User Management</h2>
      <p style={{ marginBottom: 16, color: "#787878" }}>
        Assign dashboard roles to Podium users. These roles are used for filtering across all tabs.
      </p>

      <div className="filters" style={{ marginBottom: 16 }}>
        <button className={`filter-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All ({users.length})
        </button>
        <button className={`filter-btn ${filter === "unset" ? "active" : ""}`} onClick={() => setFilter("unset")}>
          Unset ({roleCounts["Unset"] || 0})
        </button>
        {ROLES.map((r) => (
          <button key={r} className={`filter-btn ${filter === r ? "active" : ""}`} onClick={() => setFilter(r)}>
            {r} ({roleCounts[r] || 0})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Podium Role</th>
              <th>Dashboard Role</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name || "Unknown"}</strong></td>
                <td>{u.email || "—"}</td>
                <td style={{ color: "#787878", fontSize: 13 }}>{u.role || "—"}</td>
                <td>
                  <select
                    value={u.dashboardRole || ""}
                    onChange={(e) => setRole(u.id, e.target.value)}
                    disabled={saving === u.id}
                    style={{
                      padding: "4px 8px",
                      border: "1px solid #C8C8C8",
                      borderRadius: 4,
                      fontSize: 13,
                      background: saving === u.id ? "#f0f0f0" : "#fff",
                      cursor: saving === u.id ? "wait" : "pointer",
                    }}
                  >
                    <option value="">— Select Role —</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
