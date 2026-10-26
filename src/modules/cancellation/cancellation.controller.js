import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { CancellationService as S } from "./cancellation.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

export const CancellationController = {
  list: async (req, res) => {
    const { data, meta } = await S.list(access(req), req.valid.query);
    return sendResponse(res, { message: "Cancellations", data, meta });
  },
  getById: async (req, res) =>
    sendResponse(res, { message: "Cancellation", data: await S.getById(access(req), id(req)) }),
  quote: async (req, res) =>
    sendResponse(res, {
      message: "Cancellation quote",
      data: await S.quote(access(req), req.valid.query),
    }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: "Cancellation sent for approval",
      data: await S.create(access(req), req.body),
    }),
  setRefundSchedule: async (req, res) =>
    sendResponse(res, {
      message: "Refund schedule saved",
      data: await S.setRefundSchedule(access(req), id(req), req.body),
    }),
  payRefund: async (req, res) =>
    sendResponse(res, {
      message: "Refund paid",
      data: await S.payRefund(access(req), id(req), req.body),
    }),
  withdraw: async (req, res) =>
    sendResponse(res, {
      message: "Cancellation withdrawn",
      data: await S.withdraw(access(req), id(req), req.body),
    }),
};
