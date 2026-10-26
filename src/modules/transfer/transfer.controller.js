import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { TransferService as S } from "./transfer.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

export const TransferController = {
  list: async (req, res) => {
    const { data, meta } = await S.list(access(req), req.valid.query);
    return sendResponse(res, { message: "Ownership transfers", data, meta });
  },
  getById: async (req, res) =>
    sendResponse(res, {
      message: "Ownership transfer",
      data: await S.getById(access(req), id(req)),
    }),
  quote: async (req, res) =>
    sendResponse(res, {
      message: "Transfer quote",
      data: await S.quote(access(req), req.valid.query),
    }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Transfer sent for approval",
      data: await S.create(access(req), req.body),
    }),
  replaceAgreement: async (req, res) =>
    sendResponse(res, {
      message: "Agreement replaced",
      data: await S.replaceAgreement(access(req), id(req), req.body),
    }),
  complete: async (req, res) =>
    sendResponse(res, {
      message: "Transfer completed",
      data: await S.complete(access(req), id(req), req.body),
    }),
  withdraw: async (req, res) =>
    sendResponse(res, {
      message: "Transfer withdrawn",
      data: await S.withdraw(access(req), id(req), req.body),
    }),
};
