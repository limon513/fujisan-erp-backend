import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { TeamService } from "./team.service.js";

const list = async (req, res) => {
  const { data, meta } = await TeamService.list(req.valid.query);
  return sendResponse(res, { message: "Teams retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await TeamService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Team retrieved", data });
};

const create = async (req, res) => {
  const data = await TeamService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Team created", data });
};

const update = async (req, res) => {
  const data = await TeamService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Team updated", data });
};

const remove = async (req, res) => {
  await TeamService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Team deleted", data: null });
};

export const TeamController = { list, getById, create, update, remove };
