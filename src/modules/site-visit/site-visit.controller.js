import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { SiteVisitService } from "./site-visit.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await SiteVisitService.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Site visits retrieved", data, meta });
};

const counts = async (req, res) =>
  sendResponse(res, {
    message: "Site visit counts",
    data: await SiteVisitService.counts(access(req), req.valid.query),
  });

const getById = async (req, res) =>
  sendResponse(res, {
    message: "Site visit retrieved",
    data: await SiteVisitService.getById(access(req), id(req)),
  });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Site visit scheduled",
    data: await SiteVisitService.create(access(req), req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Site visit updated",
    data: await SiteVisitService.update(access(req), id(req), req.body),
  });

const complete = async (req, res) =>
  sendResponse(res, {
    message: "Site visit recorded",
    data: await SiteVisitService.complete(access(req), id(req), req.body),
  });

const cancel = async (req, res) =>
  sendResponse(res, {
    message: "Site visit cancelled",
    data: await SiteVisitService.cancel(access(req), id(req), req.body),
  });

export const SiteVisitController = { list, counts, getById, create, update, complete, cancel };
