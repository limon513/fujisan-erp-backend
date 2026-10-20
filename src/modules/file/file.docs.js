import { z } from "zod";
import config from "#config/index.js";
import { defineRoute, registry } from "#core/docs/openapi.js";
import { FILE_CATEGORIES } from "./file.constant.js";
import { FileValidation as V } from "./file.validation.js";

const tags = ["Files"];

const FileInfo = z
  .object({
    id: z.uuid(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    category: z.enum(FILE_CATEGORIES),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    version: z.number().int(),
    uploadedById: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    url: z.string().meta({ description: "Signed same-origin URL for <img src> / download links" }),
    urlExpiresIn: z.number().int().meta({ description: "Seconds the URL stays valid" }),
  })
  .meta({ id: "FileInfo" });

registry.registerPath({
  method: "post",
  path: "/files",
  tags,
  summary: "Upload a file",
  description: `Multipart form: \`file\` + \`category\` (+ optional \`entityType\`, \`entityId\`). JPEG, PNG, WebP or PDF up to ${config.storage.maxUploadBytes / 1024 / 1024} MB; the type is detected from the content. Image width/height are recorded.`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: V.upload.extend({ file: z.string().meta({ format: "binary" }) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Uploaded",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), message: z.string(), data: FileInfo }),
        },
      },
    },
    400: { description: "No file" },
    413: { description: "Too large" },
    422: { description: "Unsupported type" },
  },
});

defineRoute({
  method: "get",
  path: "/files/:id",
  tags,
  summary: "File details with a fresh signed URL",
  request: { params: V.idParams },
  response: FileInfo,
  errors: [401, 404],
});

registry.registerPath({
  method: "get",
  path: "/files/{id}/content",
  tags,
  summary: "File content",
  description: "Authorized by the signed `token` from `url`, or a bearer token.",
  request: { params: V.idParams, query: V.contentQuery },
  responses: {
    200: { description: "The file" },
    401: { description: "No valid token" },
    404: { description: "Not found" },
  },
});

defineRoute({
  method: "delete",
  path: "/files/:id",
  tags,
  summary: "Delete a file (uploader or Super Admin)",
  request: { params: V.idParams },
  errors: [401, 403, 404],
});
