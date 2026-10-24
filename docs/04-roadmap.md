# 04 — Development Roadmap

We work one step at a time. Each step is done only when:

- the API works and is covered by a request collection (Bruno/Postman) and, for money/permission logic, automated tests;
- the matching frontend screen exists (where the step has UI);
- permissions and audit logging are applied;
- the docs are updated if the design changed.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Project setup

- ☑ 0.1 Tooling (`.gitignore`, `.editorconfig`, Prettier, ESLint, `.env.example`), git repos on personal GitHub (limon513)
- ☑ 0.2 Backend scaffold: Express 5, zod-validated config, `core/` (AppError, error normalizer, sendResponse,
  validate, listQuery, request context, pino logging, helmet/CORS/rate limit), `/api/v1/health`
- ☑ 0.3 Prisma 7.10 multi-file schema + `prisma.config.js`; local Postgres (`fujisan_erp`); docker-compose (Postgres + MinIO) as an option
- ☑ 0.4 Module registry (auto-discovery + `ENABLED_MODULES` + dependency check) + `make:module` generator
- ☑ 0.5 Swagger/OpenAPI docs (`/api/docs`) generated from zod schemas
- ☑ 0.6 Test setup (Vitest + Supertest)
- ☑ 0.7 Frontend scaffold: Next.js (JS, App Router), Tailwind, shadcn/ui, TanStack Query, axios client, ERP layout shell (sidebar/topbar, mobile drawer)

## Phase 1 — Foundation

- ☑ 1.1 Schema: org, auth, RBAC, audit, file, sequence, settings, notification → first migration
- ☑ 1.2 Seed: permission catalog sync, system roles (Super Admin … Viewer), Super Admin user, company row
- ☑ 1.3 Auth API: login, refresh (rotation + reuse detection), logout, logout-all, me, change/forgot/reset password, lockout, login history, sessions list/revoke
- ☑ 1.4 RBAC: `authorize()` middleware, scope → `where` builder, Roles CRUD + permission-matrix API, role-level guard
- ☑ 1.5 Request context + audit-log Prisma extension + audit log API
- ☑ 1.6 Organization APIs: branches, departments, designations, teams, employees (+ create/disable ERP user for an employee)
- ☐ 1.7 File service: upload to S3/MinIO, signed download URLs, versions
- ◐ 1.8 Settings API: company profile + public branding ☑ — security policy settings ☐
- ◐ 1.9 Frontend: login, forced password change, forgot/reset, token refresh, protected layout (proxy.js + AuthGate), permission-driven navigation, `<Can>`, FormField ☑ — shared DataTable ☐
- ☑ 1.10 Frontend: org screens, user accounts, audit log viewer, roles + permission matrix, my profile (devices, sign-in history), company settings
- ☐ 1.11 2FA (TOTP + backup codes), enforce per role
- ☑ 1.12 Dashboard shell with role-based widget slots (done with 2.8: sections appear per permission)

## Phase 2 — Real-estate core

Client answers recorded in `01-requirements-analysis.md` §5 (plots only, decimal/sqft, image
layouts, holds with day limit + auto-release, sold on registration, single owner).

- ☑ 2.1 File service: upload (images/PDF), storage driver (local disk in dev, S3-compatible / Cloudflare R2 for hosted), access-checked download
- ☑ 2.2 Schema: project, block, road, plot, plot hold / status / price history, customer, nominee
- ☑ 2.3 Projects, blocks, roads: APIs + screens (project cards with plot-status bars, project page with overview / blocks / roads / layout tabs, layout image upload)
- ☑ 2.4 Plots: API + screens (list / filters, detail sheet with status + price history, add / edit, change price with reason, Excel/CSV import with preview)
- ☑ 2.5 Hold / release / block with history; auto-release job when the days run out
- ☑ 2.6 Interactive plot map: draw plot shapes on the layout image (editor) + colour-coded viewer with plot details and actions
- ☑ 2.7 Customers + nominees + documents, duplicate check by mobile/NID
- ☑ 2.8 Dashboard: plot inventory widgets (available / hold / booked / sold per project), holds ending soon, my holds, customers

## Phase 3 — Revenue engine

- ☑ 3.0 Approval engine (workflows, steps, requests, my-approvals inbox): approvals inbox / my requests / all, request page with chain + history + decide / withdraw, approval-chain editor, sidebar badge, dashboard tile

- ☑ 3.1 CRM
  - ☑ 3.1a Lead sources, campaigns, leads (duplicate check by mobile/email, timeline of calls/notes, pipeline status, manual assignment + pool, convert to customer)
  - ☑ 3.1b Follow-ups and site visits (due lists, reminders, next steps on the lead, dashboard tiles)
  - ☑ 3.1c Pipeline (kanban) view, assignment rules (round robin, team, project, location)
- ☑ 3.2 Notifications (in-app): bell with unread count, list, mark read; follow-up / site visit reminders; old ones pruned
- ☐ 3.3 Accounting engine: chart of accounts (seeded template), fiscal year, journal posting service
- ☐ 3.4 Sales: discount request → approval, quotation
- ☐ 3.5 Booking wizard (customer → unit → price/discount → booking money → plan → documents → approval → confirm)
- ☐ 3.6 EMI schedule generator + overdue/late-fee/reminder jobs
- ☐ 3.7 Collection: payment entry → verification → money receipt PDF → auto journal; cheque bounce & reversal
- ☐ 3.8 Cancellation & refund with policy calculation + approvals + postings; ownership transfer
- ☐ 3.9 Commission calculation
- ☐ 3.10 Sales & management dashboards, customer ledger, collection/outstanding reports

## Phase 4 — Back office

- ☐ 4.1 Accounts UI: COA, manual journals, cash/bank book, ledgers, bank reconciliation, trial balance, P&L, balance sheet, cash flow
- ☐ 4.2 HR: employee lifecycle (transfer, promotion, resignation, exit), documents
- ☐ 4.3 Attendance + leave (+ device import)
- ☐ 4.4 Payroll (structure, run, approval, payslip, posting)
- ☐ 4.5 Target & performance (targets, achievement, ranking)
- ☐ 4.6 Purchase (PR → approval → RFQ → comparison → PO → GRN → invoice → payment)
- ☐ 4.7 Inventory (items, warehouses, stock movements, low stock)
- ☐ 4.8 Construction progress + legal/document verification & expiry alerts

## Phase 5 — Automation & intelligence

- ☐ 5.1 Facebook Lead Ads webhook → CRM (idempotent, auto-assign, notify)
- ☐ 5.2 SMS / Email / WhatsApp channels + templates (EMI reminders, receipts, approvals)
- ☐ 5.3 Google Maps (project/office/plot locations, nearby facilities)
- ☐ 5.4 Marketing ROI (spend → leads → visits → bookings → revenue)
- ☐ 5.5 Advanced reports & exports, scheduled reports
- ☐ 5.6 PWA/mobile polish, performance hardening, security review, backup/restore drill
