// ── Placeholder data for all dashboard tabs (visual mockup only) ──────

export const MOCK_USERS = {
  "uid-sarah": { name: "Sarah Martinez", email: "sarah@roa-rv.com", role: "admin", dashboardRole: "Sales Coach" },
  "uid-jake": { name: "Jake Wilson", email: "jake@roa-rv.com", role: "admin", dashboardRole: "Sales Coach" },
  "uid-mike": { name: "Mike Torres", email: "mike@roa-rv.com", role: "admin", dashboardRole: "Sales Coach" },
  "uid-lisa": { name: "Lisa Nguyen", email: "lisa@roa-rv.com", role: "user", dashboardRole: "Leader" },
  "uid-brian": { name: "Brian Foster", email: "brian@roa-rv.com", role: "user", dashboardRole: "Team Member" },
  "uid-rachel": { name: "Rachel Kim", email: "rachel@roa-rv.com", role: "user", dashboardRole: "Reception" },
  "uid-tom": { name: "Tom Davis", email: "tom@roa-rv.com", role: "user", dashboardRole: "Support" },
  "uid-anna": { name: "Anna Reed", email: "anna@roa-rv.com", role: "user", dashboardRole: "Marketing" },
  "uid-derek": { name: "Derek Collins", email: "derek@roa-rv.com", role: "owner", dashboardRole: "Owner" },
  "uid-karen": { name: "Karen Hughes", email: "karen@roa-rv.com", role: "user", dashboardRole: "Inactive" },
};

export const MOCK_USER_MAP = Object.fromEntries(
  Object.entries(MOCK_USERS).map(([id, u]) => [id, u.name])
);

// ── Overview stats ──────────────────────────────────────────────────────
export const MOCK_OVERVIEW_STATS = { total: 14832, open: 347, closed: 14485 };

export const MOCK_RECENT_CONVERSATIONS = [
  { id: "c1", contactName: "James Mitchell", channelType: "webchat", assignedUserUid: "uid-sarah", lastItemAt: new Date(Date.now() - 12 * 60000) },
  { id: "c2", contactName: "Robert Chen", channelType: "sms", assignedUserUid: "uid-jake", lastItemAt: new Date(Date.now() - 45 * 60000) },
  { id: "c3", contactName: "Patricia Hernandez", channelType: "sms", assignedUserUid: "uid-mike", lastItemAt: new Date(Date.now() - 2 * 3600000) },
  { id: "c4", contactName: "Emily Watson", channelType: "facebook", assignedUserUid: "uid-sarah", lastItemAt: new Date(Date.now() - 3 * 3600000) },
  { id: "c5", contactName: "David Thompson", channelType: "sms", assignedUserUid: null, lastItemAt: new Date(Date.now() - 5 * 3600000) },
  { id: "c6", contactName: "Amanda Foster", channelType: "webchat", assignedUserUid: "uid-jake", lastItemAt: new Date(Date.now() - 8 * 3600000) },
];

export const MOCK_COACH_LOAD = [
  { uid: "uid-sarah", name: "Sarah Martinez", dashboardRole: "Sales Coach", count: 78 },
  { uid: "uid-jake", name: "Jake Wilson", dashboardRole: "Sales Coach", count: 65 },
  { uid: "uid-mike", name: "Mike Torres", dashboardRole: "Sales Coach", count: 52 },
  { uid: "uid-lisa", name: "Lisa Nguyen", dashboardRole: "Leader", count: 34 },
  { uid: "uid-brian", name: "Brian Foster", dashboardRole: "Team Member", count: 18 },
  { uid: "Unassigned", name: "Unassigned", dashboardRole: null, count: 100 },
];

export const MOCK_NAME_QUALITY = [
  { name: "Unique Names", value: 9847 },
  { name: "Duplicate First=Last", value: 1203 },
  { name: "Unknown", value: 2540 },
  { name: "Phone Number Only", value: 1242 },
];

// ── Conversations ───────────────────────────────────────────────────────
export const MOCK_CONVERSATIONS = [
  { id: "c1", uid: "conv-1", contactName: "James Mitchell", phone: "+14055550142", status: "open", channelType: "webchat", assignedUserUid: "uid-sarah", lastItemAt: new Date(Date.now() - 12 * 60000) },
  { id: "c2", uid: "conv-2", contactName: "Robert Chen", phone: "+19185550287", status: "open", channelType: "sms", assignedUserUid: "uid-jake", lastItemAt: new Date(Date.now() - 45 * 60000) },
  { id: "c3", uid: "conv-3", contactName: "Patricia Hernandez", phone: "+15805550193", status: "open", channelType: "sms", assignedUserUid: "uid-mike", lastItemAt: new Date(Date.now() - 2 * 3600000) },
  { id: "c4", uid: "conv-4", contactName: "Emily Watson", phone: "+19185550411", status: "open", channelType: "facebook", assignedUserUid: "uid-sarah", lastItemAt: new Date(Date.now() - 3 * 3600000) },
  { id: "c5", uid: "conv-5", contactName: "David Thompson", phone: "+14055550368", status: "open", channelType: "sms", assignedUserUid: null, lastItemAt: new Date(Date.now() - 5 * 3600000) },
  { id: "c6", uid: "conv-6", contactName: "Amanda Foster", phone: "+14055550644", status: "open", channelType: "webchat", assignedUserUid: "uid-jake", lastItemAt: new Date(Date.now() - 8 * 3600000) },
  { id: "c7", uid: "conv-7", contactName: "Marcus Johnson", phone: "+15805550529", status: "closed", channelType: "sms", assignedUserUid: "uid-sarah", lastItemAt: new Date(Date.now() - 2 * 86400000) },
  { id: "c8", uid: "conv-8", contactName: "Steven Park", phone: "+19185550773", status: "closed", channelType: "webchat", assignedUserUid: "uid-mike", lastItemAt: new Date(Date.now() - 3 * 86400000) },
  { id: "c9", uid: "conv-9", contactName: "Kelly Bryant", phone: "+14055550891", status: "open", channelType: "sms", assignedUserUid: null, lastItemAt: new Date(Date.now() - 12 * 3600000) },
  { id: "c10", uid: "conv-10", contactName: "Chris Anderson", phone: "+19185550234", status: "open", channelType: "sms", assignedUserUid: "uid-jake", lastItemAt: new Date(Date.now() - 1 * 86400000) },
];

export const MOCK_MESSAGES = {
  "conv-1": [
    { id: "m1", conversationUid: "conv-1", direction: "inbound", body: "Hi, I'm interested in the 2026 Grand Design Imagine. Is it still available?", createdAt: new Date(Date.now() - 2 * 3600000), senderUid: null },
    { id: "m2", conversationUid: "conv-1", direction: "outbound", body: "Hey James! Yes, we still have the 2026 Imagine 2800BH in stock. Would you like to schedule a walkthrough? We're open Monday through Saturday.", createdAt: new Date(Date.now() - 90 * 60000), senderUid: "uid-sarah" },
    { id: "m3", conversationUid: "conv-1", direction: "inbound", body: "That would be great! Can I come by this Saturday morning?", createdAt: new Date(Date.now() - 60 * 60000), senderUid: null },
    { id: "m4", conversationUid: "conv-1", direction: "outbound", body: "Saturday works perfectly! I'll have everything set up for you. Does 10am work? I'll pull the unit out front so you can see it up close.", createdAt: new Date(Date.now() - 30 * 60000), senderUid: "uid-sarah" },
    { id: "m5", conversationUid: "conv-1", direction: "inbound", body: "10am is perfect. See you then! One more question — do you guys offer any financing options?", createdAt: new Date(Date.now() - 12 * 60000), senderUid: null },
  ],
  "conv-2": [
    { id: "m6", conversationUid: "conv-2", direction: "inbound", body: "Looking at the Keystone Cougar on your lot. What's the best price you can do?", createdAt: new Date(Date.now() - 3 * 3600000), senderUid: null },
    { id: "m7", conversationUid: "conv-2", direction: "outbound", body: "Hi Robert! Thanks for reaching out about the Cougar 29RKS. Let me pull up the details for you. Are you looking to trade anything in?", createdAt: new Date(Date.now() - 2 * 3600000), senderUid: "uid-jake" },
    { id: "m8", conversationUid: "conv-2", direction: "inbound", body: "Yeah I have a 2021 Jayco Jay Flight I'd like to trade in. It's in great shape.", createdAt: new Date(Date.now() - 45 * 60000), senderUid: null },
  ],
};

// ── Follow-Up Priority ──────────────────────────────────────────────────
export const MOCK_FOLLOWUPS = [
  { id: "f1", contactName: "David Thompson", phone: "+14055550368", channelType: "sms", assignedUserUid: null, waitHours: 48.5 },
  { id: "f2", contactName: "Kelly Bryant", phone: "+14055550891", channelType: "sms", assignedUserUid: null, waitHours: 36.2 },
  { id: "f3", contactName: "Chris Anderson", phone: "+19185550234", channelType: "sms", assignedUserUid: "uid-jake", waitHours: 26.8 },
  { id: "f4", contactName: "James Mitchell", phone: "+14055550142", channelType: "webchat", assignedUserUid: "uid-sarah", waitHours: 0.2 },
  { id: "f5", contactName: "Robert Chen", phone: "+19185550287", channelType: "sms", assignedUserUid: "uid-jake", waitHours: 0.75 },
  { id: "f6", contactName: "Patricia Hernandez", phone: "+15805550193", channelType: "sms", assignedUserUid: "uid-mike", waitHours: 2.1 },
  { id: "f7", contactName: "Emily Watson", phone: "+19185550411", channelType: "facebook", assignedUserUid: "uid-sarah", waitHours: 3.4 },
];

// ── Coach Workload ──────────────────────────────────────────────────────
export const MOCK_WORKLOAD = [
  { name: "Sarah Martinez", open: 78, active7d: 42, stale7d: 28, stale30d: 8 },
  { name: "Jake Wilson", open: 65, active7d: 35, stale7d: 22, stale30d: 8 },
  { name: "Mike Torres", open: 52, active7d: 30, stale7d: 16, stale30d: 6 },
  { name: "Lisa Nguyen", open: 34, active7d: 20, stale7d: 10, stale30d: 4 },
  { name: "Brian Foster", open: 18, active7d: 12, stale7d: 4, stale30d: 2 },
  { name: "Unassigned", open: 100, active7d: 45, stale7d: 30, stale30d: 25 },
];

export const MOCK_WEEKLY_MESSAGES = [
  { name: "Sarah Martinez", messages: 312 },
  { name: "Jake Wilson", messages: 278 },
  { name: "Mike Torres", messages: 245 },
  { name: "Lisa Nguyen", messages: 156 },
  { name: "Brian Foster", messages: 89 },
];

// ── Contact Search ──────────────────────────────────────────────────────
export const MOCK_CONTACTS = [
  { contactName: "James Mitchell", phone: "+14055550142", email: "j.mitchell@email.com", status: "open", lastItemAt: new Date(Date.now() - 12 * 60000) },
  { contactName: "Robert Chen", phone: "+19185550287", email: "rchen@email.com", status: "open", lastItemAt: new Date(Date.now() - 45 * 60000) },
  { contactName: "Patricia Hernandez", phone: "+15805550193", email: "pat.h@email.com", status: "open", lastItemAt: new Date(Date.now() - 2 * 3600000) },
  { contactName: "Emily Watson", phone: "+19185550411", email: "ewatson@email.com", status: "open", lastItemAt: new Date(Date.now() - 3 * 3600000) },
  { contactName: "David Thompson", phone: "+14055550368", email: "dthompson@email.com", status: "open", lastItemAt: new Date(Date.now() - 5 * 3600000) },
  { contactName: "Amanda Foster", phone: "+14055550644", email: "abfoster@email.com", status: "open", lastItemAt: new Date(Date.now() - 8 * 3600000) },
  { contactName: "Marcus Johnson", phone: "+15805550529", email: "mjohnson@email.com", status: "closed", lastItemAt: new Date(Date.now() - 2 * 86400000) },
  { contactName: "Steven Park", phone: "+19185550773", email: "spark@email.com", status: "closed", lastItemAt: new Date(Date.now() - 3 * 86400000) },
  { contactName: "Kelly Bryant", phone: "+14055550891", email: "kbryant@email.com", status: "open", lastItemAt: new Date(Date.now() - 12 * 3600000) },
  { contactName: "Chris Anderson", phone: "+19185550234", email: "canderson@email.com", status: "open", lastItemAt: new Date(Date.now() - 1 * 86400000) },
  { contactName: "Jennifer Lewis", phone: "+14055551122", email: "jlewis@email.com", status: "closed", lastItemAt: new Date(Date.now() - 5 * 86400000) },
  { contactName: "Michael Roberts", phone: "+19185551333", email: "mroberts@email.com", status: "closed", lastItemAt: new Date(Date.now() - 7 * 86400000) },
];

// ── Reviews ─────────────────────────────────────────────────────────────
export const MOCK_RECENT_REVIEWS = [
  { id: "r1", contactName: "James Mitchell", rating: 5, source: "Google", body: "Absolutely amazing experience! Sarah was incredibly helpful and patient with all our questions. The walkthrough was thorough and we felt completely confident driving off the lot.", createdAt: new Date(Date.now() - 1 * 86400000), needsResponse: false },
  { id: "r2", contactName: "Amanda Foster", rating: 5, source: "Google", body: "Best RV buying experience we've ever had. Jake really knows his stuff and made the whole process smooth.", createdAt: new Date(Date.now() - 2 * 86400000), needsResponse: true },
  { id: "r3", contactName: "Steven Park", rating: 4, source: "Facebook", body: "Great selection and fair prices. The service department was quick to fix a small issue before delivery.", createdAt: new Date(Date.now() - 3 * 86400000), needsResponse: true },
  { id: "r4", contactName: "Marcus Johnson", rating: 5, source: "Google", body: "This is our second unit from ROA and they continue to exceed expectations. Mike in delivery was fantastic.", createdAt: new Date(Date.now() - 4 * 86400000), needsResponse: false },
  { id: "r5", contactName: "Jennifer Lewis", rating: 3, source: "Yelp", body: "Good dealership overall but the financing process took longer than expected. Would have liked more communication during the wait.", createdAt: new Date(Date.now() - 5 * 86400000), needsResponse: true },
  { id: "r6", contactName: "Chris Anderson", rating: 5, source: "Google", body: "Top notch! From start to finish the team at ROA was professional and friendly.", createdAt: new Date(Date.now() - 6 * 86400000), needsResponse: false },
  { id: "r7", contactName: "Robert Chen", rating: 4, source: "Facebook", body: "Really enjoyed our buying experience. Nice facilities and knowledgeable staff.", createdAt: new Date(Date.now() - 7 * 86400000), needsResponse: false },
  { id: "r8", contactName: "Kelly Bryant", rating: 5, source: "Google", body: "Couldn't be happier with our purchase! The entire team went above and beyond.", createdAt: new Date(Date.now() - 8 * 86400000), needsResponse: true },
  { id: "r9", contactName: "Patricia Hernandez", rating: 5, source: "Google", body: "Wonderful experience. The delivery checklist process gave us so much confidence.", createdAt: new Date(Date.now() - 10 * 86400000), needsResponse: false },
  { id: "r10", contactName: "Emily Watson", rating: 4, source: "Yelp", body: "Very happy with our Airstream Basecamp. Great team!", createdAt: new Date(Date.now() - 12 * 86400000), needsResponse: false },
];

export const MOCK_NEEDS_RESPONSE = MOCK_RECENT_REVIEWS.filter((r) => r.needsResponse);
