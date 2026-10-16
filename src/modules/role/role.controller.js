import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { RoleService } from "./role.service.js";

const list = async (req, res) => {
  const { data, meta } = await RoleService.list(req.valid.query);
  return sendResponse(res, { message: "Roles retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await RoleService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Role retrieved", data });
};

const create = async (req, res) => {
  const data = await RoleService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Role created", data });
};

const update = async (req, res) => {
  const data = await RoleService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Role updated", data });
};

const remove = async (req, res) => {
  await RoleService.remove(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Role deleted", data: null });
};

const setPermissions = async (req, res) => {
  const data = await RoleService.setPermissions(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Role permissions updated", data });
};

const catalog = async (_req, res) => {
  const data = await RoleService.catalog();
  return sendResponse(res, { message: "Permission catalog", data });
};

export const RoleController = { list, getById, create, update, remove, setPermissions, catalog };
