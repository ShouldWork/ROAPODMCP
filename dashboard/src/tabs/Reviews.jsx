import { useState, useEffect } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RatingBar({ label, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rv-dist-row">
      <span className="rv-dist-label">{label}</span>
      <div className="rv-dist-track">
        <div className="rv-dist-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="rv-dist-pct">{pct}%</span>
    </div>
  );
}

function ReviewRow({ review }) {
  const ratingColor = review.rating >= 4 ? "#7c5ce0" : review.rating >= 3 ? "#e0a030" : "#e05c5c";
  return (
    <tr>
      <td><strong>{review.contactName || "Anonymous"}</strong></td>
      <td>
        <span className="rv-rating-pill" style={{ background: ratingColor + "18", color: ratingColor }}>
          {"★".repeat(review.rating || 0)} {review.rating || 0}
        </span>
      </td>
      <td><span className="rv-source-pill">{review.source || "—"}</span></td>
      <td className="rv-date-cell">{fmtDate(review.createdAt)}</td>
    </tr>
  );
}

function ResponseCard({ review }) {
  const [expanded, setExpanded] = useState(false);
  const body = review.body || "";
  const truncated = body.length > 120 && !expanded;
  const ratingColor = review.rating >= 4 ? "#7c5ce0" : review.rating >= 3 ? "#e0a030" : "#e05c5c";

  return (
    <div className="rv-resp-card">
      <div className="rv-resp-header">
        <div className="rv-resp-avatar">
          {(review.contactName || "A").charAt(0).toUpperCase()}
        </div>
        <div className="rv-resp-info">
          <strong>{review.contactName || "Anonymous"}</strong>
          <span className="rv-resp-date">{fmtDate(review.createdAt)}</span>
        </div>
        <span className="rv-rating-pill" style={{ background: ratingColor + "18", color: ratingColor }}>
          {"★".repeat(review.rating || 0)}
        </span>
      </div>
      {body && (
        <div className="rv-resp-body">
          {truncated ? body.slice(0, 120) + "..." : body}
          {body.length > 120 && (
            <button className="rv-read-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>
      )}
      <div className="rv-resp-footer">
        <span className="rv-source-pill">{review.source || "—"}</span>
        <span className="rv-needs-badge">Needs Reply</span>
      </div>
    </div>
  );
}

export default function Reviews() {
  const [recent, setRecent] = useState([]);
  const [needsResponse, setNeedsResponse] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const recentSnap = await getDocs(
        query(collection(db, "podium_reviews"), orderBy("createdAt", "desc"), limit(10))
      );
      setRecent(recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const needsSnap = await getDocs(
        query(
          collection(db, "podium_reviews"),
          where("needsResponse", "==", true),
          orderBy("createdAt", "desc"),
          limit(10)
        )
      );
      let needs = needsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (needs.length < 10) {
        const allSnap = await getDocs(
          query(collection(db, "podium_reviews"), orderBy("createdAt", "desc"), limit(50))
        );
        const allReviews = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const needsIds = new Set(needs.map((r) => r.id));
        const extras = allReviews.filter(
          (r) => !needsIds.has(r.id) && r.needsResponse === undefined
        );
        needs = [...needs, ...extras].sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        }).slice(0, 10);
      }

      setNeedsResponse(needs);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="rv-wrap">
        <div className="loading">Loading reviews...</div>
      </div>
    );
  }

  // Compute stats
  const rated = recent.filter((r) => r.rating);
  const avgRating = rated.length > 0
    ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)
    : "—";

  // Rating distribution from recent reviews
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: recent.filter((r) => r.rating === star).length,
  }));

  return (
    <div className="rv-wrap">
      {/* ── Hero Header ─────────────────────────────────────── */}
      <div className="rv-hero">
        <div className="rv-hero-left">
          <h2 className="rv-title">Customer Reviews</h2>
          <p className="rv-subtitle">Monitor feedback and manage responses across all platforms.</p>
        </div>
        <div className="rv-hero-stats">
          <div className="rv-score">
            <span className="rv-score-value">{avgRating}</span>
            <span className="rv-score-max">/5</span>
            <span className="rv-score-label">Avg Rating</span>
          </div>
          <div className="rv-score">
            <span className="rv-score-value">{recent.length}</span>
            <span className="rv-score-max"></span>
            <span className="rv-score-label">Recent</span>
          </div>
          <div className="rv-score">
            <span className="rv-score-value">{needsResponse.length}</span>
            <span className="rv-score-max"></span>
            <span className="rv-score-label">Needs Reply</span>
          </div>
        </div>
      </div>

      {/* ── Main Grid ───────────────────────────────────────── */}
      <div className="rv-grid">
        {/* Left column: Rating Distribution + Recent Table */}
        <div className="rv-left">
          {/* Rating Distribution */}
          <div className="rv-glass-card rv-dist-card">
            <h3 className="rv-card-title">Rating Distribution</h3>
            {dist.map((d) => (
              <RatingBar key={d.star} label={`${d.star} Star`} count={d.count} total={recent.length} />
            ))}
          </div>

          {/* Recent Reviews Table */}
          <div className="rv-glass-card rv-table-card">
            <h3 className="rv-card-title">Most Recent Reviews</h3>
            {recent.length === 0 ? (
              <div className="loading">No reviews found.</div>
            ) : (
              <div className="table-wrap">
                <table className="rv-table">
                  <thead>
                    <tr>
                      <th>Author</th>
                      <th>Rating</th>
                      <th>Source</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <ReviewRow key={r.id} review={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Awaiting Response */}
        <div className="rv-right">
          <div className="rv-glass-card rv-response-card">
            <div className="rv-card-title-row">
              <h3 className="rv-card-title">Awaiting Response</h3>
              <span className="rv-count-badge">{needsResponse.length}</span>
            </div>
            {needsResponse.length === 0 ? (
              <div className="loading">All reviews have been responded to.</div>
            ) : (
              <div className="rv-resp-list">
                {needsResponse.map((r) => (
                  <ResponseCard key={r.id} review={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
