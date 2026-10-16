import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalId, queryBoolean } from "#core/utils/validators.js";
import { sortableFields } from "./team.constant.js";

const idParams = z.object({ id: z.uuid() });

const fields = {
  name: z.string().trim().min(2).max(100).meta({ example: "Team Alpha" }),
  branchId: z.uuid(),
  departmentId: z.uuid(),
  leaderId: optionalId().meta({
    description: "Team leader (employee of the same branch and department)",
  }),
  isActive: z.boolean(),
};

const create = z.object({ ...fields, isActive: fields.isActive.default(true) });

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    isActive: queryBoolean(),
    branchId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
  },
});

export const TeamValidation = { idParams, create, update, list };
