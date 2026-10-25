import sendResponse from "#core/utils/sendResponse.js";
import { FiscalYearService as S } from "./fiscal-year.service.js";

export const FiscalYearController = {
  list: async (req, res) => sendResponse(res, { message: "Fiscal years", data: await S.list() }),
  close: async (req, res) =>
    sendResponse(res, {
      message: "Fiscal year closed",
      data: await S.setStatus(req.actor, req.valid.params.id, "CLOSED"),
    }),
  reopen: async (req, res) =>
    sendResponse(res, {
      message: "Fiscal year reopened",
      data: await S.setStatus(req.actor, req.valid.params.id, "OPEN"),
    }),
};
