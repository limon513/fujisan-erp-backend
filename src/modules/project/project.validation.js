import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import {
  optionalDateOnly,
  optionalId,
  optionalText,
  queryBoolean,
} from "#core/utils/validators.js";
import { sortableFields } from "./project.constant.js";

export const ProjectStatus = z.enum(["PLANNING", "ONGOING", "COMPLETED", "ON_HOLD"]);

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,20}$/, "1–20 letters, digits or dashes");

const idParams = z.object({ id: z.uuid() });
const childParams = z.object({ id: z.uuid(), childId: z.uuid() });

const fields = {
  code: code.meta({ example: "FCITY" }),
  name: z.string().trim().min(2).max(150).meta({ example: "Fujisan City" }),
  status: ProjectStatus,
  description: optionalText(2000),
  address: optionalText(300),
  district: optionalText(80),
  upazila: optionalText(80),
  latitude: blankToNull(z.coerce.number().min(-90).max(90)),
  longitude: blankToNull(z.coerce.number().min(-180).max(180)),
  landAreaDecimal: blankToNull(z.coerce.number().positive().max(10_000_000)).meta({
    description: "Total land in decimal (শতাংশ)",
  }),
  launchDate: optionalDateOnly(),
  expectedHandoverDate: optionalDateOnly(),
  branchId: optionalId(),
  projectManagerId: optionalId(),
  defaultHoldDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .meta({ description: "Default plot hold length in days" }),
  isActive: z.boolean(),
};

const create = z.object({
  ...fields,
  status: fields.status.default("ONGOING"),
  defaultHoldDays: fields.defaultHoldDays.default(7),
  isActive: fields.isActive.default(true),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    status: ProjectStatus.optional(),
    isActive: queryBoolean(),
    branchId: z.uuid().optional(),
  },
});

const setLayout = z.object({
  fileId: z.uuid().meta({ description: "An uploaded image (POST /files with category LAYOUT)" }),
});

// Base shapes without defaults: zod keeps .default() inside .partial(), which would silently
// reset fields on update. Defaults are added only for create.
const blockFields = {
  code: code.max(10).meta({ example: "A" }),
  name: z.string().trim().min(1).max(60).meta({ example: "Block A" }),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
};

const roadFields = {
  name: z.string().trim().min(1).max(60).meta({ example: "Road 3" }),
  widthFeet: blankToNull(z.coerce.number().positive().max(500)),
  isActive: z.boolean(),
};

const partial = (shape) =>
  z
    .object(shape)
    .partial()
    .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export const ProjectValidation = {
  idParams,
  childParams,
  create,
  update,
  list,
  setLayout,
  createBlock: z.object({
    ...blockFields,
    sortOrder: blockFields.sortOrder.default(0),
    isActive: blockFields.isActive.default(true),
  }),
  updateBlock: partial(blockFields),
  createRoad: z.object({ ...roadFields, isActive: roadFields.isActive.default(true) }),
  updateRoad: partial(roadFields),
};
