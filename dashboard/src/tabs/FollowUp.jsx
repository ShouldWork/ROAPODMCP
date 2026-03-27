import { useState, useEffect } from "react";
import { collection, query, orderBy, where, getDocs, limit } from "firebase/firestore";
import { db } from "../firebase";

function hoursAgo(ts) {
  if (!ts) return Infinity;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return (Date.now() - d.getTime()) / 3600000;
}

function fmtWait(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function FollowUp() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      userSnap.forEach((d) => { userMap[d.id] = d.data(); });
      setUsers(userMap);

      const convSnap = await getDocs(
        query(collection(db, "podium_conversations"), where("status", "==", "open"), orderBy("lastItemAt", "desc"), limit(200))
      );
      const convos = convSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Check last message direction in parallel batches of 20
      const needsFollowUp = [];
      const BATCH_SIZE = 20;
      for (let i = 0; i < convos.length; i += BATCH_SIZE) {
        const batch = convos.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (conv) => {
            const msgSnap = await getDocs(
              query(collection(db, "podium_messages"), where("conversationUid", "==", conv.uid), orderBy("createdAt", "desc"), limit(1))
            );
            if (msgSnap.empty) return null;
            const lastMsg = msgSnap.docs[0].data();
            if (lastMsg.direction === "inbound") {
              return { ...conv, lastInboundAt: lastMsg.createdAt, waitHours: hoursAgo(lastMsg.createdAt) };
            }
            return null;
          })
        );
        needsFollowUp.push(...results.filter(Boolean));
      }

      needsFollowUp.sort((a, b) => b.waitHours - a.waitHours);
      setItems(needsFollowUp);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="loading">Analyzing follow-up priorities...</div>;

  const grouped = {};
  for (const item of items) {
    const coachUid = item.assignedUserUid || "unassigned";
    const coachName = users[coachUid]?.name || "Unassigned";
    if (!grouped[coachName]) grouped[coachName] = [];
    grouped[coachName].push(item);
  }

  return (
    <>
      <h2>Follow-Up Priority</h2>
      <p style={{ marginBottom: 20, color: "var(--gray)" }}>
        Open conversations where the last message was inbound and no Sales Coach has responded yet.
        Sorted by longest wait first.
      </p>

      {items.length === 0 && <div className="loading">No conversations awaiting follow-up.</div>}

      {Object.entries(grouped).map(([coach, convos]) => (
        <div key={coach} style={{ marginBottom: 32 }}>
          <h3 style={{ fontFamily: "Rajdhani", fontSize: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            {coach} ({convos.length})
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Roamer</th><th>Phone</th><th>Waiting</th><th>Channel</th></tr>
              </thead>
              <tbody>
                {convos.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.contactName || "Unknown"}</strong></td>
                    <td>{c.phone || "—"}</td>
                    <td style={{ color: c.waitHours > 24 ? "var(--danger)" : c.waitHours > 4 ? "var(--accent)" : "var(--dark)", fontWeight: 600 }}>
                      {fmtWait(c.waitHours)}
                    </td>
                    <td>{c.channelType || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
