# 02 — System Architecture

## 1. Stack

| Layer           | Choice                                                                                         | Notes                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Backend         | Node.js 22 LTS, Express 5, **JavaScript (ESM)**                                                | `type: "module"`                                                                                                     |
| ORM / DB        | Prisma **7.10.x (pinned, stable)** + PostgreSQL 17                                             | npm `latest` currently points at an 8.0 RC — don't use it. Prisma 7 needs `prisma.config.js` + `@prisma/adapter-pg`. |
| Validation      | Zod                                                                                            | same as existing ASG projects                                                                                        |
| Auth            | JWT access token (15 min) + rotating refresh token (httpOnly cookie, stored hashed) + TOTP 2FA |                                                                                                                      |
| Background jobs | **pg-boss** (queue in Postgres)                                                                | EMI reminders, overdue marking, hold expiry, notifications, FB lead processing. No Redis to run.                     |
| Files           | S3-compatible storage (Cloudflare R2 in prod, MinIO in local docker)                           | private bucket, signed URLs only                                                                                     |
| Logging         | pino + request id                                                                              |                                                                                                                      |
| Frontend        | Next.js (App Router), JavaScript                                                               |                                                                                                                      |
| UI              | Tailwind CSS + shadcn/ui (JS mode)                                                             |                                                                                                                      |
| Data fetching   | TanStack Query + axios                                                                         | auto refresh-token interceptor                                                                                       |
| Forms / tables  | react-hook-form + zod, TanStack Table                                                          |                                                                                                                      |
| Charts          | Recharts                                                                                       |                                                                                                                      |
| Plot map        | SVG overlay on master-plan image + `react-zoom-pan-pinch`                                      | see §7                                                                                                               |
| Automation      | In-app jobs for anything business-critical; **n8n only for optional glue**                     | reminders/accounting must not depend on an external tool                                                             |
| Hosting         | Docker Compose on a cloud VPS, Nginx (TLS), daily `pg_dump` → R2                               |                                                                                                                      |

---

## 2. Reusability strategy (product, not a one-off)

Goal: deliver the same ERP to other real-estate companies without forking.

1. **Single-tenant per client** (decided): each client gets their own deployment + own database.
   Clean data isolation, per-client customization via config, no `tenantId` on every query.
   (Multi-tenant SaaS can be added later; the module structure doesn't block it.)
2. **`core/` is client-agnostic**: auth, RBAC, audit, approvals, files, numbering, notifications, query helpers.
   Nothing in `core/` mentions Fujisan.
3. **Each module is self-contained** and declares itself in a manifest:
   ```js
   // src/modules/lead/lead.module.js
   export default {
     name: "lead",
     basePath: "/leads",
     router: LeadRoute,
     permissions: ["lead.view", "lead.create", "lead.edit", "lead.delete", "lead.export"],
     dependsOn: ["employee", "project"],
   };
   ```
   The route registry mounts only modules listed in `ENABLED_MODULES` (env/settings); the frontend
   navigation reads the same list. A client who doesn't need Inventory simply doesn't enable it.
4. **Branding & business policy are data**, not code: company profile, logo, receipt template,
   numbering prefixes, discount limits, late-fee & cancellation policies, approval chains, land units.
5. Seeds are split: `seed/core` (permissions, system roles, COA template) vs `seed/clients/fujisan`.
6. A `npm run make:module <name>` generator creates the standard 6 files, so every module looks the same.

---

## 3. Backend structure

Same layering as `acs-foundation-backend` (route → controller → service), cleaned up and with a shared core:

```
Fujisan-Backend/
├── prisma/
│   ├── schema/                 # multi-file schema, one file per domain
│   │   ├── base.prisma         # generator + datasource
│   │   ├── auth.prisma  org.prisma  audit.prisma  file.prisma
│   │   ├── project.prisma  customer.prisma  approval.prisma
│   │   └── crm.prisma  booking.prisma  accounts.prisma ...
│   ├── migrations/
│   └── seed/  (core/, clients/fujisan/)
├── prisma.config.js
├── src/
│   ├── index.js                # boot: env check, db connect, start server + job worker
│   ├── app.js                  # express app: security middleware, routes, error handler
│   ├── config/                 # env parsed & validated with zod
│   ├── core/
│   │   ├── db/prisma.js        # client + audit extension
│   │   ├── context/            # AsyncLocalStorage request context (user, ip, device, requestId)
│   │   ├── errors/             # AppError, prisma/zod error mappers
│   │   ├── middleware/         # auth, authorize, validate, rateLimit, upload, notFound, errorHandler
│   │   ├── docs/               # OpenAPI registry (defineRoute) + Swagger UI
│   │   ├── utils/              # sendResponse, listQuery, logger, money, phone, date
│   │   ├── rbac/               # permission catalog, scope → prisma `where` builder
│   │   ├── audit/              # audit service
│   │   ├── approval/           # approval engine
│   │   ├── numbering/          # document number sequences
│   │   ├── storage/            # S3 client, signed URLs
│   │   ├── notification/       # in-app + channels (sms/email/whatsapp adapters)
│   │   └── jobs/               # pg-boss setup + job registry
│   ├── modules/
│   │   └── <module>/
│   │       ├── <module>.module.js      # manifest (see §2)
│   │       ├── <module>.route.js
│   │       ├── <module>.controller.js  # HTTP only: read req, call service, sendResponse
│   │       ├── <module>.service.js     # business logic + prisma
│   │       ├── <module>.validation.js  # zod schemas
│   │       ├── <module>.constant.js    # searchable/sortable fields, select shapes, enums
│   │       └── <module>.docs.js        # Swagger: registers endpoints using the validation schemas
│   └── routes/index.js         # module registry → /api/v1/*
└── tests/
```

**Layer rules**

- Controller never touches Prisma; service never touches `req`/`res`.
- Services receive an `actor` (`{ userId, employeeId, roleId, scope }`) when they need it.
- Cross-module calls go through the other module's service, never its tables directly
  (keeps modules removable).
- Multi-step writes (booking, payment, cancellation) run in `prisma.$transaction`.
- Express 5 forwards rejected promises to the error handler, so controllers are plain `async`
  functions (no `catchAsync` wrapper needed).
- Validated input is read from `req.valid.{params,query,body}` (`req.body` is also replaced).
  Express 5 makes `req.query` read-only, so never read raw `req.query` in controllers.
- **Update schemas never contain `.default()`**: zod keeps defaults inside `.partial()`, so a PATCH
  with one field would silently reset the others. Build update schemas from a defaults-free shape
  and add defaults only to the create schema.
- Imports use Node subpath aliases: `#config/*`, `#core/*`, `#modules/*`, `#generated/*`.
- Prisma uses the new `prisma-client` generator (output `src/generated/prisma`, git-ignored).
  It emits `.ts` files that Node ≥ 22.18 runs natively (type stripping). Our own code stays `.js`.
- New module: `npm run make:module -- <kebab-name>` → 7 formatted files with CRUD, validation,
  Swagger docs and manifest. The registry discovers it automatically.

## 3a. API documentation (Swagger)

- Swagger UI: `GET /api/docs`; raw OpenAPI 3.1 JSON: `GET /api/docs.json` (importable into Postman/Bruno).
- Enabled with `API_DOCS_ENABLED=true` (off in production unless put behind auth).
- Each module's `<module>.docs.js` calls `defineRoute({ method, path, tags, summary, request, response, ... })`
  with the **same zod schemas** used by `validate()`, so docs can't drift from validation.
  Response schemas get the standard envelope and error responses automatically; protected routes
  show the "Authorize" (bearer JWT) button.

---

## 4. API conventions

- Base: `/api/v1/<resource>` (plural, kebab-case): `/api/v1/projects/:id/blocks`.
- List query: `?page=1&limit=20&search=...&sortBy=createdAt&sortOrder=desc&<filterField>=...`
- Success envelope:
  ```json
  { "success": true, "message": "Leads retrieved", "data": [...], "meta": { "page": 1, "limit": 20, "total": 134 } }
  ```
- Error envelope: `{ "success": false, "message": "...", "errors": [{ "path": "mobile", "message": "Invalid" }] }`
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden/out-of-scope, 404, 409 conflict
  (e.g. plot already booked), 422 business-rule violation.
- IDs: UUID primary keys; human-readable codes separately (`BK-2026-000123`, `MR-2026-004512`).
- Soft delete (`deletedAt`) for master data; financial records are **never** deleted — they are
  cancelled/reversed with a new record.

---

## 5. Security design

**Authentication**

- Login with email/mobile + password (bcrypt, cost 12). Password policy configurable in settings.
- Access JWT (15 min, in memory on the frontend) + refresh token (30 days, httpOnly Secure SameSite cookie).
  Refresh tokens are stored **hashed** in `Session`, rotated on every use; reuse of an old token
  revokes the whole session family (theft detection).
- `Session` table powers "active devices" and "logout from all devices".
- Failed-login protection: 5 failures → lock 15 min; per-IP rate limit on auth routes.
- 2FA: TOTP (Google Authenticator) with backup codes; can be enforced per role (e.g. all Accounts and Management roles).
- Every login attempt → `LoginHistory` (success/failure, IP, device).

**Authorization (RBAC + data scope)**

- Permission catalog lives in code (each module's manifest) and is synced to the DB by the seed.
  Roles are data, edited in a permission-matrix UI.
- `RolePermission(roleId, permissionId, scope)`, scope ∈ `OWN | TEAM | DEPARTMENT | BRANCH | ALL`.
- Route: `authorize("lead.view")` → 403 if missing, else puts the scope on `req.access`.
- Service: `buildScopeWhere(actor, scope, fieldMap)` turns the scope into a Prisma `where`:
  - OWN → `{ ownerId: actor.employeeId }`
  - TEAM → `{ teamId: { in: actor.teamIds } }` (teams the user belongs to or leads)
  - DEPARTMENT → `{ departmentId: actor.departmentId }`
  - BRANCH → `{ branchId: actor.branchId }`
  - ALL → `{}`
    To make this cheap, scoped records (lead, customer, booking, payment…) **store `ownerId`,
    `teamId`, `departmentId`, `branchId` at creation time** (denormalized on purpose).
- Role hierarchy `level`: a user can only manage users/roles below their own level.
- Permissions are cached per role in memory; `role.permissionsVersion` is put in the JWT so a
  change takes effect on the next refresh.

**Audit log**

- A Prisma client extension intercepts create/update/delete on audited models, loads the old row,
  and writes `AuditLog` with old/new values and changed fields. User, IP, device and request id come
  from the AsyncLocalStorage request context, so services don't need to pass them.
- Business events (approve, export, print, login, price change) are logged explicitly.
- `AuditLog` is append-only (DB role for the app has no UPDATE/DELETE on it).

**Other**: helmet, strict CORS allow-list, rate limiting, request size limits, secrets for
integrations encrypted at rest (AES-256-GCM with a key from env), private file bucket with
short-lived signed URLs after a permission check, HTTPS only, daily encrypted backups with
restore tested.

---

## 6. Cross-cutting engines (built once, used by many modules)

**Approval engine** (`core/approval`)

- `ApprovalWorkflow` per process (DISCOUNT, BOOKING, CANCELLATION, REFUND, PURCHASE, LEAVE, PAYROLL…)
  with ordered steps. Step approver can be: a role, the requester's team leader, reporting manager,
  department head, or a specific user. Each step can have an amount/percent limit.
- For discounts, steps are walked only until a step's limit covers the requested value
  (3% request with TL ≤ 2%, SM ≤ 5% → TL then SM; Director not needed).
- Modules register handlers: `onApproved(request)`, `onRejected(request)` — e.g. booking module
  confirms the booking when its approval finishes.
- Every action is stored (`ApprovalAction`) and notifies the next approver.

**Numbering** (`core/numbering`) — gap-free, concurrency-safe document numbers via a `Sequence`
table updated with `UPDATE … RETURNING` inside the transaction. Prefix/pattern configurable per client.

**Money** — Prisma `Decimal(14,2)`; arithmetic with `decimal.js`; EMI rounding remainder goes to the
last installment so the schedule always sums exactly to the price.

**Jobs** (pg-boss): `unit.hold-expiry` (every 5 min), `emi.mark-overdue` + `emi.late-fee` (daily 00:30 Asia/Dhaka),
`emi.reminders` (daily 10:00: 7/3/1 days), `notification.send`, later `fb-lead.ingest`.

**Notifications** — in-app first (`Notification` table + polling/SSE), then channel adapters
(SMS, email, WhatsApp) behind one interface so each client can plug their own gateway.

---

## 7. Interactive plot map design

The master plan is usually a CAD/PDF/image. We support two ways to make plots clickable:

1. **Image + drawn polygons (works for any layout)**: upload the master-plan image; in a map
   editor the admin clicks the corners of each plot and links the shape to a unit.
   Coordinates are stored relative to the image (`Unit.mapShape = { type: "polygon", points: [[x,y],...] }`).
2. **SVG import (fast path)**: if the layout is exported as SVG with each plot path id = plot number,
   we import it and auto-link all shapes in one go.

Viewer: image + SVG overlay, polygons filled by status color
(🟢 Available, 🟡 Hold, 🔵 Booked, 🔴 Sold, ⚫ Blocked), zoom/pan (works on phones), filters
(block, road, size, facing, price range, status), search by plot number, legend with live counts.
Clicking a plot opens a side drawer with details and the actions allowed by the user's permissions
(Hold, Book, View Customer, Payment, Transfer, Release). Map data comes from one endpoint
(`GET /projects/:id/map`) that returns lightweight shapes + status for all units.

Google Maps (Phase 5) is a separate, geographic view: project pins (lat/lng) that open the project.

---

## 8. Frontend structure (Fujisan-Frontend)

```
src/
├── app/
│   ├── (auth)/login, forgot-password, two-factor
│   └── (erp)/layout.js           # sidebar + topbar, auth guard
│       ├── dashboard/
│       ├── crm/leads, crm/follow-ups, crm/site-visits
│       ├── customers/[id]
│       ├── projects/[id]/(overview|blocks|roads|units|plot-map)
│       ├── bookings, emi, collections, cancellations
│       ├── accounts/..., hr/..., settings/..., roles/...
├── modules/<module>/             # mirrors backend modules → api.js, hooks.js, schema.js, components/
├── components/ui/                # shadcn
├── components/common/            # DataTable, PageHeader, FormField, StatusBadge, Can, ConfirmDialog, MoneyText
├── lib/                          # api client (axios + refresh), auth store, permissions, formatters (BDT, lakh/crore, dates)
└── config/navigation.js          # menu definition with required permission per item
```

- **Next.js 16 specifics**: `middleware.js` is now `proxy.js`; `params`, `searchParams`, `cookies()`
  are async-only; `cacheComponents` is on, so any client component calling `usePathname` /
  `useSearchParams` (sidebar, breadcrumb, tabs) must render inside `<Suspense>`, and render-time
  randomness/time (`Math.random`, `Date.now`) is not allowed in prerendered components.
  Version-matched docs live in `node_modules/next/dist/docs/` (see the frontend `AGENTS.md`).
- The browser always calls `/api/v1/...` on the frontend origin; Next rewrites (dev) or Nginx (prod)
  forward it to the backend, so the refresh-token cookie is first-party and readable by `proxy.js`.
- `useCan("booking.create")` / `<Can perm="booking.create">` hides what the user can't do
  (backend still enforces it).
- Navigation items declare their permission + module; items for disabled modules or missing
  permissions don't render.
- Mobile-first layouts for CRM, plot map, customer, collection, attendance screens.

---

## 9. Deployment

```
Internet → Nginx (TLS, gzip) → Next.js (node) ─┐
                             → API (node, PM2/cluster or 2 containers) → PostgreSQL 17
                                              → pg-boss worker (same image, worker mode)
                                              → R2 (files, backups)
```

Environments: local (docker compose: postgres + minio), staging, production. Migrations run with
`prisma migrate deploy` in CI/CD. Nightly `pg_dump` with 30-day retention + monthly restore drill.
