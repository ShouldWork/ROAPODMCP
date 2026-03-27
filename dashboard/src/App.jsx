import { useState, useEffect, lazy, Suspense } from "react";
import { HashRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase";
import { clearCache } from "./cache";
import {
  LayoutDashboard,
  MessageSquare,
  Bell,
  BarChart3,
  Megaphone,
  Search,
  Star,
  Users as UsersIcon,
  LogOut,
} from "lucide-react";

const Overview = lazy(() => import("./tabs/Overview"));
const Conversations = lazy(() => import("./tabs/Conversations"));
const FollowUp = lazy(() => import("./tabs/FollowUp"));
const CoachWorkload = lazy(() => import("./tabs/CoachWorkload"));
const CampaignAnalysis = lazy(() => import("./tabs/CampaignAnalysis"));
const ContactSearch = lazy(() => import("./tabs/ContactSearch"));
const UsersTab = lazy(() => import("./tabs/Users"));
const Reviews = lazy(() => import("./tabs/Reviews"));

const TabLoader = () => <div className="loading">Loading...</div>;

const TABS = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/conversations", label: "Conversations", icon: MessageSquare },
  { path: "/follow-up", label: "Follow-Up Priority", icon: Bell },
  { path: "/workload", label: "Coach Workload", icon: BarChart3 },
  { path: "/campaigns", label: "Campaign Analysis", icon: Megaphone },
  { path: "/contacts", label: "Contact Search", icon: Search },
  { path: "/reviews", label: "Reviews", icon: Star },
  { path: "/users", label: "Users", icon: UsersIcon },
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
          <div className="form-field">
            <label htmlFor="login-email" className="sr-only">Email address</label>
            <input
              id="login-email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="search-input"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="login-password" className="sr-only">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="search-input"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AppShell() {
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main navigation">
        <img src="/ROA_Off-Road_MTNS_LOGO_White.png" alt="ROA OFF-ROAD" className="sidebar-logo" />
        <div className="subtitle">Podium Intelligence</div>
        {TABS.map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
            end={t.path === "/"}
            className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
          >
            <t.icon size={18} aria-hidden="true" />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <button
          className="nav-btn sign-out-btn"
          onClick={() => { clearCache(); signOut(auth); }}
          aria-label="Sign out"
        >
          <LogOut size={18} aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </nav>
      <main className="main">
        <Suspense fallback={<TabLoader />}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/follow-up" element={<FollowUp />} />
            <Route path="/workload" element={<CoachWorkload />} />
            <Route path="/campaigns" element={<CampaignAnalysis />} />
            <Route path="/contacts" element={<ContactSearch />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/users" element={<UsersTab />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  if (user === undefined) return <div className="loading">Loading...</div>;
  if (!user) return <Login />;

  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
