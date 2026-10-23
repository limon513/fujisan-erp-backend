import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { queryBoolean } from "#core/utils/validators.js";
import { sortableFields } from "./lead-source.constant.js";

const idParams = z.object({ id: z.uuid() });

const fields = {
  name: z.string().trim().min(2).max(60).meta({ example: "Facebook" }),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};

const create = z.object({
  ...fields,
  isActive: fields.isActive.default(true),
  sortOrder: fields.sortOrder.default(100),
});

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: { isActive: queryBoolean() },
});

export const LeadSourceValidation = { idParams, create, update, list };
