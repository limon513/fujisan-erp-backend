import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { FILE_URL_TTL_SECONDS, signFileToken } from "#core/auth/fileTokens.js";
import storage from "#core/storage/index.js";
import { ALLOWED_TYPES, fileSelect } from "./file.constant.js";

/** Same-origin URL the browser can use directly (valid for FILE_URL_TTL_SECONDS). */
export const contentUrl = (fileId) =>
  `/api/v1/files/${fileId}/content?token=${encodeURIComponent(signFileToken(fileId))}`;

export const toFileDto = (file) => ({
  ...file,
  url: contentUrl(file.id),
  urlExpiresIn: FILE_URL_TTL_SECONDS,
});

const findFile = async (id) => {
  const file = await prisma.file.findFirst({ where: { id, deletedAt: null } });
  if (!file) throw AppError.notFound("File not found");
  return file;
};

const upload = async (actor, file, { category, entityType, entityId }) => {
  if (!file?.buffer?.length)
    throw AppError.badRequest("Choose a file", [{ path: "file", message: "Required" }]);

  const detected = await fileTypeFromBuffer(file.buffer);
  const extension = detected && ALLOWED_TYPES[detected.mime];
  if (!extension) {
    throw AppError.unprocessable("Only JPEG, PNG, WebP images and PDF files are allowed", [
      { path: "file", message: "Unsupported file type" },
    ]);
  }

  let dimensions = {};
  if (detected.mime.startsWith("image/")) {
    try {
      const { width, height } = imageSize(file.buffer);
      dimensions = { width, height };
    } catch {
      throw AppError.unprocessable("The image could not be read", [
        { path: "file", message: "Corrupt image" },
      ]);
    }
  }

  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `${category.toLowerCase()}/${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension}`;
  await storage.put(storageKey, file.buffer, detected.mime);

  const record = await prisma.file.create({
    data: {
      storageKey,
      originalName: file.originalname.slice(0, 255),
      mimeType: detected.mime,
      size: file.size,
      checksum: createHash("sha256").update(file.buffer).digest("hex"),
      category,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      uploadedById: actor.userId,
      ...dimensions,
    },
    select: fileSelect,
  });
  return toFileDto(record);
};

const getById = async (id) => {
  const file = await prisma.file.findFirst({ where: { id, deletedAt: null }, select: fileSelect });
  if (!file) throw AppError.notFound("File not found");
  return toFileDto(file);
};

/** @returns {{ stream, mimeType, originalName, size }} */
const content = async (id) => {
  const file = await findFile(id);
  try {
    return { stream: await storage.get(file.storageKey), ...file };
  } catch {
    throw AppError.notFound("File content is missing from storage");
  }
};

/** Soft delete (the stored object is kept for history). Only the uploader or Super Admin. */
const remove = async (actor, id) => {
  const file = await findFile(id);
  if (!actor.isSuperAdmin && file.uploadedById !== actor.userId) {
    throw AppError.forbidden("Only the uploader can delete this file");
  }
  await prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
};

export const FileService = { upload, getById, content, remove };
