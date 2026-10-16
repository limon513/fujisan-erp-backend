import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { UserService } from "./user.service.js";

const list = async (req, res) => {
  const { data, meta } = await UserService.list(req.valid.query);
  return sendResponse(res, { message: "Users retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await UserService.getById(req.valid.params.id);
  return sendResponse(res, { message: "User retrieved", data });
};

const create = async (req, res) => {
  const data = await UserService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "User created", data });
};

const update = async (req, res) => {
  const data = await UserService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "User updated", data });
};

const resetPassword = async (req, res) => {
  const data = await UserService.resetPassword(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Temporary password set", data });
};

const unlock = async (req, res) => {
  const data = await UserService.unlock(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Account unlocked", data });
};

const remove = async (req, res) => {
  await UserService.remove(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "User deleted", data: null });
};

export const UserController = { list, getById, create, update, resetPassword, unlock, remove };
