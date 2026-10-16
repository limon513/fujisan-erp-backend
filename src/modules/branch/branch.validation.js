import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalText, queryBoolean } from "#core/utils/validators.js";
import { sortableFields } from "./branch.constant.js";

const idParams = z.object({ id: z.uuid() });

const fields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, "1–20 letters, digits or dashes")
    .meta({ example: "DHK" }),
  name: z.string().trim().min(2).max(100).meta({ example: "Dhaka Branch" }),
  address: optionalText(300),
  phone: optionalText(30),
  email: z.preprocess((v) => (v === "" ? null : v), z.email().nullable().optional()),
  isHeadOffice: z.boolean(),
  isActive: z.boolean(),
};

const create = z.object({
  ...fields,
  isHeadOffice: fields.isHeadOffice.default(false),
  isActive: fields.isActive.default(true),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: { isActive: queryBoolean() },
});

export const BranchValidation = { idParams, create, update, list };
