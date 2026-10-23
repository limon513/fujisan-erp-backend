import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { FollowUpService } from "./follow-up.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await FollowUpService.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Follow-ups retrieved", data, meta });
};

const counts = async (req, res) =>
  sendResponse(res, {
    message: "Follow-up counts",
    data: await FollowUpService.counts(access(req), req.valid.query),
  });

const getById = async (req, res) =>
  sendResponse(res, {
    message: "Follow-up retrieved",
    data: await FollowUpService.getById(access(req), id(req)),
  });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Follow-up scheduled",
    data: await FollowUpService.create(access(req), req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Follow-up updated",
    data: await FollowUpService.update(access(req), id(req), req.body),
  });

const complete = async (req, res) =>
  sendResponse(res, {
    message: "Follow-up done",
    data: await FollowUpService.complete(access(req), id(req), req.body),
  });

const cancel = async (req, res) =>
  sendResponse(res, {
    message: "Follow-up cancelled",
    data: await FollowUpService.cancel(access(req), id(req), req.body),
  });

export const FollowUpController = { list, counts, getById, create, update, complete, cancel };
