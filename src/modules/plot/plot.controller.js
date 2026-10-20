import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { IMPORT_TEMPLATE } from "./plot.import.js";
import { PlotService } from "./plot.service.js";

const list = async (req, res) => {
  const { data, meta } = await PlotService.list(req.valid.query);
  return sendResponse(res, { message: "Plots retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await PlotService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Plot retrieved", data });
};

const create = async (req, res) => {
  const data = await PlotService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Plot created", data });
};

const update = async (req, res) => {
  const data = await PlotService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Plot updated", data });
};

const changePrice = async (req, res) => {
  const data = await PlotService.changePrice(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Price changed", data });
};

const remove = async (req, res) => {
  await PlotService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Plot deleted", data: null });
};

const importPlots = async (req, res) => {
  const data = await PlotService.importPlots(req.actor, req.file, req.valid.query);
  return sendResponse(res, {
    statusCode: data.created ? StatusCodes.CREATED : StatusCodes.OK,
    message: data.created ? `${data.created} plots imported` : "Import preview",
    data,
  });
};

const importTemplate = (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="plots-import-template.csv"');
  res.send(IMPORT_TEMPLATE);
};

export const PlotController = {
  list,
  getById,
  create,
  update,
  changePrice,
  remove,
  importPlots,
  importTemplate,
};
