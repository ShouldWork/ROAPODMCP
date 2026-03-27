import { useState } from "react";
import { collection, query, where, getDocs, orderBy, limit, startAfter } from "firebase/firestore";
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

    const kw = keyword.toLowerCase();
    const matches = [];
    const conversationUids = new Set();
    let lastDoc = null;
    let scanned = 0;
    const BATCH = 1000;
    const MAX = 3000;

    // Paginated scan of outbound messages (1000 per batch, max 3000)
    while (scanned < MAX) {
      const constraints = [
        where("direction", "==", "outbound"),
        orderBy("createdAt", "desc"),
        limit(BATCH),
      ];
      if (lastDoc) constraints.push(startAfter(lastDoc));

      const snap = await getDocs(query(collection(db, "podium_messages"), ...constraints));
      if (snap.empty) break;

      snap.forEach((d) => {
        const msg = d.data();
        if (msg.body && msg.body.toLowerCase().includes(kw)) {
          matches.push(msg);
          if (msg.conversationUid) conversationUids.add(msg.conversationUid);
        }
      });

      scanned += snap.size;
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < BATCH) break;
    }

    // Check replies in parallel (sample up to 30 conversations)
    let replyCount = 0;
    if (conversationUids.size > 0) {
      const uids = Array.from(conversationUids).slice(0, 30);
      const replies = await Promise.all(
        uids.map((uid) =>
          getDocs(query(collection(db, "podium_messages"), where("conversationUid", "==", uid), where("direction", "==", "inbound"), limit(1)))
            .then((snap) => !snap.empty)
        )
      );
      replyCount = replies.filter(Boolean).length;
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
      scanned,
    });
    setLoading(false);
  }

  return (
    <>
      <h2>Campaign Analysis</h2>
      <p style={{ marginBottom: 20, color: "var(--gray)" }}>
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
          <div className="detail-row"><span className="detail-label">Reply Rate</span><span className="detail-value">{results.replyRate}% (sampled from {Math.min(results.conversationsReached, 30)} conversations)</span></div>
          <div className="detail-row"><span className="detail-label">Date Range</span><span className="detail-value">{results.dateRange}</span></div>
          <div className="detail-row"><span className="detail-label">Messages Scanned</span><span className="detail-value">{results.scanned.toLocaleString()}</span></div>
        </div>
      )}
    </>
  );
}
