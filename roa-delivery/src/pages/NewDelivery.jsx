import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { CHECKLIST_TEMPLATE } from "../checklist";

export default function NewDelivery({ onCreated }) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    unitYear: "",
    unitMake: "",
    unitModel: "",
    stockNumber: "",
    assignedTo: "",
    scheduledDate: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);

    const docRef = await addDoc(collection(db, "deliveries"), {
      ...form,
      scheduledDate: form.scheduledDate ? new Date(form.scheduledDate) : null,
      status: "pending",
      checklist: CHECKLIST_TEMPLATE.map((item) => ({ ...item })),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    onCreated(docRef.id);
  }

  return (
    <div className="dl-page">
      <h1 className="dl-title">New Delivery</h1>
      <p className="dl-subtitle">Create a delivery checklist for a new unit handoff.</p>

      <form className="dl-form" onSubmit={handleSubmit}>
        <div className="dl-glass-card">
          <h3 className="dl-card-title">Unit Information</h3>
          <div className="dl-form-grid">
            <div className="dl-field">
              <label>Year</label>
              <input className="dl-input" value={form.unitYear} onChange={(e) => update("unitYear", e.target.value)} placeholder="2025" required />
            </div>
            <div className="dl-field">
              <label>Make</label>
              <input className="dl-input" value={form.unitMake} onChange={(e) => update("unitMake", e.target.value)} placeholder="Grand Design" required />
            </div>
            <div className="dl-field">
              <label>Model</label>
              <input className="dl-input" value={form.unitModel} onChange={(e) => update("unitModel", e.target.value)} placeholder="Imagine 2800BH" required />
            </div>
            <div className="dl-field">
              <label>Stock #</label>
              <input className="dl-input" value={form.stockNumber} onChange={(e) => update("stockNumber", e.target.value)} placeholder="ROA-1234" />
            </div>
          </div>
        </div>

        <div className="dl-glass-card">
          <h3 className="dl-card-title">Customer Information</h3>
          <div className="dl-form-grid">
            <div className="dl-field">
              <label>Name</label>
              <input className="dl-input" value={form.customerName} onChange={(e) => update("customerName", e.target.value)} placeholder="John Smith" required />
            </div>
            <div className="dl-field">
              <label>Phone</label>
              <input className="dl-input" value={form.customerPhone} onChange={(e) => update("customerPhone", e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div className="dl-field">
              <label>Email</label>
              <input className="dl-input" type="email" value={form.customerEmail} onChange={(e) => update("customerEmail", e.target.value)} placeholder="john@example.com" />
            </div>
          </div>
        </div>

        <div className="dl-glass-card">
          <h3 className="dl-card-title">Scheduling</h3>
          <div className="dl-form-grid">
            <div className="dl-field">
              <label>Assigned To</label>
              <input className="dl-input" value={form.assignedTo} onChange={(e) => update("assignedTo", e.target.value)} placeholder="Team member name" />
            </div>
            <div className="dl-field">
              <label>Scheduled Date</label>
              <input className="dl-input" type="date" value={form.scheduledDate} onChange={(e) => update("scheduledDate", e.target.value)} />
            </div>
          </div>
          <div className="dl-field" style={{ marginTop: 12 }}>
            <label>Notes</label>
            <textarea className="dl-input dl-textarea" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Special instructions, customer requests..." />
          </div>
        </div>

        <button className="dl-btn dl-btn-primary dl-submit-btn" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create Delivery"}
        </button>
      </form>
    </div>
  );
}
