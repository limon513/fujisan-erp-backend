import { z } from "zod";
import { defineCrudRoutes, RefSchema } from "#core/docs/openapi.js";
import { TeamValidation } from "./team.validation.js";

const Team = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isActive: z.boolean(),
    branch: RefSchema,
    department: RefSchema,
    leader: z.object({ id: z.uuid(), fullName: z.string(), employeeCode: z.string() }).nullable(),
    memberCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Team" });

defineCrudRoutes({
  base: "/teams",
  tags: ["Organization: Teams"],
  label: "team",
  plural: "teams",
  permission: "team",
  validation: TeamValidation,
  schema: Team,
  deleteNote: "Only teams without members.",
});
