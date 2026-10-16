import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, optionalText, queryBoolean } from "#core/utils/validators.js";
import { sortableFields } from "./department.constant.js";

const idParams = z.object({ id: z.uuid() });

const fields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, "1–20 letters, digits or dashes")
    .meta({ example: "SALES" }),
  name: z.string().trim().min(2).max(100).meta({ example: "Sales" }),
  description: optionalText(300),
  headId: optionalId().meta({ description: "Employee who heads the department" }),
  isActive: z.boolean(),
};

const create = z.object({ ...fields, isActive: fields.isActive.default(true) });

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({ sortable: sortableFields, filters: { isActive: queryBoolean() } });

export const DepartmentValidation = { idParams, create, update, list };
