import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { ProjectCostService as S } from "./project-cost.service.js";

export const ProjectCostController = {
  list: async (req, res) => {
    const { data, meta } = await S.list(req.valid.query);
    return sendResponse(res, { message: "Project costs", data, meta });
  },
  summary: async (req, res) =>
    sendResponse(res, {
      message: "Project cost summary",
      data: await S.summary(req.valid.query.projectId),
    }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Cost recorded and posted",
      data: await S.create(req.actor, req.body),
    }),
  reverse: async (req, res) =>
    sendResponse(res, {
      message: "Cost reversed",
      data: await S.reverse(req.actor, req.valid.params.id, req.body),
    }),
};
