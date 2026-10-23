import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { LeadSourceService } from "./lead-source.service.js";

const list = async (req, res) => {
  const { data, meta } = await LeadSourceService.list(req.valid.query);
  return sendResponse(res, { message: "Lead sources retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await LeadSourceService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Lead source retrieved", data });
};

const create = async (req, res) => {
  const data = await LeadSourceService.create(req.actor, req.body);
  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Lead source created",
    data,
  });
};

const update = async (req, res) => {
  const data = await LeadSourceService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Lead source updated", data });
};

const remove = async (req, res) => {
  await LeadSourceService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Lead source removed", data: null });
};

export const LeadSourceController = { list, getById, create, update, remove };
