import { useState, useEffect } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "firebase/auth";
import Dashboard from "./pages/Dashboard";
import DeliveryDetail from "./pages/DeliveryDetail";
import NewDelivery from "./pages/NewDelivery";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "new", label: "New Delivery" },
];

const googleProvider = new GoogleAuthProvider();

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

  async function handleGoogle() {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err.message.replace("Firebase: ", ""));
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-brand">ROA Delivery</div>
        <div className="login-sub">Sign in to manage delivery checklists</div>
        <button className="dl-btn dl-btn-google" type="button" onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Sign in with Google
        </button>
        <div className="login-divider"><span>or</span></div>
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
