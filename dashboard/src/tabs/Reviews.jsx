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
    <div className="rating-bar">
      <span className="rating-bar-label">{label}</span>
      <div className="rating-bar-track">
        <div className="rating-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="rating-bar-pct">{pct}%</span>
    </div>
  );
}

function ratingStyles(rating) {
  if (rating >= 4) return { bg: "var(--accent-soft)", color: "var(--accent)" };
  if (rating >= 3) return { bg: "rgba(184, 120, 0, 0.1)", color: "#b87800" };
  return { bg: "var(--danger-soft)", color: "var(--danger)" };
}

function ReviewRow({ review }) {
  const rs = ratingStyles(review.rating);
  return (
    <tr>
      <td><strong>{review.contactName || "Anonymous"}</strong></td>
      <td>
        <span className="rating-pill" style={{ background: rs.bg, color: rs.color }}>
          {"★".repeat(review.rating || 0)} {review.rating || 0}
        </span>
      </td>
      <td><span className="source-pill">{review.source || "—"}</span></td>
      <td style={{ fontSize: 12, color: "var(--gray)" }}>{fmtDate(review.createdAt)}</td>
    </tr>
  );
}

function ResponseCard({ review }) {
  const [expanded, setExpanded] = useState(false);
  const body = review.body || "";
  const truncated = body.length > 120 && !expanded;
  const rs = ratingStyles(review.rating);

  return (
    <div className="response-card">
      <div className="response-header">
        <div className="response-avatar">
          {(review.contactName || "A").charAt(0).toUpperCase()}
        </div>
        <div className="response-info">
          <strong>{review.contactName || "Anonymous"}</strong>
          <span className="response-date">{fmtDate(review.createdAt)}</span>
        </div>
        <span className="rating-pill" style={{ background: rs.bg, color: rs.color }}>
          {"★".repeat(review.rating || 0)}
        </span>
      </div>
      {body && (
        <div className="response-body">
          {truncated ? body.slice(0, 120) + "..." : body}
          {body.length > 120 && (
            <button className="read-more-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>
      )}
      <div className="response-footer">
        <span className="source-pill">{review.source || "—"}</span>
        <span className="needs-badge">Needs Reply</span>
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

  if (loading) return <div className="loading">Loading reviews...</div>;

  const rated = recent.filter((r) => r.rating);
  const avgRating = rated.length > 0
    ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1)
    : "—";

  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: recent.filter((r) => r.rating === star).length,
  }));

  return (
    <>
      <h2>Customer Reviews</h2>
      <p style={{ marginBottom: 24, color: "var(--gray)" }}>
        Monitor feedback and manage responses across all platforms.
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Avg Rating</div>
          <div className="stat-value">{avgRating}<span style={{ fontSize: 18, color: "var(--light-gray)" }}>/5</span></div>
        </div>
        <div className="stat-card">
          <div className="label">Recent Reviews</div>
          <div className="stat-value">{recent.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Needs Reply</div>
          <div className="stat-value">{needsResponse.length}</div>
        </div>
      </div>

      <div className="reviews-grid">
        <div className="reviews-left">
          <div className="chart-card">
            <h3>Rating Distribution</h3>
            {dist.map((d) => (
              <RatingBar key={d.star} label={`${d.star} Star`} count={d.count} total={recent.length} />
            ))}
          </div>

          <div className="chart-card">
            <h3>Most Recent Reviews</h3>
            {recent.length === 0 ? (
              <div className="loading">No reviews found.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Author</th>
                      <th>Rating</th>
                      <th>Source</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => <ReviewRow key={r.id} review={r} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="reviews-right">
          <div className="chart-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ marginBottom: 0 }}>Awaiting Response</h3>
              <span className="count-badge">{needsResponse.length}</span>
            </div>
            {needsResponse.length === 0 ? (
              <div className="loading">All reviews have been responded to.</div>
            ) : (
              <div className="response-list">
                {needsResponse.map((r) => <ResponseCard key={r.id} review={r} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
