import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { EmployeeService } from "./employee.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });

const list = async (req, res) => {
  const { data, meta } = await EmployeeService.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Employees retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await EmployeeService.getById(access(req), req.valid.params.id);
  return sendResponse(res, { message: "Employee retrieved", data });
};

const create = async (req, res) => {
  const data = await EmployeeService.create(access(req), req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Employee created", data });
};

const update = async (req, res) => {
  const data = await EmployeeService.update(access(req), req.valid.params.id, req.body);
  return sendResponse(res, { message: "Employee updated", data });
};

const remove = async (req, res) => {
  await EmployeeService.remove(access(req), req.valid.params.id);
  return sendResponse(res, { message: "Employee removed", data: null });
};

export const EmployeeController = { list, getById, create, update, remove };
