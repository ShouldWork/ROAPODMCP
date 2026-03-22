import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import DeliveryDetail from "./pages/DeliveryDetail";
import NewDelivery from "./pages/NewDelivery";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "new", label: "New Delivery" },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);

  function openDelivery(id) {
    setSelectedId(id);
    setPage("detail");
  }

  function goHome() {
    setSelectedId(null);
    setPage("dashboard");
  }

  return (
    <div className="dl-app">
      {/* Top nav */}
      <nav className="dl-nav">
        <div className="dl-nav-left">
          <span className="dl-brand" onClick={goHome}>ROA Delivery</span>
          <div className="dl-nav-items">
            {NAV_ITEMS.map((n) => (
              <button
                key={n.key}
                className={`dl-nav-btn ${page === n.key ? "active" : ""}`}
                onClick={() => { setPage(n.key); setSelectedId(null); }}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dl-nav-right">
          <span className="dl-user-email">mike@roa-rv.com</span>
          <button className="dl-nav-btn">Sign Out</button>
        </div>
      </nav>

      {/* Content */}
      <main className="dl-main">
        {page === "dashboard" && <Dashboard onOpen={openDelivery} />}
        {page === "detail" && selectedId && <DeliveryDetail id={selectedId} onBack={goHome} />}
        {page === "new" && <NewDelivery onCreated={(id) => openDelivery(id)} />}
      </main>
    </div>
  );
}
