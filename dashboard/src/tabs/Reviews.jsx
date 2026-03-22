import { useState, useEffect } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function stars(rating) {
  return "★".repeat(rating || 0) + "☆".repeat(5 - (rating || 0));
}

function ReviewCard({ review }) {
  const [expanded, setExpanded] = useState(false);
  const body = review.body || "";
  const truncated = body.length > 140 && !expanded;

  return (
    <div className="review-card">
      <div className="review-card-header">
        <strong>{review.contactName || "Anonymous"}</strong>
        <span className="review-source">{review.source || "—"}</span>
      </div>
      <div className="review-rating" style={{ color: review.rating >= 4 ? "#2a7" : review.rating >= 3 ? "#c80" : "#c00" }}>
        {stars(review.rating)}
      </div>
      {body && (
        <div className="review-body">
          {truncated ? body.slice(0, 140) + "..." : body}
          {body.length > 140 && (
            <button className="review-toggle" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}
      <div className="review-date">{fmtDate(review.createdAt)}</div>
    </div>
  );
}

export default function Reviews() {
  const [recent, setRecent] = useState([]);
  const [needsResponse, setNeedsResponse] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Fetch 10 most recent reviews
      const recentSnap = await getDocs(
        query(collection(db, "podium_reviews"), orderBy("createdAt", "desc"), limit(10))
      );
      setRecent(recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Fetch recent reviews needing response
      // needsResponse field is set by webhook; for older reviews without it, fetch extra and filter
      const needsSnap = await getDocs(
        query(
          collection(db, "podium_reviews"),
          where("needsResponse", "==", true),
          orderBy("createdAt", "desc"),
          limit(10)
        )
      );
      let needs = needsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // If we got fewer than 10, also check reviews missing the needsResponse field
      // (older reviews ingested before the field was added)
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

  return (
    <>
      <h2>Reviews</h2>
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="label">Most Recent</div>
          <div className="stat-value">{recent.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Needs Response</div>
          <div className="stat-value">{needsResponse.length}</div>
        </div>
        {recent.length > 0 && (
          <div className="stat-card">
            <div className="label">Avg Rating</div>
            <div className="stat-value">
              {(recent.reduce((s, r) => s + (r.rating || 0), 0) / recent.filter((r) => r.rating).length).toFixed(1)}
            </div>
          </div>
        )}
      </div>

      <div className="reviews-columns">
        <div className="reviews-column">
          <h3 style={{ fontFamily: "Rajdhani", fontSize: 16, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Most Recent Reviews
          </h3>
          {recent.length === 0 && <div className="loading">No reviews found.</div>}
          {recent.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>

        <div className="reviews-column">
          <h3 style={{ fontFamily: "Rajdhani", fontSize: 16, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Awaiting Response
          </h3>
          {needsResponse.length === 0 && <div className="loading">All reviews have been responded to.</div>}
          {needsResponse.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      </div>
    </>
  );
}
