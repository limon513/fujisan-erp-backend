import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { BlockService, ProjectService, RoadService } from "./project.service.js";

const list = async (req, res) => {
  const { data, meta } = await ProjectService.list(req.valid.query);
  return sendResponse(res, { message: "Projects retrieved", data, meta });
};

const getById = async (req, res) => {
  const data = await ProjectService.getById(req.valid.params.id);
  return sendResponse(res, { message: "Project retrieved", data });
};

const create = async (req, res) => {
  const data = await ProjectService.create(req.actor, req.body);
  return sendResponse(res, { statusCode: StatusCodes.CREATED, message: "Project created", data });
};

const update = async (req, res) => {
  const data = await ProjectService.update(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Project updated", data });
};

const remove = async (req, res) => {
  await ProjectService.remove(req.valid.params.id);
  return sendResponse(res, { message: "Project deleted", data: null });
};

const setLayout = async (req, res) => {
  const data = await ProjectService.setLayout(req.actor, req.valid.params.id, req.body);
  return sendResponse(res, { message: "Layout image set", data });
};

const removeLayout = async (req, res) => {
  const data = await ProjectService.removeLayout(req.actor, req.valid.params.id);
  return sendResponse(res, { message: "Layout image removed", data });
};

/** list/create/update/remove handlers for a nested resource (blocks, roads) */
const childController = (service, label) => ({
  list: async (req, res) =>
    sendResponse(res, {
      message: `${label}s retrieved`,
      data: await service.list(req.valid.params.id),
    }),
  create: async (req, res) =>
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: `${label} created`,
      data: await service.create(req.actor, req.valid.params.id, req.body),
    }),
  update: async (req, res) =>
    sendResponse(res, {
      message: `${label} updated`,
      data: await service.update(
        req.actor,
        req.valid.params.id,
        req.valid.params.childId,
        req.body,
      ),
    }),
  remove: async (req, res) => {
    await service.remove(req.valid.params.id, req.valid.params.childId);
    return sendResponse(res, { message: `${label} deleted`, data: null });
  },
});

export const ProjectController = {
  list,
  getById,
  create,
  update,
  remove,
  setLayout,
  removeLayout,
  blocks: childController(BlockService, "Block"),
  roads: childController(RoadService, "Road"),
};
