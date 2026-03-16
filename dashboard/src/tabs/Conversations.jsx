import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Conversations() {
  const [convos, setConvos] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const userSnap = await getDocs(collection(db, "podium_users"));
      const userMap = {};
      userSnap.forEach((d) => { userMap[d.id] = d.data().name; });
      setUsers(userMap);

      const constraints = [orderBy("lastItemAt", "desc"), limit(100)];
      if (filter === "open") constraints.unshift(where("status", "==", "open"));
      else if (filter === "closed") constraints.unshift(where("status", "==", "closed"));
      else if (filter === "unassigned") {
        constraints.unshift(where("assignedUserUid", "==", null));
      }

      const snap = await getDocs(query(collection(db, "podium_conversations"), ...constraints));
      setConvos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }
    setLoading(true);
    setSelected(null);
    load();
  }, [filter]);

  async function loadThread(conv) {
    setSelected(conv);
    setMsgLoading(true);
    const snap = await getDocs(
      query(collection(db, "podium_messages"), where("conversationUid", "==", conv.uid), orderBy("createdAt", "asc"), limit(200))
    );
    setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setMsgLoading(false);
  }

  const filtered = search
    ? convos.filter((c) =>
        (c.contactName || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.phone || "").includes(search)
      )
    : convos;

  return (
    <>
      <h2>Conversations</h2>
      <div className="filters">
        {["all", "open", "closed", "unassigned"].map((f) => (
          <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <input className="search-input" placeholder="Search by Roamer name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {loading ? <div className="loading">Loading conversations...</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roamer</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Sales Coach</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => loadThread(c)} style={{ cursor: "pointer", background: selected?.id === c.id ? "#f0f0f0" : undefined }}>
                  <td><strong>{c.contactName || "Unknown"}</strong></td>
                  <td>{c.phone || "—"}</td>
                  <td>{c.status || "—"}</td>
                  <td>{users[c.assignedUserUid] || "Unassigned"}</td>
                  <td>{fmtDate(c.lastItemAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="detail-panel">
          <div className="detail-row"><span className="detail-label">Roamer</span><span className="detail-value">{selected.contactName}</span></div>
          <div className="detail-row"><span className="detail-label">Phone</span><span className="detail-value">{selected.phone || "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Channel</span><span className="detail-value">{selected.channelType || "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Sales Coach</span><span className="detail-value">{users[selected.assignedUserUid] || "Unassigned"}</span></div>
          <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value">{selected.status}</span></div>
          <div className="detail-row"><span className="detail-label">Created</span><span className="detail-value">{fmtDate(selected.createdAt)}</span></div>
          <div className="detail-row"><span className="detail-label">Last Activity</span><span className="detail-value">{fmtDate(selected.lastItemAt)}</span></div>
          <div className="detail-row"><span className="detail-label">Messages</span><span className="detail-value">{messages.length}</span></div>

          {msgLoading ? <div className="loading">Loading thread...</div> : (
            <div className="thread">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.direction || "inbound"}`}>
                  <div>{m.body || "(no text)"}</div>
                  <div className="meta">{fmtDate(m.createdAt)} {m.senderUid ? `· ${users[m.senderUid] || "Agent"}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
