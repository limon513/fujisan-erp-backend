# Real Estate ERP — Backend

Express 5 + Prisma 7 + PostgreSQL, JavaScript (ESM). Built for Fujisan Properties Ltd. and
designed to be redeployed for other real-estate companies (one deployment per client).

Design docs: [docs/](docs/README.md)

## Requirements

- Node.js ≥ 22.18
- PostgreSQL 17 (local install, or `docker compose up -d postgres`)

## Setup

```bash
npm install
cp .env.example .env         # set DATABASE_URL
npm run db:generate          # generate Prisma client into src/generated/prisma
npm run db:migrate           # apply migrations (once models exist)
npm run dev                  # http://localhost:4000
```

- Health: `GET http://localhost:4000/api/v1/health`
- Swagger UI: http://localhost:4000/api/docs (OpenAPI JSON at `/api/docs.json`)

## Scripts

| Script                                | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `npm run dev`                         | Start with file watching                        |
| `npm test`                            | Run tests (Vitest + Supertest)                  |
| `npm run lint` / `npm run format`     | ESLint / Prettier                               |
| `npm run make:module -- <kebab-name>` | Scaffold a CRUD module (7 files)                |
| `npm run db:migrate`                  | Create/apply a migration in development         |
| `npm run db:new-migration -- <name>`  | Same, without interactive prompts (CI / agents) |
| `npm run db:deploy`                   | Apply migrations in staging/production          |
| `npm run db:studio`                   | Browse data                                     |

## Module layout

```
src/modules/<name>/
  <name>.module.js       manifest: name, basePath, router, permissions, dependsOn
  <name>.route.js        routes + validate() + (later) authorize()
  <name>.controller.js   HTTP only
  <name>.service.js      business logic + Prisma
  <name>.validation.js   zod schemas
  <name>.constant.js     searchable/sortable fields, select shapes
  <name>.docs.js         Swagger registration from the same zod schemas
```

Modules are discovered automatically. `ENABLED_MODULES` (comma list or `*`) controls which
non-core modules are mounted for a client.
