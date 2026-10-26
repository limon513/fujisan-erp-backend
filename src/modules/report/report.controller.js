import sendResponse from "#core/utils/sendResponse.js";
import { ReportService as S } from "./report.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });

export const ReportController = {
  overview: async (req, res) =>
    sendResponse(res, { message: "Overview", data: await S.overview(access(req)) }),
  sales: async (req, res) =>
    sendResponse(res, {
      message: "Sales report",
      data: await S.sales(access(req), req.valid.query),
    }),
  collections: async (req, res) =>
    sendResponse(res, {
      message: "Collection report",
      data: await S.collections(access(req), req.valid.query),
    }),
  outstanding: async (req, res) => {
    const { data, meta, totals } = await S.outstanding(access(req), req.valid.query);
    return sendResponse(res, { message: "Outstanding", data: { rows: data, totals }, meta });
  },
  customerStatement: async (req, res) =>
    sendResponse(res, {
      message: "Customer statement",
      data: await S.customerStatement(access(req), req.valid.params.id),
    }),
};
