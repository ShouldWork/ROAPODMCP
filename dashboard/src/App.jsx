import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase";
import { clearCache } from "./cache";
import Overview from "./tabs/Overview";
import Conversations from "./tabs/Conversations";
import FollowUp from "./tabs/FollowUp";
import CoachWorkload from "./tabs/CoachWorkload";
import CampaignAnalysis from "./tabs/CampaignAnalysis";
import ContactSearch from "./tabs/ContactSearch";
import Users from "./tabs/Users";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "conversations", label: "Conversations" },
  { key: "followup", label: "Follow-Up Priority" },
  { key: "workload", label: "Coach Workload" },
  { key: "campaigns", label: "Campaign Analysis" },
  { key: "contacts", label: "Contact Search" },
  { key: "users", label: "Users" },
];

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
    } catch (err) {
      setError("Invalid email or password.");
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <img src="/ROA_Off-Road_MTNS_LOGO_White.png" alt="ROA OFF-ROAD" className="login-logo" />
        <div className="subtitle" style={{ marginBottom: 24 }}>Podium Intelligence</div>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="search-input"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="search-input"
            required
          />
          {error && <div style={{ color: "#c00", fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  if (user === undefined) return <div className="loading">Loading...</div>;
  if (!user) return <Login />;

  return (
    <div className="app">
      <nav className="sidebar">
        <img src="/ROA_Off-Road_MTNS_LOGO_White.png" alt="ROA OFF-ROAD" className="sidebar-logo" />
        <div className="subtitle">Podium Intelligence</div>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button className="nav-btn" style={{ marginTop: "auto", opacity: 0.6 }} onClick={() => { clearCache(); signOut(auth); }}>
          Sign Out
        </button>
      </nav>
      <main className="main">
        {tab === "overview" && <Overview />}
        {tab === "conversations" && <Conversations />}
        {tab === "followup" && <FollowUp />}
        {tab === "workload" && <CoachWorkload />}
        {tab === "campaigns" && <CampaignAnalysis />}
        {tab === "contacts" && <ContactSearch />}
        {tab === "users" && <Users />}
      </main>
    </div>
  );
}
