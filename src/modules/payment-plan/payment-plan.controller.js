import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { PaymentPlanService as S } from "./payment-plan.service.js";

const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await S.list(req.valid.query);
  return sendResponse(res, { message: "Payment plans retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, { message: "Payment plan retrieved", data: await S.getById(id(req)) });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Payment plan created",
    data: await S.create(req.actor, req.body),
  });

const update = async (req, res) =>
  sendResponse(res, {
    message: "Payment plan updated",
    data: await S.update(req.actor, id(req), req.body),
  });

const remove = async (req, res) => {
  await S.remove(req.actor, id(req));
  return sendResponse(res, { message: "Payment plan removed", data: null });
};

const schedule = async (req, res) =>
  sendResponse(res, { message: "Payment schedule", data: await S.schedule(id(req), req.body) });

const preview = async (req, res) =>
  sendResponse(res, { message: "Payment schedule preview", data: await S.preview(req.body) });

export const PaymentPlanController = { list, getById, create, update, remove, schedule, preview };
