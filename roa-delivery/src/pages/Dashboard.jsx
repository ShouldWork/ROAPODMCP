import { useState, useEffect } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { STATUS_OPTIONS } from "../checklist";

function statusInfo(key) {
  return STATUS_OPTIONS.find((s) => s.key === key) || STATUS_OPTIONS[0];
}

function progressPct(checklist) {
  if (!checklist || checklist.length === 0) return 0;
  return Math.round((checklist.filter((c) => c.completed).length / checklist.length) * 100);
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function Dashboard({ onOpen }) {
  const [filter, setFilter] = useState("all");
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "deliveries"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setDeliveries(docs);
      setLoading(false);
    }, (err) => {
      console.error("Firestore snapshot error:", err);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <div className="dl-loading">Loading deliveries...</div>;

  // Stats
  const pending = deliveries.filter((d) => d.status === "pending").length;
  const inProgress = deliveries.filter((d) => ["prep", "inspection"].includes(d.status)).length;
  const ready = deliveries.filter((d) => d.status === "ready").length;
  const completed = deliveries.filter((d) => d.status === "completed").length;
  const avgProgress = deliveries.length > 0
    ? Math.round(deliveries.reduce((s, d) => s + progressPct(d.checklist), 0) / deliveries.length)
    : 0;
  const today = todayStr();
  const dueToday = deliveries.filter((d) => d.scheduledDate === today && d.status !== "completed").length;

  // Filter
  const filtered = filter === "all"
    ? deliveries.filter((d) => d.status !== "completed")
    : filter === "completed"
      ? deliveries.filter((d) => d.status === "completed")
      : deliveries.filter((d) => d.status === filter);

  return (
    <div className="dl-page">
      {/* Hero */}
      <div className="dl-hero">
        <div>
          <h1 className="dl-title">Delivery Dashboard</h1>
          <p className="dl-subtitle">Track prep, inspections, and customer walkthroughs for every unit.</p>
        </div>
        <div className="dl-hero-stats">
          <div className="dl-score">
            <span className="dl-score-value">{avgProgress}</span>
            <span className="dl-score-max">%</span>
            <span className="dl-score-label">Avg Progress</span>
          </div>
          <div className="dl-score">
            <span className="dl-score-value">{deliveries.length}</span>
            <span className="dl-score-max"></span>
            <span className="dl-score-label">Total Units</span>
          </div>
          <div className="dl-score">
            <span className="dl-score-value">{dueToday}</span>
            <span className="dl-score-max"></span>
            <span className="dl-score-label">Due Today</span>
          </div>
        </div>
      </div>

      {/* Top row: 3-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Status counts */}
        <div className="dl-glass-card">
          <h3 className="dl-card-title">Delivery Pipeline</h3>
          <div className="dl-pipeline-grid">
            {[
              { label: "Pending", value: pending, color: "#8b7fc7" },
              { label: "In Prep", value: inProgress, color: "#f0a030" },
              { label: "Ready", value: ready, color: "#34c77b" },
              { label: "Completed", value: completed, color: "#7c5ce0" },
            ].map((s) => (
              <div key={s.label} className="dl-pipeline-stat" style={{
                background: s.color + "0c",
              }}>
                <div className="dl-pipeline-num" style={{ color: s.color }}>{s.value}</div>
                <div className="dl-pipeline-label" style={{ color: s.color }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Distribution */}
        <div className="dl-glass-card">
          <h3 className="dl-card-title">Status Distribution</h3>
          {STATUS_OPTIONS.map((s) => {
            const count = deliveries.filter((d) => d.status === s.key).length;
            const pct = deliveries.length > 0 ? Math.round((count / deliveries.length) * 100) : 0;
            return (
              <div className="dl-dist-row" key={s.key}>
                <span className="dl-dist-label">{s.label}</span>
                <div className="dl-dist-track">
                  <div className="dl-dist-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${s.color}88, ${s.color})` }} />
                </div>
                <span className="dl-dist-pct">{pct}%</span>
              </div>
            );
          })}
        </div>

        {/* Quick Stats */}
        <div className="dl-glass-card">
          <h3 className="dl-card-title">Quick Stats</h3>
          <div className="dl-quick-stats" style={{ gridTemplateColumns: "1fr" }}>
            <div className="dl-quick-stat">
              <span className="dl-qs-num">{deliveries.length}</span>
              <span className="dl-qs-label">Total Units</span>
            </div>
            <div className="dl-quick-stat">
              <span className="dl-qs-num">{avgProgress}%</span>
              <span className="dl-qs-label">Avg Progress</span>
            </div>
            <div className="dl-quick-stat">
              <span className="dl-qs-num">{dueToday}</span>
              <span className="dl-qs-label">Due Today</span>
            </div>
          </div>
        </div>
      </div>

      {/* Delivery list */}
      <div className="dl-glass-card dl-list-card">
        <div className="dl-list-header">
          <h3 className="dl-card-title" style={{ marginBottom: 0 }}>Recent Deliveries</h3>
          <div className="dl-filters">
            {[{ key: "all", label: "Active" }, ...STATUS_OPTIONS].map((f) => (
              <button
                key={f.key}
                className={`dl-filter-btn ${filter === f.key ? "active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="dl-empty">No deliveries found.</div>
        ) : (
          <div className="dl-table-wrap">
            <table className="dl-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Assigned</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const si = statusInfo(d.status);
                  const pct = progressPct(d.checklist);
                  return (
                    <tr key={d.id} onClick={() => onOpen(d.id)}>
                      <td>
                        <strong>{d.unitYear} {d.unitMake} {d.unitModel}</strong>
                        {d.stockNumber && <span className="dl-stock">#{d.stockNumber}</span>}
                      </td>
                      <td>{d.customerName || "—"}</td>
                      <td>
                        <span className="dl-status-badge" style={{ background: si.color + "14", color: si.color }}>
                          <span className="dl-status-dot" style={{ background: si.color }} />
                          {si.label}
                        </span>
                      </td>
                      <td>
                        <div className="dl-progress-cell">
                          <div className="dl-progress-track">
                            <div className="dl-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="dl-progress-num">{pct}%</span>
                        </div>
                      </td>
                      <td>{d.assignedTo || "—"}</td>
                      <td className="dl-date-cell">{fmtDate(d.scheduledDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
