import { useState, useEffect } from "react";
import { collection, query, orderBy, where, getDocs, limit, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export default function CoachWorkload() {
  const [workload, setWorkload] = useState([]);
  const [weeklyMessages, setWeeklyMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Load users
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      userSnap.forEach((d) => { userMap[d.id] = d.data(); });

      // All open conversations
      const convSnap = await getDocs(
        query(collection(db, "podium_conversations"), where("status", "==", "open"))
      );
      const convos = convSnap.docs.map((d) => d.data());

      const now = Date.now();
      const d7 = now - 7 * 86400000;
      const d30 = now - 30 * 86400000;

      // Build workload per coach
      const coachData = {};
      for (const c of convos) {
        const uid = c.assignedUserUid || "unassigned";
        if (!coachData[uid]) coachData[uid] = { open: 0, active7d: 0, stale7d: 0, stale30d: 0 };
        coachData[uid].open++;
        const lastMs = c.lastItemAt?.toDate?.()?.getTime() || c.lastItemAt?.seconds * 1000 || 0;
        if (lastMs > d7) coachData[uid].active7d++;
        else if (lastMs > d30) coachData[uid].stale7d++;
        else coachData[uid].stale30d++;
      }

      const wl = Object.entries(coachData).map(([uid, data]) => ({
        name: userMap[uid]?.name || (uid === "unassigned" ? "Unassigned" : uid.substring(0, 8)),
        ...data,
      })).sort((a, b) => b.open - a.open);
      setWorkload(wl);

      // Weekly outbound messages per coach (last 4 weeks)
      const fourWeeksAgo = Timestamp.fromDate(new Date(now - 28 * 86400000));
      const msgSnap = await getDocs(
        query(collection(db, "podium_messages"), where("direction", "==", "outbound"), where("createdAt", ">=", fourWeeksAgo), orderBy("createdAt", "desc"), limit(2000))
      );

      const weeklyMap = {};
      msgSnap.forEach((d) => {
        const msg = d.data();
        if (!msg.senderUid) return; // skip automated
        const coachName = userMap[msg.senderUid]?.name || msg.senderUid?.substring(0, 8) || "Unknown";
        weeklyMap[coachName] = (weeklyMap[coachName] || 0) + 1;
      });

      const wm = Object.entries(weeklyMap)
        .map(([name, count]) => ({ name, messages: count }))
        .sort((a, b) => b.messages - a.messages);
      setWeeklyMessages(wm);

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="loading">Analyzing Sales Coach workload...</div>;

  return (
    <>
      <h2>Sales Coach Workload</h2>
      <div className="table-wrap" style={{ marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Sales Coach</th>
              <th>Open</th>
              <th>Active (7d)</th>
              <th>Stale (7-30d)</th>
              <th>Stale (30d+)</th>
            </tr>
          </thead>
          <tbody>
            {workload.map((w) => (
              <tr key={w.name}>
                <td><strong>{w.name}</strong></td>
                <td>{w.open}</td>
                <td>{w.active7d}</td>
                <td style={{ color: w.stale7d > 5 ? "#c80" : undefined }}>{w.stale7d}</td>
                <td style={{ color: w.stale30d > 0 ? "#c00" : undefined }}>{w.stale30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {weeklyMessages.length > 0 && (
        <div className="chart-card" style={{ maxWidth: 700 }}>
          <h3>Outbound Messages (Last 4 Weeks)</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(() => {
              const max = Math.max(...weeklyMessages.map((w) => w.messages));
              return weeklyMessages.map((w) => (
                <div key={w.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ minWidth: 120, fontSize: 13, fontWeight: 600, textAlign: "right", color: "var(--dark)" }}>
                    {w.name}
                  </span>
                  <div style={{ flex: 1, background: "var(--off-white)", borderRadius: 4, height: 24, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.max((w.messages / max) * 100, 2)}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 4,
                    }} />
                  </div>
                  <span style={{ minWidth: 40, fontSize: 14, fontWeight: 700, fontFamily: "Rajdhani, sans-serif", color: "var(--dark)" }}>
                    {w.messages}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </>
  );
}
