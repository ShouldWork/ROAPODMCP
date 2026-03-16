import { useState } from "react";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ContactSearch() {
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function doSearch() {
    if (!search.trim()) return;
    setLoading(true);
    setSearched(true);

    // Search conversations by contactName (Firestore doesn't support LIKE, so we fetch and filter)
    const convSnap = await getDocs(
      query(collection(db, "podium_conversations"), orderBy("lastItemAt", "desc"), limit(500))
    );

    const kw = search.toLowerCase();
    const matches = [];
    const seen = new Set();

    convSnap.forEach((d) => {
      const c = d.data();
      const name = (c.contactName || "").toLowerCase();
      const phone = (c.phone || "");
      if (name.includes(kw) || phone.includes(search)) {
        const key = c.contactName + c.phone;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ ...c, docId: d.id });
        }
      }
    });

    // Also search podium_contacts collection
    const contactSnap = await getDocs(
      query(collection(db, "podium_contacts"), limit(500))
    );
    contactSnap.forEach((d) => {
      const c = d.data();
      const name = (c.name || "").toLowerCase();
      const phone = (c.phone || "");
      const email = (c.email || "").toLowerCase();
      if (name.includes(kw) || phone.includes(search) || email.includes(kw)) {
        const key = c.name + c.phone;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ contactName: c.name, phone: c.phone, email: c.email, uid: c.uid, source: "contacts" });
        }
      }
    });

    setContacts(matches);
    setLoading(false);
  }

  return (
    <>
      <h2>Contact Search</h2>
      <p style={{ marginBottom: 20, color: "#787878" }}>
        Search for Roamers and Future Roamers by name, phone number, or email.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          className="search-input"
          placeholder="Name, phone, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          style={{ marginBottom: 0 }}
        />
        <button className="btn" onClick={doSearch} disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {searched && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Status</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i}>
                  <td><strong>{c.contactName || c.name || "Unknown"}</strong></td>
                  <td>{c.phone || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td>{c.status || "—"}</td>
                  <td>{fmtDate(c.lastItemAt)}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "#787878" }}>No results found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
