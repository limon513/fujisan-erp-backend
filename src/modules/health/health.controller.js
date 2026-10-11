import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { HealthService } from "./health.service.js";

const getStatus = async (_req, res) => {
  const result = await HealthService.getStatus();
  return sendResponse(res, {
    statusCode: result.status === "ok" ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE,
    message: "Service status",
    data: result,
  });
};

export const HealthController = { getStatus };
