import sendResponse from "#core/utils/sendResponse.js";
import { SettingService } from "./setting.service.js";

const getCompany = async (_req, res) => {
  const data = await SettingService.getCompany();
  return sendResponse(res, { message: "Company profile", data });
};

const updateCompany = async (req, res) => {
  const data = await SettingService.updateCompany(req.actor, req.body);
  return sendResponse(res, { message: "Company profile updated", data });
};

const branding = async (_req, res) => {
  const data = await SettingService.branding();
  return sendResponse(res, { message: "Branding", data });
};

export const SettingController = { getCompany, updateCompany, branding };
