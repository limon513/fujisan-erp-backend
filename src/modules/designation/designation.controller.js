import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { DesignationService } from "./designation.service.js";

const list = async (req, res) => {
  const { data, meta } = await DesignationService.list(req.valid.query);
  return sendResponse(res, { message: "Designations retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await DesignationService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Designation retrieved", data });
};

const create = async (req, res) => {
  const data = await DesignationService.create(req.actor, req.body);
  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Designation created",
    data,
  });
};

const update = async (req, res) => {
  const data = await DesignationService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Designation updated", data });
};

const remove = async (req, res) => {
  await DesignationService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Designation deleted", data: null });
};

export const DesignationController = { list, getById, create, update, remove };
