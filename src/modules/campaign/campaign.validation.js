import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import {
  money,
  optionalDateOnly,
  optionalId,
  optionalText,
  queryBoolean,
} from "#core/utils/validators.js";
import { sortableFields } from "./campaign.constant.js";

const idParams = z.object({ id: z.uuid() });

// No .default() in shared fields: zod keeps defaults inside .partial()
const fields = {
  name: z.string().trim().min(2).max(120).meta({ example: "Puja offer 2026" }),
  sourceId: optionalId().meta({ description: "Where the campaign runs (Facebook, Google, ...)" }),
  budget: z.preprocess((v) => (v === "" ? null : v), money.nullable().optional()),
  startDate: optionalDateOnly(),
  endDate: optionalDateOnly(),
  externalId: optionalText(100).meta({ description: "Campaign id at the ad platform" }),
  notes: optionalText(1000),
  isActive: z.boolean(),
};

const datesInOrder = (body) => !body.startDate || !body.endDate || body.startDate <= body.endDate;
const dateMessage = { message: "Ends before it starts", path: ["endDate"] };

const create = z
  .object({ ...fields, isActive: fields.isActive.default(true) })
  .refine(datesInOrder, dateMessage);

const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" })
  .refine(datesInOrder, dateMessage);

const list = listQuerySchema({
  sortable: sortableFields,
  filters: { isActive: queryBoolean(), sourceId: z.uuid().optional() },
});

export const CampaignValidation = { idParams, create, update, list };
