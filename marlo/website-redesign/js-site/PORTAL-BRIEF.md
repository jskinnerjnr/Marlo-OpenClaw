# JSM Customer Portal — Full Product Brief

## What it is
A bespoke CRM + quote management + messaging system replacing:
- Quotient (quote management)
- Streak/Gmail (CRM + follow-ups)
- Back-and-forth email chains with customers

---

## CUSTOMER SIDE

### Quote management
- Account created automatically on first quote submission
- Dashboard shows all quotes: active, dormant, historical
- Each quote contains:
  - Car details (marque, model, year, chassis, paint colour, driver side)
  - Quote items (can add/remove while status is Open or Quoted)
  - Current status
  - Message thread
- Customer can add/remove items from open quotes
- Works as a web app on mobile and desktop

### Messaging
- Threaded conversation per quote
- Supports: text, photo upload, PDF upload, links
- Embedded links to handbook/materials pages
- Customer notified by email when admin sends a message
  - Email body: "Jonathan from the JSM team has sent you a message. Click here to log in." NO message preview.
  - Option for WhatsApp notification as well
- If customer REPLIES to the notification email → message is automatically captured in the portal thread (email-to-portal parsing)
- Primary goal: steer customers to log into portal, but capture email replies as fallback

---

## ADMIN SIDE

### Quote management
- See all quotes across all customers
- Filter by: status, marque, team member assigned, date, dormant
- Open any quote: see car details, items, full conversation history
- Add/remove items on customer's behalf
- Update quote status:
  `Open → Quoted → Samples Sent → Accepted → In Production → Dispatched → Complete`
  (plus: Dormant, Cancelled)

### CRM / Follow-up system
- On any quote: set a follow-up reminder (date + notes)
  - e.g. "Customer said to chase in Spring 2026"
- When reminder fires → admin sees alert with:
  - Reminder note
  - **AI-generated summary** of the full conversation history (via Claude API)
  - Quick-access to the quote to pick up the conversation
- Reminders list / dashboard view showing upcoming and overdue follow-ups

### Team / multi-user admin
- Multiple admin accounts (Jonny + team members)
- Quotes can be assigned to a team member
- Internal messaging between team members (NOT visible to customer)
- Internal notes on quotes (NOT visible to customer)

### Messaging (admin side)
- Same rich messaging as customer side: text, photos, PDFs, links
- See clearly what's customer-facing vs internal
- Notifications when customer sends a message

---

## NOTIFICATIONS

### To customers
- Email: "You have a new message from the JSM team. Click here to log in." (no preview)
- WhatsApp (optional): same notification via Twilio WhatsApp API
- If customer replies to the notification email → captured as portal message (Postmark inbound parse)

### To admins
- Email/in-app when customer sends a message
- Reminder alerts when follow-up dates are due

---

## TECH STACK

| Layer | Tool |
|---|---|
| Auth + Database | Supabase (free tier) |
| File storage | Supabase Storage |
| Real-time messaging | Supabase Realtime |
| Transactional email | Resend (free: 3k/month) |
| WhatsApp notifications | Twilio WhatsApp API |
| Email-to-portal parsing | Postmark Inbound |
| AI summaries | Claude API (via OpenClaw) |
| Reminders/cron | Supabase Edge Functions or OpenClaw cron |
| Frontend | HTML/JS — same design as main site |
| Hosting | GitHub Pages (shell) + Supabase (data) |

---

## DATABASE SCHEMA (draft)

### customers
- id, email, name, location, phone, whatsapp_number, created_at

### admin_users
- id, email, name, role (owner/team), created_at

### quotes
- id, customer_id, assigned_to (admin_user_id), status, car_details (JSON), created_at, updated_at, last_activity_at

### quote_items
- id, quote_id, item_name, material, colour, piping, notes, added_by (customer/admin), active (bool)

### messages
- id, quote_id, sender_id, sender_type (customer/admin), body, attachments (JSON), is_internal (bool), created_at, read_at

### follow_up_reminders
- id, quote_id, set_by (admin_id), due_date, notes, ai_summary (generated on trigger), completed_at

---

## QUOTE STATUSES
1. Open — being built/discussed
2. Quoted — price sent to customer
3. Samples Sent — physical samples dispatched
4. Accepted — customer confirmed order
5. In Production — being manufactured
6. Dispatched — shipped
7. Complete — done
8. Dormant — no activity (flag after 6 months)
9. Cancelled

---

## WHAT'S NEEDED TO START
1. Supabase project URL + anon public key (Settings → API)
2. Resend account + API key (resend.com, free)
3. Postmark account for inbound email parsing (optional — Phase 2)
4. Twilio for WhatsApp (optional — Phase 2)

## BUILD PHASES
- **Phase 1:** Customer portal + admin panel (UI + Supabase backend)
- **Phase 2:** Email notifications (Resend) + email-to-portal reply capture (Postmark)
- **Phase 3:** AI summaries on follow-up reminders (Claude API)
- **Phase 4:** WhatsApp notifications (Twilio)
