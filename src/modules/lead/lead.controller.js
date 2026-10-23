import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { LeadService } from "./lead.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await LeadService.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Leads retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, {
    message: "Lead retrieved",
    data: await LeadService.getById(access(req), id(req)),
  });

const checkDuplicates = async (req, res) =>
  sendResponse(res, {
    message: "Duplicate check",
    data: await LeadService.checkDuplicates(req.valid.query),
  });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Lead created",
    data: await LeadService.create(access(req), req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Lead updated",
    data: await LeadService.update(access(req), id(req), req.body),
  });

const remove = async (req, res) => {
  await LeadService.remove(access(req), id(req));
  return sendResponse(res, { message: "Lead removed", data: null });
};

const changeStatus = async (req, res) =>
  sendResponse(res, {
    message: "Lead status changed",
    data: await LeadService.changeStatus(access(req), id(req), req.body),
  });

const addActivity = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Activity logged",
    data: await LeadService.addActivity(access(req), id(req), req.body),
  });

const assign = async (req, res) =>
  sendResponse(res, {
    message: "Lead assigned",
    data: await LeadService.assign(access(req), id(req), req.body),
  });

const convert = async (req, res) =>
  sendResponse(res, {
    message: "Lead converted",
    data: await LeadService.convert(access(req), id(req), req.body),
  });

export const LeadController = {
  list,
  getById,
  checkDuplicates,
  create,
  update,
  remove,
  changeStatus,
  addActivity,
  assign,
  convert,
};
