import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { BranchService } from "./branch.service.js";

const list = async (req, res) => {
  const { data, meta } = await BranchService.list(req.valid.query);
  return sendResponse(res, { message: "Branches retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await BranchService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Branch retrieved", data });
};

const create = async (req, res) => {
  const data = await BranchService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Branch created", data });
};

const update = async (req, res) => {
  const data = await BranchService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Branch updated", data });
};

const remove = async (req, res) => {
  await BranchService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Branch deleted", data: null });
};

export const BranchController = { list, getById, create, update, remove };
