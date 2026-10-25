import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { AccountService as S } from "./account.service.js";

const id = (req) => req.valid.params.id;

export const AccountController = {
  list: async (req, res) =>
    sendResponse(res, { message: "Chart of accounts", data: await S.list(req.valid.query) }),
  getById: async (req, res) =>
    sendResponse(res, { message: "Account retrieved", data: await S.getById(id(req)) }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Account created",
      data: await S.create(req.actor, req.body),
    }),
  update: async (req, res) =>
    sendResponse(res, {
      message: "Account updated",
      data: await S.update(req.actor, id(req), req.body),
    }),
  remove: async (req, res) => {
    await S.remove(id(req));
    return sendResponse(res, { message: "Account deleted", data: null });
  },
  ledger: async (req, res) =>
    sendResponse(res, {
      message: "Account ledger",
      data: await S.ledger(id(req), req.valid.query),
    }),
  trialBalance: async (req, res) =>
    sendResponse(res, { message: "Trial balance", data: await S.trialBalance(req.valid.query) }),
};
