import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase";
import Dashboard from "./pages/Dashboard";
import DeliveryDetail from "./pages/DeliveryDetail";
import NewDelivery from "./pages/NewDelivery";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError("Invalid email or password.");
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-brand">ROA Delivery</div>
        <p className="login-sub">Internal delivery checklist management</p>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="dl-input"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="dl-input"
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button className="dl-btn dl-btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "new", label: "New Delivery" },
];

export default function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  function openDelivery(id) {
    setSelectedId(id);
    setPage("detail");
  }

  function goHome() {
    setSelectedId(null);
    setPage("dashboard");
  }

  if (user === undefined) return <div className="dl-loading">Loading...</div>;
  if (!user) return <Login />;

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
          <span className="dl-user-email">{user.email}</span>
          <button className="dl-nav-btn" onClick={() => signOut(auth)}>Sign Out</button>
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
