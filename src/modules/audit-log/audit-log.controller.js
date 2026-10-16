import sendResponse from "#core/utils/sendResponse.js";
import { AuditLogService } from "./audit-log.service.js";

const list = async (req, res) => {
  const { data, meta } = await AuditLogService.list(req.valid.query);
  return sendResponse(res, { message: "Audit log retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await AuditLogService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Audit entry retrieved", data });
};

const filterOptions = async (_req, res) => {
  const data = await AuditLogService.filterOptions();
  return sendResponse(res, { message: "Audit log filter options", data });
};

export const AuditLogController = { list, getById, filterOptions };
