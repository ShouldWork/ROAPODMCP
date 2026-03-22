import { useState, useEffect } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import Dashboard from "./pages/Dashboard";
import DeliveryDetail from "./pages/DeliveryDetail";
import NewDelivery from "./pages/NewDelivery";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "new", label: "New Delivery" },
];

function LoginScreen() {
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
    } catch (err) {
      setError(err.message.replace("Firebase: ", ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-brand">ROA Delivery</div>
        <div className="login-sub">Sign in to manage delivery checklists</div>
        <form onSubmit={handleLogin}>
          <input
            className="dl-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="dl-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button className="dl-btn dl-btn-primary" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [page, setPage] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  if (user === undefined) return <div className="dl-loading">Loading...</div>;
  if (!user) return <LoginScreen />;

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
          <span className="dl-user-email">{user.email}</span>
          <button className="dl-nav-btn" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </nav>

      {/* Content */}
      <main className="dl-main">
        {page === "dashboard" && <Dashboard onOpen={openDelivery} />}
        {page === "detail" && selectedId && <DeliveryDetail id={selectedId} onBack={goHome} userEmail={user.email} />}
        {page === "new" && <NewDelivery onCreated={(id) => openDelivery(id)} userEmail={user.email} />}
      </main>
    </div>
  );
}
