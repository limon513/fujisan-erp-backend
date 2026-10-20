import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import {
  bdMobileSchema,
  nidSchema,
  optionalDateOnly,
  optionalId,
  optionalText,
} from "#core/utils/validators.js";
import { DOCUMENT_CATEGORIES, sortableFields } from "./customer.constant.js";

const blankToNull = (schema) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

const idParams = z.object({ id: z.uuid() });
const childParams = z.object({ id: z.uuid(), childId: z.uuid() });

// No .default() here: zod keeps defaults inside .partial()
const fields = {
  fullName: z.string().trim().min(2).max(120).meta({ example: "Karim Ahmed" }),
  fatherName: optionalText(120),
  motherName: optionalText(120),
  spouseName: optionalText(120),
  dateOfBirth: optionalDateOnly(),
  gender: blankToNull(z.enum(["MALE", "FEMALE", "OTHER"])),
  nidNumber: blankToNull(nidSchema),
  passportNumber: optionalText(20),
  tin: blankToNull(
    z
      .string()
      .trim()
      .regex(/^\d{12}$/, "e-TIN has 12 digits"),
  ),
  profession: optionalText(80),
  organization: optionalText(120),
  mobile: bdMobileSchema.meta({ example: "01811000000" }),
  altMobile: blankToNull(bdMobileSchema),
  email: blankToNull(z.email().toLowerCase()),
  presentAddress: optionalText(300),
  permanentAddress: optionalText(300),
  notes: optionalText(1000),
  ownerId: optionalId().meta({
    description:
      "Employee responsible for this customer (default: you). Needs customer access wider than OWN.",
  }),
};

const create = z.object({
  ...fields,
  confirmDuplicateMobile: z
    .boolean()
    .optional()
    .meta({ description: "Create even if another customer has the same mobile (e.g. family)" }),
});

const update = z
  .object(fields)
  .partial()
  .extend({ confirmDuplicateMobile: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: { ownerId: z.uuid().optional() },
});

const duplicateCheck = z
  .object({
    mobile: blankToNull(bdMobileSchema),
    nidNumber: blankToNull(nidSchema),
    excludeId: z.uuid().optional(),
  })
  .refine((q) => q.mobile || q.nidNumber, { message: "Give a mobile or NID number" });

// Nominees
const nomineeFields = {
  fullName: z.string().trim().min(2).max(120),
  relation: z.string().trim().min(2).max(40).meta({ example: "Wife" }),
  nidNumber: blankToNull(nidSchema),
  mobile: blankToNull(bdMobileSchema),
  sharePercent: z.coerce.number().positive().max(100).meta({ example: 100 }),
};
const createNominee = z.object(nomineeFields);
const updateNominee = z
  .object(nomineeFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const addDocument = z.object({
  fileId: z.uuid().meta({ description: "Uploaded with POST /files" }),
  category: z.enum(DOCUMENT_CATEGORIES),
});

export const CustomerValidation = {
  idParams,
  childParams,
  create,
  update,
  list,
  duplicateCheck,
  createNominee,
  updateNominee,
  addDocument,
};
