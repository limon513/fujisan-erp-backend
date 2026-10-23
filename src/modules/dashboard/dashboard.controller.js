import sendResponse from "#core/utils/sendResponse.js";
import { DashboardService } from "./dashboard.service.js";

const summary = async (req, res) =>
  sendResponse(res, { message: "Dashboard", data: await DashboardService.summary(req.actor) });

export const DashboardController = { summary };
