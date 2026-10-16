import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { DepartmentService } from "./department.service.js";

const list = async (req, res) => {
  const { data, meta } = await DepartmentService.list(req.valid.query);
  return sendResponse(res, { message: "Departments retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await DepartmentService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Department retrieved", data });
};

const create = async (req, res) => {
  const data = await DepartmentService.create(req.actor, req.body);
  return sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Department created",
    data,
  });
};

const update = async (req, res) => {
  const data = await DepartmentService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Department updated", data });
};

const remove = async (req, res) => {
  await DepartmentService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Department deleted", data: null });
};

export const DepartmentController = { list, getById, create, update, remove };
