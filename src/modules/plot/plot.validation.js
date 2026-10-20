import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, optionalText } from "#core/utils/validators.js";
import { FACINGS, PLOT_STATUSES, sortableFields } from "./plot.constant.js";

export const PlotStatus = z.enum(PLOT_STATUSES);
export const Facing = z.enum(FACINGS);

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

/** Money in BDT with up to 2 decimals. */
export const money = z.coerce
  .number({ error: "Enter an amount" })
  .nonnegative()
  .max(1_000_000_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: "At most 2 decimals" });

export const area = z.coerce.number({ error: "Enter the area" }).positive().max(10_000_000);

const plotNumber = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9/-]+$/, "Letters, digits, - or /")
  .meta({ example: "102" });

const idParams = z.object({ id: z.uuid() });

// No .default() in shared fields: zod keeps defaults inside .partial()
const editable = {
  blockId: z.uuid(),
  roadId: optionalId(),
  plotNumber,
  areaSqft: area.meta({ description: "Plot size in sqft" }),
  dimensions: optionalText(40).meta({ example: "40 × 60 ft" }),
  facing: blankToNull(Facing),
  remarks: optionalText(500),
};

const create = z.object({
  projectId: z.uuid(),
  ...editable,
  price: money.meta({ description: "Price of this plot in BDT", example: 4800000 }),
});

const update = z
  .object(editable)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const changePrice = z.object({
  price: money,
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    projectId: z.uuid().optional(),
    blockId: z.uuid().optional(),
    roadId: z.uuid().optional(),
    status: PlotStatus.optional(),
    facing: Facing.optional(),
    minArea: z.coerce.number().nonnegative().optional(),
    maxArea: z.coerce.number().nonnegative().optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
  },
}).extend({ sortOrder: z.enum(["asc", "desc"]).default("asc") });

const importQuery = z.object({
  projectId: z.uuid(),
  dryRun: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true")
    .meta({ description: "true = validate and preview only (default); false = create the plots" }),
});

const reason = z.string().trim().min(3, "Give a reason").max(300);

const hold = z.object({
  requestedById: z
    .uuid()
    .meta({ description: "Employee who asked for the hold (e.g. the sales executive)" }),
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .meta({ description: "Defaults to the project's default hold days" }),
  reason,
  customerId: optionalId(),
  prospectName: optionalText(120),
  prospectMobile: optionalText(20),
});

const withReason = z.object({ reason });

const mapQuery = z.object({ projectId: z.uuid() });

const point = z.tuple([z.number().finite(), z.number().finite()]);

const shape = z.object({
  points: z.array(point).min(3, "A shape needs at least 3 points").max(200).nullable().meta({
    description: "Polygon corners in layout-image pixels [[x, y], ...]; null removes the shape",
  }),
  label: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .optional()
    .meta({ description: "Where to print the plot number (default: the shape's centre)" }),
});

export const PlotValidation = {
  idParams,
  create,
  update,
  changePrice,
  list,
  importQuery,
  hold,
  withReason,
  mapQuery,
  shape,
};
