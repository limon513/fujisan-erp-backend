import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { BankReconciliationService as S } from "./bank-reconciliation.service.js";

const id = (req) => req.valid.params.id;

export const BankReconciliationController = {
  accounts: async (req, res) =>
    sendResponse(res, { message: "Bank accounts", data: await S.accounts() }),
  list: async (req, res) =>
    sendResponse(res, { message: "Bank statements", data: await S.list(req.valid.query) }),
  getStatement: async (req, res) =>
    sendResponse(res, { message: "Bank statement", data: await S.getStatement(id(req)) }),
  importStatement: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Statement imported",
      data: await S.importStatement(req.actor, req.body),
    }),
  removeStatement: async (req, res) => {
    await S.removeStatement(id(req));
    return sendResponse(res, { message: "Statement removed" });
  },
  candidates: async (req, res) =>
    sendResponse(res, { message: "Possible matches", data: await S.candidates(id(req)) }),
  match: async (req, res) =>
    sendResponse(res, { message: "Matched", data: await S.match(req.actor, id(req), req.body) }),
  unmatch: async (req, res) =>
    sendResponse(res, { message: "Unmatched", data: await S.unmatch(id(req)) }),
  ignore: async (req, res) =>
    sendResponse(res, { message: "Updated", data: await S.ignore(req.actor, id(req), req.body) }),
  book: async (req, res) =>
    sendResponse(res, {
      message: "Entry posted and matched",
      data: await S.book(req.actor, id(req), req.body),
    }),
};
