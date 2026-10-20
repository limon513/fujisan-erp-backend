import { z } from "zod";
import { defineCrudRoutes, defineRoute, registry } from "#core/docs/openapi.js";
import { MAX_IMPORT_ROWS } from "./plot.constant.js";
import { Facing, PlotStatus, PlotValidation as V } from "./plot.validation.js";

const tags = ["Plots"];
const decimal = z.string().meta({ example: "4800000" });

const Plot = z
  .object({
    id: z.uuid(),
    code: z.string().meta({ example: "A-102" }),
    plotNumber: z.string(),
    areaSqft: decimal.meta({ example: "1440" }),
    dimensions: z.string().nullable(),
    facing: Facing.nullable(),
    price: decimal,
    ratePerSqft: z.string().nullable().meta({ description: "price ÷ area", example: "3333.33" }),
    status: PlotStatus,
    statusChangedAt: z.iso.datetime(),
    remarks: z.string().nullable(),
    project: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    block: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    road: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    activeHold: z
      .object({
        id: z.uuid(),
        expiresAt: z.iso.datetime(),
        reason: z.string(),
        requestedBy: z.object({ id: z.uuid(), fullName: z.string() }),
        heldBy: z.object({ id: z.uuid(), username: z.string() }),
      })
      .nullable(),
    statusHistory: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .meta({ description: "Detail only" }),
    priceHistory: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .meta({ description: "Detail only" }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Plot" });

defineCrudRoutes({
  base: "/plots",
  tags,
  label: "plot",
  plural: "plots",
  permission: "plot",
  validation: V,
  schema: Plot,
  deleteNote: "Only plots that were never held or booked (mistakes); otherwise block the plot.",
});

defineRoute({
  method: "post",
  path: "/plots/:id/price",
  tags,
  summary: "Change a plot's price",
  description:
    "Requires `plot.price`. A reason is required; kept in price history and the audit log. Not allowed for booked or sold plots.",
  request: { params: V.idParams, body: V.changePrice },
  response: Plot,
  errors: [400, 401, 403, 404, 422],
});

const ImportResult = z.object({
  rows: z.number().int(),
  valid: z.number().int(),
  created: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), field: z.string(), message: z.string() })),
  newBlocks: z.array(z.string()),
  newRoads: z.array(z.string()),
  preview: z.array(z.record(z.string(), z.unknown())),
});

registry.registerPath({
  method: "post",
  path: "/plots/import",
  tags,
  summary: "Import plots from Excel / CSV",
  description: `Requires \`plot.create\`. Multipart \`file\` (.xlsx or .csv, up to ${MAX_IMPORT_ROWS} rows). Columns: Block, Plot, Area (sqft), Price (BDT), optional Road, Facing, Dimensions, Remarks. \`dryRun=true\` (default) validates and previews; \`dryRun=false\` creates everything or nothing. Missing blocks/roads are created.`,
  security: [{ bearerAuth: [] }],
  request: {
    query: V.importQuery,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.string().meta({ format: "binary" }) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Preview",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), message: z.string(), data: ImportResult }),
        },
      },
    },
    201: { description: "Imported" },
    422: { description: "File errors" },
  },
});

registry.registerPath({
  method: "get",
  path: "/plots/import-template",
  tags,
  summary: "Download the CSV import template",
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: "CSV file", content: { "text/csv": { schema: z.string() } } } },
});
