import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { CampaignService } from "./campaign.service.js";

const list = async (req, res) => {
  const { data, meta } = await CampaignService.list(req.valid.query);
  return sendResponse(res, { message: "Campaigns retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await CampaignService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Campaign retrieved", data });
};

const create = async (req, res) => {
  const data = await CampaignService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Campaign created", data });
};

const update = async (req, res) => {
  const data = await CampaignService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Campaign updated", data });
};

const remove = async (req, res) => {
  await CampaignService.remove(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Campaign removed", data: null });
};

export const CampaignController = { list, getById, create, update, remove };
