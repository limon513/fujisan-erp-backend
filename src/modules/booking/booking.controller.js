import { StatusCodes } from "http-status-codes";
import sendResponse from "#core/utils/sendResponse.js";
import { BookingService as S } from "./booking.service.js";

const access = (req) => ({ actor: req.actor, scope: req.access.scope });
const id = (req) => req.valid.params.id;

const list = async (req, res) => {
  const { data, meta } = await S.list(access(req), req.valid.query);
  return sendResponse(res, { message: "Bookings retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, { message: "Booking retrieved", data: await S.getById(access(req), id(req)) });

const quote = async (req, res) =>
  sendResponse(res, { message: "Booking quote", data: await S.quote(access(req), req.body) });

const create = async (req, res) =>
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: "Booking submitted for approval",
    data: await S.create(access(req), req.body),
  });

const withdraw = async (req, res) =>
  sendResponse(res, {
    message: "Booking withdrawn",
    data: await S.withdraw(access(req), id(req), req.body),
  });

export const BookingController = { list, getById, quote, create, withdraw };
