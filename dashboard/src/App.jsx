import { useState } from "react";
import Overview from "./tabs/Overview";
import Conversations from "./tabs/Conversations";
import FollowUp from "./tabs/FollowUp";
import CoachWorkload from "./tabs/CoachWorkload";
import CampaignAnalysis from "./tabs/CampaignAnalysis";
import ContactSearch from "./tabs/ContactSearch";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "conversations", label: "Conversations" },
  { key: "followup", label: "Follow-Up Priority" },
  { key: "workload", label: "Coach Workload" },
  { key: "campaigns", label: "Campaign Analysis" },
  { key: "contacts", label: "Contact Search" },
];

export default function App() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>ROA OFF-ROAD</h1>
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
      </nav>
      <main className="main">
        {tab === "overview" && <Overview />}
        {tab === "conversations" && <Conversations />}
        {tab === "followup" && <FollowUp />}
        {tab === "workload" && <CoachWorkload />}
        {tab === "campaigns" && <CampaignAnalysis />}
        {tab === "contacts" && <ContactSearch />}
      </main>
    </div>
  );
}
