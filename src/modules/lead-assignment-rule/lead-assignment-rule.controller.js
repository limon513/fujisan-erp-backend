import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { LeadAssignmentRuleService as S } from "./lead-assignment-rule.service.js";

const id = (req) => req.valid.params.id;

const list = async (req, res) =>
  sendResponse(res, { message: "Assignment rules retrieved", data: await S.list() });

const getById = async (req, res) =>
  sendResponse(res, { message: "Assignment rule retrieved", data: await S.getById(id(req)) });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Assignment rule created",
    data: await S.create(req.actor, req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Assignment rule updated",
    data: await S.update(req.actor, id(req), req.body),
  });

const remove = async (req, res) => {
  await S.remove(id(req));
  return sendResponse(res, { message: "Assignment rule deleted", data: null });
};

const distributePool = async (req, res) =>
  sendResponse(res, {
    message: "Pool leads distributed",
    data: await S.distributePool(req.actor),
  });

export const LeadAssignmentRuleController = {
  list,
  getById,
  create,
  update,
  remove,
  distributePool,
};
