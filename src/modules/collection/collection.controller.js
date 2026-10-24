import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { CollectionService as S } from "./collection.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await S.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Payments retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, { message: "Payment retrieved", data: await S.getById(access(req), id(req)) });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Payment entered, waiting for verification",
    data: await S.create(access(req), req.body),
  });

const verify = async (req, res) =>
  sendResponse(res, { message: "Payment verified", data: await S.verify(access(req), id(req)) });

const reject = async (req, res) =>
  sendResponse(res, {
    message: "Payment rejected",
    data: await S.reject(access(req), id(req), req.body),
  });

const reverse = async (req, res) =>
  sendResponse(res, {
    message: "Payment reversed",
    data: await S.reverse(access(req), id(req), req.body),
  });

export const CollectionController = { list, getById, create, verify, reject, reverse };
