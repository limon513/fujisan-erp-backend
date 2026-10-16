#!/usr/bin/env node
/**
 * Scaffolds a CRUD module in src/modules/<name>/ following the project conventions.
 *
 *   npm run make:module -- <name> [--path /custom-base-path] [--model PrismaModelName]
 *
 * <name> is kebab-case (e.g. "lead-source"). The Prisma model defaults to PascalCase of the name.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith("--"));
const option = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

if (!name || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error("Usage: npm run make:module -- <kebab-case-name> [--path /base] [--model Model]");
  process.exit(1);
}

const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const camel = pascal[0].toLowerCase() + pascal.slice(1);
const plural = (word) =>
  /[^aeiou]y$/.test(word)
    ? word.slice(0, -1) + "ies"
    : /(s|x|ch|sh)$/.test(word)
      ? word + "es"
      : word + "s";
const model = option("--model") ?? pascal;
const delegate = model[0].toLowerCase() + model.slice(1);
const basePath = option("--path") ?? `/${plural(name)}`;
const label = name.replace(/-/g, " ");
const Label = label[0].toUpperCase() + label.slice(1);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "src", "modules", name);

if (existsSync(dir)) {
  console.error(`Module already exists: src/modules/${name}`);
  process.exit(1);
}

const files = {
  [`${name}.constant.js`]: `export const searchableFields = ["name"];

export const sortableFields = ["createdAt", "name"];

export const ${camel}Select = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
};
`,

  [`${name}.validation.js`]: `import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { sortableFields } from "./${name}.constant.js";

const idParams = z.object({ id: z.uuid() });

const create = z.object({
  name: z.string().trim().min(1).max(150),
});

const update = create.partial();

const list = listQuerySchema({ sortable: sortableFields });

export const ${pascal}Validation = { idParams, create, update, list };
`,

  [`${name}.service.js`]: `import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import { ${camel}Select, searchableFields } from "./${name}.constant.js";

const list = async (query) => {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const where = { ...searchWhere };

  const [data, total] = await prisma.$transaction([
    prisma.${delegate}.findMany({ where, skip, take, orderBy, select: ${camel}Select }),
    prisma.${delegate}.count({ where }),
  ]);

  return { data, meta: paginationMeta(query, total) };
};

const getById = async (id) => {
  const record = await prisma.${delegate}.findUnique({ where: { id }, select: ${camel}Select });
  if (!record) throw AppError.notFound("${Label} not found");
  return record;
};

const create = async (payload) => {
  return prisma.${delegate}.create({ data: payload, select: ${camel}Select });
};

const update = async (id, payload) => {
  await getById(id);
  return prisma.${delegate}.update({ where: { id }, data: payload, select: ${camel}Select });
};

const remove = async (id) => {
  await getById(id);
  await prisma.${delegate}.delete({ where: { id } });
};

export const ${pascal}Service = { list, getById, create, update, remove };
`,

  [`${name}.controller.js`]: `import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { ${pascal}Service } from "./${name}.service.js";

const list = async (req, res) => {
  const { data, meta } = await ${pascal}Service.list(req.valid.query);
  return sendResponse(res, { message: "${Label} list retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await ${pascal}Service.getById(req.valid.params.id);
  return sendResponse(res, { message: "${Label} retrieved", data });
};

const create = async (req, res) => {
  const data = await ${pascal}Service.create(req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "${Label} created", data });
};

const update = async (req, res) => {
  const data = await ${pascal}Service.update(req.valid.params.id, req.body);
  return sendResponse(res, { message: "${Label} updated", data });
};

const remove = async (req, res) => {
  await ${pascal}Service.remove(req.valid.params.id);
  return sendResponse(res, { message: "${Label} deleted", data: null });
};

export const ${pascal}Controller = { list, getById, create, update, remove };
`,

  [`${name}.route.js`]: `import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { ${pascal}Controller } from "./${name}.controller.js";
import { ${pascal}Validation as V } from "./${name}.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("${name}.view"), validate({ query: V.list }), ${pascal}Controller.list);
router.get("/:id", authorize("${name}.view"), validate({ params: V.idParams }), ${pascal}Controller.getById);
router.post("/", authorize("${name}.create"), validate({ body: V.create }), ${pascal}Controller.create);
router.patch("/:id", authorize("${name}.edit"), validate({ params: V.idParams, body: V.update }), ${pascal}Controller.update);
router.delete("/:id", authorize("${name}.delete"), validate({ params: V.idParams }), ${pascal}Controller.remove);

export const ${pascal}Route = router;
`,

  [`${name}.docs.js`]: `import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { ${pascal}Validation as V } from "./${name}.validation.js";

const tags = ["${Label}"];
const base = "${basePath}";

const ${pascal} = z
  .object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "${pascal}" });

defineRoute({ method: "get", path: base, tags, summary: "List ${plural(label)}", request: { query: V.list }, response: ${pascal}, paginated: true });
defineRoute({ method: "get", path: \`\${base}/:id\`, tags, summary: "Get ${label}", request: { params: V.idParams }, response: ${pascal}, errors: [401, 403, 404] });
defineRoute({ method: "post", path: base, tags, summary: "Create ${label}", request: { body: V.create }, response: ${pascal}, status: 201, errors: [400, 401, 403, 409] });
defineRoute({ method: "patch", path: \`\${base}/:id\`, tags, summary: "Update ${label}", request: { params: V.idParams, body: V.update }, response: ${pascal}, errors: [400, 401, 403, 404, 409] });
defineRoute({ method: "delete", path: \`\${base}/:id\`, tags, summary: "Delete ${label}", request: { params: V.idParams }, errors: [401, 403, 404, 409] });
`,

  [`${name}.module.js`]: `import { definePermissions } from "#core/rbac/permissions.js";
import { ${pascal}Route } from "./${name}.route.js";
import "./${name}.docs.js";

export default {
  name: "${name}",
  basePath: "${basePath}",
  router: ${pascal}Route,
  permissions: definePermissions({ module: "${name}", label: "${Label}" }),
  dependsOn: [],
};
`,
};

await mkdir(dir, { recursive: true });
for (const [file, content] of Object.entries(files)) {
  await writeFile(path.join(dir, file), content);
}
execFileSync(path.join(root, "node_modules", ".bin", "prettier"), ["--write", dir], {
  stdio: "ignore",
});

console.log(`Created src/modules/${name}/ (${Object.keys(files).length} files)`);
console.log(`  base path:    /api/v1${basePath}`);
console.log(
  `  prisma model: ${model} (prisma.${delegate}) — add it to prisma/schema/*.prisma if missing`,
);
