import { useState, useEffect, useRef } from "react";
import { collection, query, orderBy, limit, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getCached, setCached } from "../cache";

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
  const threadEndRef = useRef(null);

  useEffect(() => {
    async function load() {
      // Cache users for 10 minutes (rarely changes)
      let userMap = getCached("podium-users");
      if (!userMap) {
        const userSnap = await getDocs(collection(db, "podium_users"));
        userMap = {};
        userSnap.forEach((d) => { userMap[d.id] = d.data().name; });
        setCached("podium-users", userMap, 10);
      }
      setUsers(userMap);

      const constraints = [orderBy("lastItemAt", "desc"), limit(100)];
      if (filter === "open") constraints.unshift(where("status", "==", "open"));
      else if (filter === "closed") constraints.unshift(where("status", "==", "closed"));
      else if (filter === "unassigned") {
        constraints.unshift(where("status", "==", "open"));
        constraints.unshift(where("assignedUserUid", "==", null));
      }

      const snap = await getDocs(query(collection(db, "podium_conversations"), ...constraints));
      setConvos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }
    setLoading(true);
    setSelected(null);
    setMessages([]);
    load();
  }, [filter]);

  async function loadThread(conv) {
    setSelected(conv);
    setMsgLoading(true);
    const convUid = conv.uid || conv.id;
    const snap = await getDocs(
      query(collection(db, "podium_messages"), where("conversationUid", "==", convUid), orderBy("createdAt", "asc"), limit(200))
    );
    setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setMsgLoading(false);
  }

  useEffect(() => {
    if (!msgLoading && messages.length > 0 && threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [msgLoading]);

  const filtered = search
    ? convos.filter((c) =>
        (c.contactName || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.phone || "").includes(search)
      )
    : convos;

  return (
    <div className="conv-page">
      {/* Fixed header */}
      <div className="conv-header">
        <h2 style={{ marginBottom: 12 }}>Conversations</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="filters" style={{ marginBottom: 0 }}>
            {["all", "open", "closed", "unassigned"].map((f) => (
              <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <input className="search-input" style={{ marginBottom: 0 }} placeholder="Search by Roamer name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Two-column body fills remaining height */}
      <div className="conv-columns">
        {/* Left column — Conversation list */}
        <div className="conv-list">
          {loading ? <div className="loading">Loading conversations...</div> : (
            <table>
              <thead>
                <tr>
                  <th>Roamer</th>
                  <th>Status</th>
                  <th>Coach</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => loadThread(c)} style={{ background: selected?.id === c.id ? "#e8e8e8" : undefined }}>
                    <td>
                      <strong>{c.contactName || "Unknown"}</strong>
                      <div style={{ fontSize: 11, color: "#8B7355" }}>{c.phone || ""}</div>
                    </td>
                    <td><span className={`status-badge ${c.status}`}>{c.status || "—"}</span></td>
                    <td style={{ fontSize: 13 }}>{users[c.assignedUserUid] || "Unassigned"}</td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(c.lastItemAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column — Message thread */}
        <div className="conv-thread">
          {!selected ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#8B7355", fontSize: 15 }}>
              No conversation selected
            </div>
          ) : (
            <>
              <div className="conv-thread-header">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <strong style={{ fontSize: 16 }}>{selected.contactName || "Unknown"}</strong>
                  <span className={`status-badge ${selected.status}`}>{selected.status}</span>
                </div>
                <div className="conv-thread-meta">
                  <span>{selected.phone || "—"}</span>
                  <span>{selected.channelType || "—"}</span>
                  <span>{users[selected.assignedUserUid] || "Unassigned"}</span>
                  <span>{messages.length} messages</span>
                </div>
              </div>
              <div className="conv-thread-messages">
                {msgLoading ? <div className="loading">Loading thread...</div> : (
                  <>
                    {messages.map((m) => (
                      <div key={m.id} className={`msg ${m.direction || "inbound"}`}>
                        <div>{m.body || "(no text)"}</div>
                        <div className="meta">{fmtDate(m.createdAt)} {m.senderUid ? `· ${users[m.senderUid] || "Agent"}` : ""}</div>
                      </div>
                    ))}
                    {messages.length === 0 && !msgLoading && (
                      <div style={{ textAlign: "center", color: "#8B7355", padding: 20 }}>No messages found. Messages may not be backfilled yet.</div>
                    )}
                    <div ref={threadEndRef} />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
