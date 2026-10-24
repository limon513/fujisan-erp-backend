# 01 — Requirements Analysis

Source: `FUJISAN.md` (client master blueprint). This file restates it as an engineering view:
what the system must do, how modules depend on each other, the business rules we must encode,
and the questions we still need the client to answer.

---

## 1. What the business is

Fujisan Properties Ltd. is a Bangladeshi real-estate developer that mainly sells **land plots**
(Project → Block → Road → Plot), and possibly apartments. Customers usually pay a booking amount,
a down payment and then **monthly installments (EMI)** over years. Sales are driven by a large sales
force (~500 employees overall) working Facebook / walk-in / referral leads.

The core value chain the ERP must own end-to-end:

```
Lead → Follow-up → Site Visit → Negotiation/Discount → Booking → EMI schedule
     → Collection (money receipt) → Accounts posting → Registration/Handover
     (or) → Cancellation → Refund
```

Supporting back office: HR, Attendance, Leave, Payroll, Targets/Commission, Purchase, Inventory,
Construction progress, Legal documents, Marketing ROI, Reports.

---

## 2. Module map and dependencies

| #   | Module                                                                              | Phase                                  | Depends on                                   |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| 1   | Auth, Users, Sessions, 2FA                                                          | 1                                      | —                                            |
| 2   | Roles & Permissions (+ data scope)                                                  | 1                                      | Users                                        |
| 3   | Organization: Branch, Department, Designation, Team, Employee                       | 1                                      | —                                            |
| 4   | Audit Log                                                                           | 1                                      | Auth (who did it)                            |
| 5   | Files / Documents storage                                                           | 1                                      | —                                            |
| 6   | Settings (company profile, integrations)                                            | 1                                      | —                                            |
| 7   | Dashboard (role-based shell)                                                        | 1 → grows each phase                   | everything                                   |
| 8   | Projects, Blocks, Roads, Units (Plot/Apartment)                                     | 2                                      | Org                                          |
| 9   | **Interactive Plot Map**                                                            | 2                                      | Units, Files                                 |
| 10  | Customers (+ nominees, documents)                                                   | 2                                      | Files, Employees                             |
| 11  | Approval Engine (generic)                                                           | 2 (built), used from 3                 | Roles, Employees                             |
| 12  | CRM: Leads, Follow-ups, Site Visits, Sources, Campaigns                             | 3                                      | Employees, Projects                          |
| 13  | Sales: Discount request, Quotation, Commission                                      | 3                                      | CRM, Units, Approval                         |
| 14  | Booking                                                                             | 3                                      | Customers, Units, Approval                   |
| 15  | EMI / Installment schedule                                                          | 3                                      | Booking                                      |
| 16  | Collection / Money receipt                                                          | 3                                      | EMI, **Accounts core**                       |
| 17  | Cancellation & Refund                                                               | 3                                      | Booking, Collection, Approval, Accounts core |
| 18  | Accounts core (COA, Journal, posting)                                               | **3** (engine) / 4 (full UI + reports) | —                                            |
| 19  | Notifications (in-app first)                                                        | 3                                      | —                                            |
| 20  | HR, Attendance, Leave, Payroll                                                      | 4                                      | Org, Approval, Accounts                      |
| 21  | Target & Performance                                                                | 4                                      | CRM, Booking, Collection                     |
| 22  | Purchase, Inventory                                                                 | 4                                      | Approval, Accounts                           |
| 23  | Project/Construction, Legal                                                         | 4                                      | Projects, Files                              |
| 24  | Facebook Lead Ads, SMS/WhatsApp/Email, Google Maps, Marketing ROI, Advanced reports | 5                                      | CRM, Notifications                           |

**Important change vs. the blueprint:** the blueprint puts Accounts in Phase 4, but Collection
(Phase 3) must post journal entries from day one, otherwise we would have to back-fill months of
accounting later. So the **accounting engine** (chart of accounts + journal + auto-posting) is built
in Phase 3, and only the full accounting UI/reports wait for Phase 4.

---

## 3. Business rules we must encode

**Access control**

- Permission = module/resource × action: `view, create, edit, delete, approve, export, print`.
- Every permission granted to a role carries a **data scope**: `OWN → TEAM → DEPARTMENT → BRANCH → ALL`.
  e.g. a Sales Executive sees only their own leads; a Team Leader sees the team's; GM sees all.
- Dashboard and navigation are generated from the user's permissions.

**Lead / CRM**

- Pipeline: `New → Contacted → Interested → Follow-up → Site Visit → Negotiation → Booking → Converted | Lost`.
- Duplicate check on every new lead (normalized BD mobile number, then email).
- Assignment rules: Round robin, Team-wise, Project-wise, Location-wise, Manual.

**Unit (plot) status**: `AVAILABLE, HOLD, BOOKED, SOLD, BLOCKED` with a strict state machine:

```
AVAILABLE → HOLD → (BOOKED | AVAILABLE on release/expiry)
AVAILABLE/HOLD → BOOKED → SOLD
BOOKED → AVAILABLE (cancellation)    BOOKED/SOLD → (transfer = same status, new owner)
any (except BOOKED/SOLD) ↔ BLOCKED (management only)
```

- A unit can never have two active bookings (enforced in the DB, not only in code).
- Every price change is recorded (blueprint example: "changed Plot A-102 price from ৳50 Lac to ৳48 Lac").

**Discount approval**: request goes Team Leader → Sales Manager → Director/Management, but only
as far up as the requested discount requires (limit per level).

**Booking flow**: Customer → Unit → Price → Discount → Booking amount → Payment method →
EMI plan → Documents → Approval → Confirmed.

**EMI**: auto-generated schedule (total price, down payment, N installments, monthly amount, due dates);
tracks paid / remaining / overdue / late fee. Reminders 7, 3, 1 days before due; overdue notice after.

**Collection**: methods Cash, Bank, Cheque, bKash, Nagad, Payment Gateway.
Flow: `Entry → Verification → Money Receipt → Accounts Posting`. Payments are never deleted, only reversed.

**Cancellation**: Request → Cancellation calculation → Approval → Refund calculation → Refund approval
→ Payment → Booking cancelled → Unit released. System computes paid amount, deduction,
cancellation charge, refund amount.

**Audit**: every sensitive action stores user, action, date/time, IP/device, old value, new value.

**Approvals** are centralized (one engine) and configurable per process: Discount, Cancellation,
Refund, Booking, Purchase, Leave, Payroll.

**Payroll**: `Basic + Allowance + Bonus + Commission − Deduction = Net`.

**Targets**: Company → Department → Team → Individual; sales, collection, lead, site-visit, booking, revenue targets.

---

## 4. Non-functional requirements

- ~500 users, mobile-responsive (field sales use phones) — Phase 1 UI must be mobile-first for CRM/plot map.
- Security: HTTPS, password policy, 2FA, RBAC, session management, login history, failed-login lockout,
  encrypted secrets, file access control, backups.
- Money correctness: no floating point for money; all amounts in BDT with 2 decimals.
- Bangladesh specifics: Asia/Dhaka timezone, BDT (৳, lakh/crore formatting), BD mobile format (+8801XXXXXXXXX),
  land units (katha, decimal, bigha, sqft), NID.
- **Reusability**: the same codebase must be deliverable to other real-estate companies with config,
  not code forks (see `02-architecture.md` §2).

---

## 5. Open questions for the client

These change the database design, so we need answers **before** the related phase starts.

**Before Phase 2 (real-estate core)**

1. Do they sell only plots, or also apartments / commercial spaces? (Apartments need building/floor.)
2. Which land units do they use (katha, decimal, sqft)? Is price set per katha or as a lump sum per plot?
   Are there premiums (corner plot, wide road, south-facing)?
3. What layout file do they have per project: AutoCAD / PDF / image / SVG? (Determines the plot-map editor.)
4. Hold rules: who can hold, for how long, does it auto-release?
5. What exactly makes a plot "SOLD": full payment, or deed registration?
6. Can a plot have joint owners (co-applicants), and with share percentages?

**Before Phase 3 (revenue engine)**

7. Discount limits per approval level (e.g. TL ≤ 2%, Sales Manager ≤ 5%, above → Director).
8. ~~Installment plans~~ — answered 2026-10-24, see below.
9. ~~Late-fee policy~~ — answered 2026-10-24, see below.
10. ~~Cancellation deduction~~ — answered 2026-10-24, see below.
11. Ownership transfer: allowed? fee?
12. Commission: on booking or on collection? Split between executive / TL / manager?
13. Revenue recognition (ask the accounts team): customer payments as "advance from customer" until
    registration/handover, or revenue on booking? Is VAT/AIT applicable on sales?
14. Money-receipt format and numbering.
15. Existing data to migrate (Excel of plots, customers, bookings, payments)?

**Before Phase 4/5**

16. Attendance device model (ZKTeco etc.)? Salary structure components?
17. SMS gateway, payment gateway (SSLCommerz / bKash PGW), WhatsApp Business account?
18. Number of branches and expected users at launch.

**Answered (2026-10-24) — payment plans**

- Plans are templates ("dynamic and simple"): down payment fixed ৳ or % of price; installments
  monthly, quarterly or yearly; an interest % field.
- Each plan has a grace period (days) and a late fee, fixed ৳ or % — assumed charged once per
  overdue installment after the grace period (to confirm).
- Cancellation: a charge deducted from the refund, fixed ৳ or % — assumed % of the amount paid.
- Interest assumed flat per year on the amount after the down payment (to confirm).
- Discounts (Q7): the Sales Manager approves each booking and settles its discount — may approve
  more or less than asked. Management sees every request but doesn't have to approve.

**Decided (2026-10-11)**

- One deployment + database per client (single-tenant).
- UI is English only.
- The reference site is inspiration only; `FUJISAN.md` is the source of truth.
- Backend ships Swagger/OpenAPI docs.

**Decided (2026-10-20) — Phase 2 answers**

1. Plots only (no apartments / commercial units).
2. Project land is measured in **decimal**, plots in **sqft**. Each plot has its own price; no corner
   or road-facing premiums (they set the price higher or lower instead).
3. Layout plans are **images** (AutoCAD stays with the developers). 3D renders may come later.
4. Holds: Sales Manager and above can hold a plot for a set number of days; it releases
   automatically when the days run out. The person who asked for the hold (e.g. a sales executive)
   is recorded, and every hold and release is kept as history.
5. A plot becomes **SOLD on registration** (booked before that).
6. **One owner per plot** — no joint ownership.

---

## 6. Reference project

`https://real-estate-erp-software.vercel.app/` is for visual reference only. Scope and behaviour follow `FUJISAN.md`.
