import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { SettingValidation as V } from "./setting.validation.js";

const tags = ["Settings"];

const Company = z
  .object({
    id: z.uuid(),
    name: z.string(),
    legalName: z.string().nullable(),
    logoFileId: z.uuid().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    tin: z.string().nullable(),
    bin: z.string().nullable(),
    currency: z.string().meta({ example: "BDT" }),
    timezone: z.string().meta({ example: "Asia/Dhaka" }),
    fiscalYearStartMonth: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "CompanyProfile" });

defineRoute({
  method: "get",
  path: "/settings/branding",
  tags,
  summary: "App and company name for the sign-in page",
  response: z.object({
    appName: z.string(),
    companyName: z.string().nullable(),
    logoFileId: z.uuid().nullable(),
  }),
  auth: false,
  errors: [],
});
defineRoute({
  method: "get",
  path: "/settings/company",
  tags,
  summary: "Company profile",
  description: "Any signed-in user.",
  response: Company,
  errors: [401, 404],
});
defineRoute({
  method: "patch",
  path: "/settings/company",
  tags,
  summary: "Update the company profile",
  description: "Requires `setting.edit`. Currency and timezone are fixed per deployment.",
  request: { body: V.updateCompany },
  response: Company,
  errors: [400, 401, 403],
});
