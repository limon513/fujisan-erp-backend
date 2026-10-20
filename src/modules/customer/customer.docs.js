import { z } from "zod";
import { defineCrudRoutes, defineRoute } from "#core/docs/openapi.js";
import { CustomerValidation as V } from "./customer.validation.js";

const tags = ["Customers"];

const Owner = z
  .object({
    id: z.uuid(),
    fullName: z.string(),
    employeeCode: z.string(),
    designation: z.object({ name: z.string() }),
    team: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  })
  .nullable();

const Nominee = z.object({
  id: z.uuid(),
  fullName: z.string(),
  relation: z.string(),
  nidNumber: z.string().nullable(),
  mobile: z.string().nullable(),
  sharePercent: z.string(),
});

const Customer = z
  .object({
    id: z.uuid(),
    customerCode: z.string().meta({ example: "CUS-000001" }),
    fullName: z.string(),
    mobile: z.string(),
    email: z.string().nullable(),
    nidNumber: z.string().nullable(),
    profession: z.string().nullable(),
    owner: Owner,
    createdAt: z.iso.datetime(),
    fatherName: z.string().nullable().optional(),
    motherName: z.string().nullable().optional(),
    spouseName: z.string().nullable().optional(),
    dateOfBirth: z.iso.datetime().nullable().optional(),
    gender: z.string().nullable().optional(),
    passportNumber: z.string().nullable().optional(),
    tin: z.string().nullable().optional(),
    organization: z.string().nullable().optional(),
    altMobile: z.string().nullable().optional(),
    presentAddress: z.string().nullable().optional(),
    permanentAddress: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    photoUrl: z.string().nullable().optional(),
    nominees: z.array(Nominee).optional(),
    documents: z.array(z.record(z.string(), z.unknown())).optional(),
    holds: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .meta({ id: "Customer", description: "Detail fields are included on GET /customers/{id}" });

defineCrudRoutes({
  base: "/customers",
  tags,
  label: "customer",
  plural: "customers",
  permission: "customer",
  validation: V,
  schema: Customer,
  deleteNote:
    "Soft delete; not while the customer has a plot on hold. Results follow your data scope (OWN = your customers, TEAM, DEPARTMENT, BRANCH, ALL). A duplicate NID is refused; a duplicate mobile needs confirmDuplicateMobile.",
});

defineRoute({
  method: "get",
  path: "/customers/duplicates",
  tags,
  summary: "Find customers with the same mobile or NID",
  description:
    "Requires `customer.create` or `customer.edit`. Searches all customers (not only your scope) and returns minimal details.",
  request: { query: V.duplicateCheck },
  response: z.array(
    z.object({
      id: z.uuid(),
      customerCode: z.string(),
      fullName: z.string(),
      ownerName: z.string().nullable(),
      matchedOn: z.array(z.enum(["mobile", "nidNumber"])),
    }),
  ),
  errors: [400, 401, 403],
});

for (const [method, path, summary, body] of [
  ["post", "/customers/:id/nominees", "Add a nominee (shares ≤ 100% in total)", V.createNominee],
  ["patch", "/customers/:id/nominees/:childId", "Update a nominee", V.updateNominee],
  ["delete", "/customers/:id/nominees/:childId", "Remove a nominee", null],
  [
    "post",
    "/customers/:id/documents",
    "Attach an uploaded document (PHOTO also sets the profile photo)",
    V.addDocument,
  ],
  ["delete", "/customers/:id/documents/:childId", "Remove a document", null],
]) {
  defineRoute({
    method,
    path,
    tags,
    summary,
    description: "Requires `customer.edit`.",
    request: {
      params: path.includes(":childId") ? V.childParams : V.idParams,
      ...(body && { body }),
    },
    response: Customer,
    errors: [400, 401, 403, 404, 422],
  });
}
