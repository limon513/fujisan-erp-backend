import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { JournalService as S } from "./journal.service.js";

const id = (req) => req.valid.params.id;

export const JournalController = {
  list: async (req, res) => {
    const { data, meta } = await S.list(req.valid.query);
    return sendResponse(res, { message: "Journal entries", data, meta });
  },
  getById: async (req, res) =>
    sendResponse(res, { message: "Journal entry", data: await S.getById(id(req)) }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Journal entry posted",
      data: await S.create(req.actor, req.body),
    }),
  reverse: async (req, res) =>
    sendResponse(res, {
      message: "Journal entry reversed",
      data: await S.reverse(req.actor, id(req), req.body),
    }),
};
