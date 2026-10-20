import { z } from "zod";
import { FILE_CATEGORIES } from "./file.constant.js";

const idParams = z.object({ id: z.uuid() });

const upload = z.object({
  category: z.enum(FILE_CATEGORIES).default("OTHER"),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().trim().max(100).optional(),
});

const contentQuery = z.object({
  token: z.string().optional(),
  download: z
    .enum(["1", "true"])
    .optional()
    .meta({ description: "Send as attachment instead of inline" }),
});

export const FileValidation = { idParams, upload, contentQuery };
