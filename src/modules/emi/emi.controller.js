import sendResponse from "#core/utils/sendResponse.js";
import { EmiService as S } from "./emi.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });

const list = async (req, res) => {
  const { data, meta } = await S.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Installments retrieved", data, meta });
};

const summary = async (req, res) =>
  sendResponse(res, { message: "EMI summary", data: await S.summary(access(req)) });

const waiveLateFee = async (req, res) =>
  sendResponse(res, {
    message: "Late fee waived",
    data: await S.waiveLateFee(access(req), req.valid.params.id, req.body),
  });

export const EmiController = { list, summary, waiveLateFee };
