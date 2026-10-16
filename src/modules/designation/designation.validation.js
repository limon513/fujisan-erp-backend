import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, queryBoolean } from "#core/utils/validators.js";
import { sortableFields } from "./designation.constant.js";

const idParams = z.object({ id: z.uuid() });

const fields = {
  name: z.string().trim().min(2).max(100).meta({ example: "Senior Sales Executive" }),
  departmentId: optionalId().meta({ description: "Leave empty for a company-wide designation" }),
  level: z
    .number()
    .int()
    .min(0)
    .max(100)
    .meta({ description: "Seniority for sorting (higher = more senior)" }),
  isActive: z.boolean(),
};

const create = z.object({
  ...fields,
  level: fields.level.default(0),
  isActive: fields.isActive.default(true),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: { isActive: queryBoolean(), departmentId: z.uuid().optional() },
});

export const DesignationValidation = { idParams, create, update, list };
