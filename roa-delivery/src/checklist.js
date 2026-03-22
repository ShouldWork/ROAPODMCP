// Default checklist template for new deliveries
export const CHECKLIST_TEMPLATE = [
  // Pre-Delivery Inspection
  { category: "Pre-Delivery Inspection", item: "Exterior walk-around" },
  { category: "Pre-Delivery Inspection", item: "Roof inspection" },
  { category: "Pre-Delivery Inspection", item: "Undercarriage check" },
  { category: "Pre-Delivery Inspection", item: "Tire condition & pressure" },
  { category: "Pre-Delivery Inspection", item: "Hitch & tow components" },

  // Interior Prep
  { category: "Interior Prep", item: "Deep clean interior" },
  { category: "Interior Prep", item: "Check all cabinets & drawers" },
  { category: "Interior Prep", item: "Test all locks & latches" },
  { category: "Interior Prep", item: "Verify appliance manuals present" },
  { category: "Interior Prep", item: "Stock welcome kit" },

  // Systems Check
  { category: "Systems Check", item: "Test electrical systems & outlets" },
  { category: "Systems Check", item: "Test plumbing (hot & cold)" },
  { category: "Systems Check", item: "Test LP gas system" },
  { category: "Systems Check", item: "Test HVAC & furnace" },
  { category: "Systems Check", item: "Test water heater" },
  { category: "Systems Check", item: "Test slideouts" },
  { category: "Systems Check", item: "Test leveling jacks" },

  // Exterior Prep
  { category: "Exterior Prep", item: "Wash & detail exterior" },
  { category: "Exterior Prep", item: "Check all exterior lights" },
  { category: "Exterior Prep", item: "Test awning operation" },
  { category: "Exterior Prep", item: "Verify all compartment doors" },
  { category: "Exterior Prep", item: "Check sealants & caulking" },

  // Customer Walkthrough
  { category: "Customer Walkthrough", item: "Electrical system walkthrough" },
  { category: "Customer Walkthrough", item: "Plumbing system walkthrough" },
  { category: "Customer Walkthrough", item: "LP gas safety demonstration" },
  { category: "Customer Walkthrough", item: "Slideout operation demo" },
  { category: "Customer Walkthrough", item: "Leveling system demo" },
  { category: "Customer Walkthrough", item: "Hitch & tow demonstration" },
  { category: "Customer Walkthrough", item: "Awning operation demo" },

  // Final Sign-Off
  { category: "Final Sign-Off", item: "Customer signature obtained" },
  { category: "Final Sign-Off", item: "Delivery photos taken" },
  { category: "Final Sign-Off", item: "All keys & fobs provided" },
  { category: "Final Sign-Off", item: "Registration documents provided" },
  { category: "Final Sign-Off", item: "Warranty documents reviewed" },
].map((item, i) => ({
  id: `item-${i}`,
  ...item,
  completed: false,
  completedBy: null,
  completedAt: null,
}));

export const CATEGORIES = [...new Set(CHECKLIST_TEMPLATE.map((c) => c.category))];

export const STATUS_OPTIONS = [
  { key: "pending", label: "Pending", color: "#8b7fc7" },
  { key: "prep", label: "In Prep", color: "#e0a030" },
  { key: "inspection", label: "Inspection", color: "#5b9bd5" },
  { key: "ready", label: "Ready", color: "#4caf7c" },
  { key: "completed", label: "Completed", color: "#7c5ce0" },
];
