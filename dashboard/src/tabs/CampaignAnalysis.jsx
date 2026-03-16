import { useState } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CampaignAnalysis() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!keyword.trim()) return;
    setLoading(true);

    // Get outbound messages and search for keyword in body
    // Note: Firestore doesn't support full-text search, so we fetch recent outbound
    // and filter client-side. For production, consider Algolia or a Cloud Function.
    const msgSnap = await getDocs(
      query(collection(db, "podium_messages"), where("direction", "==", "outbound"), orderBy("createdAt", "desc"), limit(5000))
    );

    const kw = keyword.toLowerCase();
    const matches = [];
    const conversationUids = new Set();

    msgSnap.forEach((d) => {
      const msg = d.data();
      if (msg.body && msg.body.toLowerCase().includes(kw)) {
        matches.push(msg);
        if (msg.conversationUid) conversationUids.add(msg.conversationUid);
      }
    });

    // Find replies: inbound messages in the same conversations after the broadcast
    let replyCount = 0;
    if (conversationUids.size > 0 && conversationUids.size <= 30) {
      // Check a sample of conversations for replies
      const uids = Array.from(conversationUids).slice(0, 30);
      for (const uid of uids) {
        const replySnap = await getDocs(
          query(collection(db, "podium_messages"), where("conversationUid", "==", uid), where("direction", "==", "inbound"), limit(1))
        );
        if (!replySnap.empty) replyCount++;
      }
    }

    const dates = matches
      .map((m) => m.createdAt?.toDate?.()?.getTime() || m.createdAt?.seconds * 1000 || 0)
      .filter((d) => d > 0);

    setResults({
      keyword: keyword.trim(),
      totalMatches: matches.length,
      conversationsReached: conversationUids.size,
      replyCount,
      replyRate: conversationUids.size > 0 ? Math.round((replyCount / Math.min(conversationUids.size, 30)) * 100) : 0,
      dateRange: dates.length > 0
        ? `${fmtDate(new Date(Math.min(...dates)))} — ${fmtDate(new Date(Math.max(...dates)))}`
        : "—",
    });
    setLoading(false);
  }

  return (
    <>
      <h2>Campaign Analysis</h2>
      <p style={{ marginBottom: 20, color: "#787878" }}>
        Search outbound message bodies for campaign keywords (e.g., "Roamer Rally", "new model", "holiday sale").
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          className="search-input"
          placeholder="Enter campaign keyword..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          style={{ marginBottom: 0 }}
        />
        <button className="btn" onClick={search} disabled={loading}>
          {loading ? "Searching..." : "Analyze"}
        </button>
      </div>

      {results && (
        <div className="detail-panel">
          <div className="detail-row"><span className="detail-label">Keyword</span><span className="detail-value">"{results.keyword}"</span></div>
          <div className="detail-row"><span className="detail-label">Messages Found</span><span className="detail-value">{results.totalMatches}</span></div>
          <div className="detail-row"><span className="detail-label">Conversations Reached</span><span className="detail-value">{results.conversationsReached}</span></div>
          <div className="detail-row"><span className="detail-label">Reply Rate</span><span className="detail-value">{results.replyRate}% (sampled)</span></div>
          <div className="detail-row"><span className="detail-label">Date Range</span><span className="detail-value">{results.dateRange}</span></div>
        </div>
      )}
    </>
  );
}
