import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { CustomerService } from "./customer.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const params = (req) => req.valid.params;

const list = async (req, res) => {
  const { data, meta } = await CustomerService.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Customers retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, {
    message: "Customer retrieved",
    data: await CustomerService.getById(access(req), params(req).id),
  });

const checkDuplicates = async (req, res) =>
  sendResponse(res, {
    message: "Duplicate check",
    data: await CustomerService.checkDuplicates(req.valid.query),
  });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Customer created",
    data: await CustomerService.create(access(req), req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Customer updated",
    data: await CustomerService.update(access(req), params(req).id, req.body),
  });

const remove = async (req, res) => {
  await CustomerService.remove(access(req), params(req).id);
  return sendResponse(res, { message: "Customer removed", data: null });
};

const addNominee = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Nominee added",
    data: await CustomerService.addNominee(access(req), params(req).id, req.body),
  });

const updateNominee = async (req, res) =>
  sendResponse(res, {
    message: "Nominee updated",
    data: await CustomerService.updateNominee(
      access(req),
      params(req).id,
      params(req).childId,
      req.body,
    ),
  });

const removeNominee = async (req, res) =>
  sendResponse(res, {
    message: "Nominee removed",
    data: await CustomerService.removeNominee(access(req), params(req).id, params(req).childId),
  });

const addDocument = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Document attached",
    data: await CustomerService.addDocument(access(req), params(req).id, req.body),
  });

const removeDocument = async (req, res) =>
  sendResponse(res, {
    message: "Document removed",
    data: await CustomerService.removeDocument(access(req), params(req).id, params(req).childId),
  });

export const CustomerController = {
  list,
  getById,
  checkDuplicates,
  create,
  update,
  remove,
  addNominee,
  updateNominee,
  removeNominee,
  addDocument,
  removeDocument,
};
