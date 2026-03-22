import { useState } from "react";
import { CATEGORIES, STATUS_OPTIONS } from "../checklist";
import { MOCK_DELIVERIES } from "../mockData";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusInfo(key) {
  return STATUS_OPTIONS.find((s) => s.key === key) || STATUS_OPTIONS[0];
}

export default function DeliveryDetail({ id, onBack }) {
  const found = MOCK_DELIVERIES.find((d) => d.id === id);
  const [delivery, setDelivery] = useState(found);

  if (!delivery) return <div className="dl-loading">Delivery not found.</div>;

  const checklist = delivery.checklist || [];
  const totalItems = checklist.length;
  const completedItems = checklist.filter((c) => c.completed).length;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const si = statusInfo(delivery.status);

  // Group by category
  const grouped = {};
  for (const item of checklist) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  function toggleItem(itemId) {
    const newChecklist = delivery.checklist.map((c) => {
      if (c.id !== itemId) return c;
      return {
        ...c,
        completed: !c.completed,
        completedBy: !c.completed ? "demo@roa-rv.com" : null,
        completedAt: !c.completed ? new Date().toISOString() : null,
      };
    });
    setDelivery({ ...delivery, checklist: newChecklist });
  }

  function updateStatus(newStatus) {
    setDelivery({ ...delivery, status: newStatus });
  }

  return (
    <div className="dl-page">
      {/* Back button */}
      <button className="dl-back-btn" onClick={onBack}>← Back to Dashboard</button>

      {/* Hero */}
      <div className="dl-detail-hero">
        <div className="dl-detail-hero-left">
          <h1 className="dl-title">
            {delivery.unitYear} {delivery.unitMake} {delivery.unitModel}
          </h1>
          {delivery.stockNumber && <span className="dl-stock-large">Stock #{delivery.stockNumber}</span>}
          <p className="dl-subtitle">{delivery.customerName} — {delivery.customerPhone || delivery.customerEmail || "No contact"}</p>
        </div>
        <div className="dl-detail-hero-right">
          <div className="dl-progress-ring">
            <svg viewBox="0 0 100 100" className="dl-ring-svg">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(140,120,200,0.12)" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke="url(#progressGrad)" strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${pct * 2.64} ${264 - pct * 2.64}`}
                strokeDashoffset="66"
                style={{ transition: "stroke-dasharray 0.5s ease" }}
              />
              <defs>
                <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#b39ddb" />
                  <stop offset="100%" stopColor="#4caf7c" />
                </linearGradient>
              </defs>
            </svg>
            <div className="dl-ring-text">
              <span className="dl-ring-pct">{pct}%</span>
              <span className="dl-ring-label">Done</span>
            </div>
          </div>
          <div className="dl-detail-stats">
            <span>{completedItems}/{totalItems} items</span>
          </div>
        </div>
      </div>

      {/* Status + info row */}
      <div className="dl-detail-row">
        <div className="dl-glass-card dl-info-card">
          <h3 className="dl-card-title">Details</h3>
          <div className="dl-info-grid">
            <div className="dl-info-item">
              <span className="dl-info-label">Customer</span>
              <span className="dl-info-value">{delivery.customerName || "—"}</span>
            </div>
            <div className="dl-info-item">
              <span className="dl-info-label">Phone</span>
              <span className="dl-info-value">{delivery.customerPhone || "—"}</span>
            </div>
            <div className="dl-info-item">
              <span className="dl-info-label">Email</span>
              <span className="dl-info-value">{delivery.customerEmail || "—"}</span>
            </div>
            <div className="dl-info-item">
              <span className="dl-info-label">Assigned To</span>
              <span className="dl-info-value">{delivery.assignedTo || "—"}</span>
            </div>
            <div className="dl-info-item">
              <span className="dl-info-label">Scheduled</span>
              <span className="dl-info-value">{fmtDate(delivery.scheduledDate)}</span>
            </div>
            <div className="dl-info-item">
              <span className="dl-info-label">Created</span>
              <span className="dl-info-value">{fmtDate(delivery.createdAt)}</span>
            </div>
          </div>
          {delivery.notes && (
            <div className="dl-notes">
              <span className="dl-info-label">Notes</span>
              <p>{delivery.notes}</p>
            </div>
          )}
        </div>

        <div className="dl-glass-card dl-status-card">
          <h3 className="dl-card-title">Status</h3>
          <div className="dl-status-options">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.key}
                className={`dl-status-opt ${delivery.status === s.key ? "active" : ""}`}
                style={{
                  "--dot-color": s.color,
                  background: delivery.status === s.key ? s.color + "18" : undefined,
                  borderColor: delivery.status === s.key ? s.color + "40" : undefined,
                }}
                onClick={() => updateStatus(s.key)}
              >
                <span className="dl-status-dot" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="dl-checklist-section">
        {CATEGORIES.map((cat) => {
          const items = grouped[cat] || [];
          if (items.length === 0) return null;
          const catDone = items.filter((i) => i.completed).length;
          const catPct = Math.round((catDone / items.length) * 100);

          return (
            <div className="dl-glass-card dl-check-card" key={cat}>
              <div className="dl-check-header">
                <h3 className="dl-card-title" style={{ marginBottom: 0 }}>{cat}</h3>
                <div className="dl-check-progress">
                  <div className="dl-check-track">
                    <div className="dl-check-fill" style={{ width: `${catPct}%` }} />
                  </div>
                  <span className="dl-check-count">{catDone}/{items.length}</span>
                </div>
              </div>
              <div className="dl-check-items">
                {items.map((item) => (
                  <label
                    key={item.id}
                    className={`dl-check-item ${item.completed ? "done" : ""}`}
                    onClick={(e) => { e.preventDefault(); toggleItem(item.id); }}
                  >
                    <span className={`dl-checkbox ${item.completed ? "checked" : ""}`}>
                      {item.completed && "✓"}
                    </span>
                    <span className="dl-check-text">{item.item}</span>
                    {item.completedBy && (
                      <span className="dl-check-meta">
                        {item.completedBy.split("@")[0]} · {fmtTime(item.completedAt)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
