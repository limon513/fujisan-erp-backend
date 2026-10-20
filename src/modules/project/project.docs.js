import { z } from "zod";
import { defineCrudRoutes, defineRoute, RefSchema } from "#core/docs/openapi.js";
import { ProjectStatus, ProjectValidation as V } from "./project.validation.js";

const tags = ["Projects"];
const decimal = z
  .string()
  .nullable()
  .meta({ description: "Decimal as string", example: "1250.50" });

const PlotCounts = z
  .object({
    AVAILABLE: z.number().int(),
    HOLD: z.number().int(),
    BOOKED: z.number().int(),
    SOLD: z.number().int(),
    BLOCKED: z.number().int(),
    total: z.number().int(),
  })
  .meta({ id: "PlotCounts" });

const Project = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    status: ProjectStatus,
    description: z.string().nullable(),
    address: z.string().nullable(),
    district: z.string().nullable(),
    upazila: z.string().nullable(),
    latitude: decimal,
    longitude: decimal,
    landAreaDecimal: decimal.meta({ description: "Total land in decimal" }),
    launchDate: z.iso.datetime().nullable(),
    expectedHandoverDate: z.iso.datetime().nullable(),
    defaultHoldDays: z.number().int(),
    isActive: z.boolean(),
    branch: RefSchema.nullable(),
    projectManager: z
      .object({ id: z.uuid(), fullName: z.string(), employeeCode: z.string() })
      .nullable(),
    blockCount: z.number().int(),
    roadCount: z.number().int(),
    plots: PlotCounts,
    layout: z
      .object({
        fileId: z.uuid(),
        width: z.number().int(),
        height: z.number().int(),
        url: z.string(),
      })
      .nullable()
      .meta({ description: "Master-plan image; width/height are the plot map's coordinate space" }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Project" });

defineCrudRoutes({
  base: "/projects",
  tags,
  label: "project",
  plural: "projects",
  permission: "project",
  validation: V,
  schema: Project,
  deleteNote:
    "Only projects without plots (their blocks and roads are deleted too); otherwise deactivate.",
});

defineRoute({
  method: "put",
  path: "/projects/:id/layout",
  tags,
  summary: "Set the master-plan (layout) image",
  description:
    "Requires `project.edit`. Upload the image first with POST /files (category LAYOUT).",
  request: { params: V.idParams, body: V.setLayout },
  response: Project,
  errors: [400, 401, 403, 404, 422],
});
defineRoute({
  method: "delete",
  path: "/projects/:id/layout",
  tags,
  summary: "Remove the layout image",
  request: { params: V.idParams },
  response: Project,
  errors: [401, 403, 404],
});

const Block = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    code: z.string(),
    name: z.string(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    plotCount: z.number().int().optional(),
  })
  .meta({ id: "Block" });
const Road = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    widthFeet: decimal,
    isActive: z.boolean(),
    plotCount: z.number().int().optional(),
  })
  .meta({ id: "Road" });

for (const [path, label, schema, createSchema, updateSchema] of [
  ["blocks", "block", Block, V.createBlock, V.updateBlock],
  ["roads", "road", Road, V.createRoad, V.updateRoad],
]) {
  const base = `/projects/:id/${path}`;
  defineRoute({
    method: "get",
    path: base,
    tags,
    summary: `List a project's ${path}`,
    request: { params: V.idParams },
    response: z.array(schema),
    errors: [401, 403, 404],
  });
  defineRoute({
    method: "post",
    path: base,
    tags,
    summary: `Add a ${label}`,
    description: "Requires `project.edit`.",
    request: { params: V.idParams, body: createSchema },
    response: schema,
    status: 201,
    errors: [400, 401, 403, 404, 409],
  });
  defineRoute({
    method: "patch",
    path: `${base}/:childId`,
    tags,
    summary: `Update a ${label}`,
    request: { params: V.childParams, body: updateSchema },
    response: schema,
    errors: [400, 401, 403, 404, 409],
  });
  defineRoute({
    method: "delete",
    path: `${base}/:childId`,
    tags,
    summary: `Delete a ${label}`,
    description: `Only ${path} without plots.`,
    request: { params: V.childParams },
    errors: [401, 403, 404, 409],
  });
}
