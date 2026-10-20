import multer from "multer";
import config from "#config/index.js";

/** Single-file multipart upload kept in memory (files are small; we inspect bytes before storing). */
export const uploadSingle = (field = "file") =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.storage.maxUploadBytes, files: 1, fields: 10 },
  }).single(field);
