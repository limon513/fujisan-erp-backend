import { z } from "zod";
import { queryBoolean } from "#core/utils/validators.js";
import { MAX_PAGE_SIZE } from "#core/utils/listQuery.js";

const idParams = z.object({ id: z.uuid() });

const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  unread: queryBoolean().meta({ description: "Only unread ones" }),
});

export const NotificationValidation = { idParams, list };
