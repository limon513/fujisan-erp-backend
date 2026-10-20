import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { FileService } from "./file.service.js";

const upload = async (req, res) => {
  const data = await FileService.upload(req.actor, req.file, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "File uploaded", data });
};

const getById = async (req, res) => {
  const data = await FileService.getById(req.valid.params.id);
  return sendResponse(res, { message: "File", data });
};

const content = async (req, res) => {
  const file = await FileService.content(req.valid.params.id);
  const disposition = req.valid.query.download ? "attachment" : "inline";
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", file.size);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
  );
  res.setHeader("Cache-Control", "private, max-age=600");
  file.stream.on("error", () => res.destroy());
  file.stream.pipe(res);
};

const remove = async (req, res) => {
  await FileService.remove(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "File deleted", data: null });
};

export const FileController = { upload, getById, content, remove };
