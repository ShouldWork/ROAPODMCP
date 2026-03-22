import { useState } from "react";
import { STATUS_OPTIONS } from "../checklist";
import { MOCK_DELIVERIES } from "../mockData";

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

export default function Dashboard({ onOpen }) {
  const [filter, setFilter] = useState("all");
  const deliveries = MOCK_DELIVERIES;

  // Stats
  const pending = deliveries.filter((d) => d.status === "pending").length;
  const inProgress = deliveries.filter((d) => ["prep", "inspection"].includes(d.status)).length;
  const ready = deliveries.filter((d) => d.status === "ready").length;
  const completed = deliveries.filter((d) => d.status === "completed").length;

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
          <h1 className="dl-title">Delivery Manager</h1>
          <p className="dl-subtitle">Track prep, inspections, and customer walkthroughs for every unit.</p>
        </div>
        <div className="dl-hero-stats">
          <div className="dl-score">
            <span className="dl-score-value">{pending}</span>
            <span className="dl-score-label">Pending</span>
          </div>
          <div className="dl-score">
            <span className="dl-score-value">{inProgress}</span>
            <span className="dl-score-label">In Progress</span>
          </div>
          <div className="dl-score">
            <span className="dl-score-value">{ready}</span>
            <span className="dl-score-label">Ready</span>
          </div>
          <div className="dl-score">
            <span className="dl-score-value">{completed}</span>
            <span className="dl-score-label">Completed</span>
          </div>
        </div>
      </div>

      {/* Status distribution */}
      <div className="dl-grid-top">
        <div className="dl-glass-card">
          <h3 className="dl-card-title">Status Overview</h3>
          {STATUS_OPTIONS.map((s) => {
            const count = deliveries.filter((d) => d.status === s.key).length;
            const pct = deliveries.length > 0 ? Math.round((count / deliveries.length) * 100) : 0;
            return (
              <div className="dl-dist-row" key={s.key}>
                <span className="dl-dist-dot" style={{ background: s.color }} />
                <span className="dl-dist-label">{s.label}</span>
                <div className="dl-dist-track">
                  <div className="dl-dist-fill" style={{ width: `${pct}%`, background: s.color }} />
                </div>
                <span className="dl-dist-pct">{pct}%</span>
              </div>
            );
          })}
        </div>

        <div className="dl-glass-card">
          <h3 className="dl-card-title">Quick Stats</h3>
          <div className="dl-quick-stats">
            <div className="dl-quick-stat">
              <span className="dl-qs-num">{deliveries.length}</span>
              <span className="dl-qs-label">Total Units</span>
            </div>
            <div className="dl-quick-stat">
              <span className="dl-qs-num">
                {deliveries.length > 0
                  ? Math.round(deliveries.reduce((s, d) => s + progressPct(d.checklist), 0) / deliveries.length)
                  : 0}%
              </span>
              <span className="dl-qs-label">Avg Progress</span>
            </div>
            <div className="dl-quick-stat">
              <span className="dl-qs-num">2</span>
              <span className="dl-qs-label">Due Today</span>
            </div>
          </div>
        </div>
      </div>

      {/* Delivery list */}
      <div className="dl-glass-card dl-list-card">
        <div className="dl-list-header">
          <h3 className="dl-card-title" style={{ marginBottom: 0 }}>Deliveries</h3>
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
                        <span className="dl-status-badge" style={{ background: si.color + "18", color: si.color }}>
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
